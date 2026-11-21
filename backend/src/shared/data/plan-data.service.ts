import { Inject, Injectable, Optional } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PlanData } from '../contracts';
import { validatePlanData } from './plan-data';

@Injectable()
export class PlanDataService {
  readonly data: PlanData;

  constructor(@Optional() @Inject('PLAN_DATA_DIR') directory?: string) {
    const candidates = [resolve(process.cwd(), 'data'), resolve(process.cwd(), '../data'), resolve(__dirname, '../../../../data'), resolve(__dirname, '../../../../../data')];
    const root = directory ?? process.env.PLAN_DATA_DIR ?? candidates.find(path => existsSync(resolve(path, 'briefs.json'))) ?? candidates[0];
    const read = (name: string, optional = false): unknown => {
      const path = resolve(root, `${name}.json`);
      if (optional && !existsSync(path)) return { byMediaKey: {} };
      try { return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')); }
      catch (error) { throw new Error(`无法读取 ${name}.json：${error instanceof Error ? error.message : '无效 JSON'}`); }
    };
    const data = { bus: read('bus'), metro: read('metro'), pricing: read('pricing'), briefs: read('briefs'), coverage: read('coverage'), traffic: read('traffic', true) };
    validatePlanData(data);
    this.data = data;
  }
}
