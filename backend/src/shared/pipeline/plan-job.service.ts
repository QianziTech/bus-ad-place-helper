import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PipelineSuccess, PipelineRangeSuccess, PlanFailure, PipelineRequest } from '../contracts';
import { PlanPipelineService, PlanStageUpdate } from './plan-pipeline.service';

type PlanResultBody = PipelineSuccess | PipelineRangeSuccess | PlanFailure;
type PlanJob = { id: string; progress: (PlanStageUpdate & { startedAt: number; elapsedMs: number })[] } & (
  { status: 'running' }
  | { status: 'completed'; result: PlanResultBody }
  | { status: 'failed'; message: string }
);

const RESULT_RETENTION_MS = 5 * 60 * 1000;

@Injectable()
export class PlanJobService {
  private readonly jobs = new Map<string, PlanJob>();
  private readonly logger = new Logger(PlanJobService.name);

  constructor(private readonly pipeline: PlanPipelineService) {}

  start(input: PipelineRequest): { id: string } {
    const id = randomUUID();
    const job: PlanJob = { id, status: 'running', progress: [] };
    this.jobs.set(id, job);
    void this.generate(job, input);
    return { id };
  }

  get(id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new NotFoundException('生成任务不存在或已过期');
    const now = performance.now();
    return { ...job, progress: job.progress.map(({ startedAt, ...stage }) => ({
      ...stage, elapsedMs: stage.status === 'running' ? Math.round(now - startedAt) : stage.elapsedMs,
    })) };
  }

  private async generate(job: PlanJob, input: PipelineRequest): Promise<void> {
    const { id, progress } = job;
    const update = (stage: PlanStageUpdate) => {
      const index = progress.findIndex(item => item.key === stage.key);
      const now = performance.now();
      const previous = progress[index];
      const startedAt = previous?.status === 'running' ? previous.startedAt : now;
      const entry = { ...stage, startedAt, elapsedMs: stage.status === 'skipped' ? 0 : Math.round(now - startedAt) };
      if (index === -1) progress.push(entry);
      else progress[index] = entry;
    };
    try {
      const result = await this.pipeline.generate(input, update);
      this.jobs.set(id, { id, progress, status: 'completed', result });
    } catch (error) {
      this.logger.error(`生成任务 ${id} 失败`, error instanceof Error ? error.stack : undefined);
      const active = progress.find(item => item.status === 'running');
      if (active) update({ key: active.key, status: 'failed', detail: `${active.detail} · 服务端执行中断` });
      this.jobs.set(id, { id, progress, status: 'failed', message: active ? '方案生成中断，请查看生成进度' : '方案任务初始化失败，请重试' });
    } finally {
      setTimeout(() => this.jobs.delete(id), RESULT_RETENTION_MS).unref();
    }
  }
}
