import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PipelineSuccess, PlanFailure, PlanRequest } from '../contracts';
import { PlanPipelineService } from './plan-pipeline.service';

type PlanJob = { id: string } & (
  { status: 'running' }
  | { status: 'completed'; result: PipelineSuccess | PlanFailure }
  | { status: 'failed'; message: string }
);

const RESULT_RETENTION_MS = 5 * 60 * 1000;

@Injectable()
export class PlanJobService {
  private readonly jobs = new Map<string, PlanJob>();
  private readonly logger = new Logger(PlanJobService.name);

  constructor(private readonly pipeline: PlanPipelineService) {}

  start(input: PlanRequest): { id: string } {
    const id = randomUUID();
    this.jobs.set(id, { id, status: 'running' });
    void this.generate(id, input);
    return { id };
  }

  get(id: string): PlanJob {
    const job = this.jobs.get(id);
    if (!job) throw new NotFoundException('生成任务不存在或已过期');
    return job;
  }

  private async generate(id: string, input: PlanRequest): Promise<void> {
    try {
      const result = await this.pipeline.generate(input);
      this.jobs.set(id, { id, status: 'completed', result });
    } catch (error) {
      this.logger.error(`生成任务 ${id} 失败`, error instanceof Error ? error.stack : undefined);
      this.jobs.set(id, { id, status: 'failed', message: '方案生成失败，请重试' });
    } finally {
      setTimeout(() => this.jobs.delete(id), RESULT_RETENTION_MS).unref();
    }
  }
}
