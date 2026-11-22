import { Injectable } from '@nestjs/common';
import { Inventory, MediaKind } from '../shared/contracts';

const baseUrl = () => process.env.HONGDOU_BASE_URL || 'https://flairmedia.com.cn:881';

export interface HongdouInventory {
  queriedAt: string;
  inventoryByKey: Record<string, Inventory>;
}

export class InventoryUnavailable extends Error {}

export interface HongdouLogin {
  username: string;
  password: string;
}

type OAuthClient = { clientId: string; clientSecret: string };
type Credentials = { tenantId: string } & ({ token: string } | (HongdouLogin & OAuthClient));
type AccessToken = { value: string; expiresAt: number };
type Connection = { credentials: Credentials; token?: AccessToken; pendingLogin?: Promise<AccessToken> };

const HONGDOU_TENANT_ID = '1';

function oauthClient(): OAuthClient | undefined {
  const { HONGDOU_CLIENT_ID, HONGDOU_CLIENT_SECRET } = process.env;
  if (HONGDOU_CLIENT_ID && HONGDOU_CLIENT_SECRET) return { clientId: HONGDOU_CLIENT_ID, clientSecret: HONGDOU_CLIENT_SECRET };
  return undefined;
}

function environmentCredentials(): Credentials | undefined {
  const tenantId = process.env.HONGDOU_TENANT_ID || HONGDOU_TENANT_ID;
  if (process.env.HONGDOU_TOKEN) return { tenantId, token: process.env.HONGDOU_TOKEN };
  const { HONGDOU_USERNAME, HONGDOU_PASSWORD } = process.env;
  const client = oauthClient();
  if (HONGDOU_USERNAME && HONGDOU_PASSWORD && client) {
    return { ...client, tenantId, username: HONGDOU_USERNAME, password: HONGDOU_PASSWORD };
  }
  return undefined;
}

/**
 * 红豆库存查询：OAuth2 取令牌后按原始起止日分页读取所选媒体的全量库存行。
 * 令牌只在内存复用；凭证、令牌与上游原文都不进入响应、日志或交付文件。
 */
@Injectable()
export class HongdouInventoryService {
  private readonly environment?: Connection;
  private session?: Connection;
  private pendingConnection?: Promise<AccessToken>;

  constructor() {
    const credentials = environmentCredentials();
    if (credentials) this.environment = { credentials };
  }

  get enabled(): boolean { return Boolean(this.session ?? this.environment); }

  get source(): 'session' | 'environment' | 'none' {
    if (this.session) return 'session';
    return this.environment ? 'environment' : 'none';
  }

  async connect(input: HongdouLogin, deadline: number): Promise<void> {
    const client = oauthClient();
    if (!client) throw new InventoryUnavailable('服务端未配置红豆 OAuth 客户端');
    const credentials = { ...input, ...client, tenantId: HONGDOU_TENANT_ID };
    const pending = this.login(credentials, deadline);
    this.pendingConnection = pending;
    try {
      const token = await pending;
      if (this.pendingConnection !== pending) throw new InventoryUnavailable('红豆登录已取消');
      this.session = { credentials, token };
    } finally {
      if (this.pendingConnection === pending) this.pendingConnection = undefined;
    }
  }

  disconnect(): void {
    this.pendingConnection = undefined;
    this.session = undefined;
  }

  private async payload(response: Response, stage: string): Promise<any> {
    if (!response.ok) throw new InventoryUnavailable(`红豆${stage}接口返回 HTTP ${response.status}`);
    let body: any;
    try { body = await response.json(); } catch { throw new InventoryUnavailable(`红豆${stage}响应不是 JSON`); }
    if (!body || body.code !== 0) throw new InventoryUnavailable(`红豆${stage}请求失败，code=${typeof body?.code === 'number' ? body.code : '未知'}`);
    return body.data;
  }

  private async fetch(path: string, deadline: number, init: RequestInit = {}): Promise<Response> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new InventoryUnavailable('红豆查询超时');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try { return await fetch(baseUrl() + path, { ...init, signal: controller.signal }); }
    catch (error) { throw new InventoryUnavailable(controller.signal.aborted ? '红豆查询超时' : '红豆连接失败'); }
    finally { clearTimeout(timer); }
  }

  /** 环境已提供 HONGDOU_TOKEN 时直接复用，不再登录；否则按 OAuth2 密码模式取令牌，提前 60 秒失效。 */
  private async login(config: Credentials, deadline: number): Promise<AccessToken> {
    if ('token' in config) return { value: config.token, expiresAt: Number.MAX_SAFE_INTEGER };
    const form = new URLSearchParams({ grant_type: 'password', username: config.username, password: config.password });
    const response = await this.fetch('/admin-api/system/oauth2/token', deadline, {
      method: 'POST',
      headers: { 'tenant-id': config.tenantId, 'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}` },
      body: form.toString(),
    });
    const data = await this.payload(response, '登录');
    if (typeof data?.access_token !== 'string' || !data.access_token) throw new InventoryUnavailable('红豆未返回访问令牌');
    const expiresIn = Number(data.expires_in ?? 3600);
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) throw new InventoryUnavailable('红豆返回了无效的令牌有效期');
    return { value: data.access_token, expiresAt: Date.now() + (expiresIn > 60 ? expiresIn - 60 : expiresIn) * 1000 };
  }

  async query(kind: MediaKind, startDate: string, endDate: string, deadline: number, expectedCount: number): Promise<HongdouInventory> {
    const connection = this.session ?? this.environment;
    if (!connection) throw new InventoryUnavailable('未配置红豆账号');
    // 公交与地铁并行查询时共用一次登录，避免同时发起两次令牌请求。
    if (!connection.token || connection.token.expiresAt <= Date.now()) {
      connection.token = await (connection.pendingLogin ??= this.login(connection.credentials, deadline).finally(() => { connection.pendingLogin = undefined; }));
    }
    const token = connection.token.value;
    const query = new URLSearchParams({ pageNo: '1', pageSize: '1000', startDate, endDate });
    const response = await this.fetch(`/admin-api/orders/media-inventory/${kind}/page?${query}`, deadline, {
      headers: { 'tenant-id': connection.credentials.tenantId, Authorization: `Bearer ${token}` },
    });
    const data = await this.payload(response, `库存(${kind})`);
    const queriedAt = new Date().toISOString();
    const rows = Array.isArray(data?.list) ? data.list : [];
    if (rows.length !== expectedCount) throw new InventoryUnavailable(`${kind} 返回 ${rows.length} 行，预期 ${expectedCount} 条，需核对媒体目录`);
    const inventoryByKey: Record<string, Inventory> = {};
    for (const row of rows) {
      const suffix = kind === 'bus' ? row.mediaName : row.exitName;
      const key = `${kind}|${row.resourceId}|${suffix ?? ''}`;
      if (Object.hasOwn(inventoryByKey, key)) throw new InventoryUnavailable(`${kind} 返回重复媒体 ${key}`);
      inventoryByKey[key] = { freeCount: typeof row.freeCount === 'number' ? row.freeCount : null,
        ...(typeof row.contractCount === 'number' ? { contractCount: row.contractCount } : {}),
        ...(typeof row.reservationCount === 'number' ? { reservedCount: row.reservationCount } : {}) };
    }
    return { queriedAt, inventoryByKey };
  }
}
