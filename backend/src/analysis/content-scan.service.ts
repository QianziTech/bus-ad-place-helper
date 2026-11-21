import { BadRequestException, Injectable } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Check } from '../shared/contracts';

@Injectable()
export class ContentScanService {
  private readonly names: { name: string; alias: string }[] = [];
  readonly mappingAvailable: boolean;
  constructor() {
    const root = existsSync(resolve(process.cwd(), 'backend')) ? process.cwd() : resolve(process.cwd(), '..');
    const path = process.env.BRAND_MAPPING_PATH || resolve(root, 'data/internal/brand_mapping.json');
    if (existsSync(path)) {
      const mapping: unknown = JSON.parse(readFileSync(path, 'utf8'));
      const rows = Array.isArray(mapping) ? mapping : (mapping as { map?: unknown[]; mappings?: unknown[] }).map || (mapping as { mappings?: unknown[] }).mappings || [];
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const record = row as Record<string, unknown>;
        const collect = (value: unknown): string[] => typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(collect) : value && typeof value === 'object' ? Object.values(value).flatMap(collect) : [];
        const real = [...collect(record.real), ...collect(record.realName), ...collect(record.shortNames), ...collect(record.abbreviations)];
        for (const name of real.filter(name => name.length >= 2)) this.names.push({ name, alias: typeof record.alias === 'string' ? record.alias : '客户代称' });
      }
    }
    this.mappingAvailable = this.names.length > 0;
  }
  scan(value: unknown, root = 'text'): Check[] {
    const checks: Check[] = [];
    const visit = (entry: unknown, location: string) => {
      if (typeof entry === 'string') {
        for (const item of this.names) if (entry.includes(item.name)) checks.push({ element: '实名扫描', status: 'fail', blocking: true,
          message: '检测到真实客户名称', location, suggestion: `请改用${item.alias}`, evidenceRefs: ['rule:real-name', location] });
        const clauses = entry.split(/[。；;\n]/);
        for (const clause of clauses) {
          const compliance = /疗效|治愈|患者形象|治疗功能|功效保证|保本|稳赚|承诺收益/g;
          for (const match of clause.matchAll(compliance)) {
            const before = clause.slice(0, match.index);
            if (/(?:不得|不应|不能|不许|禁止|严禁|避免|勿|不|未)[^，,：:。；;]{0,12}$/.test(before)) continue;
            checks.push({ element: '合规扫描', status: 'fail', blocking: true, message: `存在宣传风险词：${match[0]}`, location,
              suggestion: '请改为中性事实描述，移除效果或收益承诺', evidenceRefs: ['rule:compliance', location] });
          }
          const hasTransaction = /(?:实付|成交价|合同价|折后价|到手价|优惠价|折扣价)\s*[:：]?\s*\d+(?:\.\d+)?\s*(?:万|千)?\s*元?/.test(clause);
          const unitPrice = /\d+(?:\.\d+)?\s*(?:万|千)?\s*元?\s*[/／每]\s*(?:辆|台|块|口|月)/.test(clause) || /(?:单价|每辆|每台|每口|每块)\s*[:：为]?\s*\d+(?:\.\d+)?\s*(?:万|千)?\s*元/.test(clause);
          const isRange = /\d+(?:\.\d+)?\s*(?:万|千)?\s*(?:元)?\s*[–—~～至-]\s*\d/.test(clause);
          const productionEstimate = /制作费/.test(clause) && /估算|中值|推断/.test(clause);
          if (hasTransaction || (unitPrice && !isRange && !productionEstimate)) checks.push({ element: '成交价扫描', status: 'fail', blocking: true,
            message: '出现成交价或非区间单价表述', location, suggestion: '使用刊例区间，并明确方案金额为预算估算', evidenceRefs: ['rule:price-wording', location] });
        }
      } else if (Array.isArray(entry)) entry.forEach((item, index) => visit(item, `${location}[${index}]`));
      else if (entry && typeof entry === 'object') for (const [key, item] of Object.entries(entry)) visit(item, `${location}.${key}`);
    };
    visit(value, root);
    return checks;
  }
  assertInput(text: string) {
    const failures = this.scan(text, 'briefText').filter(check => check.element !== '合规扫描');
    if (failures.length) throw new BadRequestException({ message: '需求原文含需替换的客户实名或成交价', checks: failures });
  }
  assertPrompt(payload: string) {
    const failures = this.scan(payload, 'context').filter(check => check.element === '实名扫描' || check.element === '成交价扫描');
    if (failures.length) throw new Error('上下文含禁止外发内容');
  }
  mappingCheck(): Check {
    return this.mappingAvailable
      ? { element: '实名扫描', status: 'pass', message: '已按本机内部映射扫描展示字段', evidenceRefs: ['rule:real-name'] }
      : { element: '实名扫描', status: 'warn', message: '未提供内部品牌映射，无法完成实名核验；请配置 BRAND_MAPPING_PATH', evidenceRefs: ['rule:real-name'], blocking: false };
  }
}
