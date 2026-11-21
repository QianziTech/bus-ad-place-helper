import { BadRequestException, Body, Controller, Get, Header, HttpCode, Param, Post } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBadRequestResponse, ApiExtraModels, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, getSchemaPath } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Campaign, PlanSuccess } from '../shared/contracts';
import { CreatePlanDto, CampaignDto } from '../engine/dto/create-plan.dto';
import { PlanFailureDto } from '../engine/dto/plan-response.dto';
import { PlanPipelineService } from '../shared/pipeline/plan-pipeline.service';
import { PlanJobService } from '../shared/pipeline/plan-job.service';
import { BriefService } from './brief.service';
import { StrategyService } from './strategy.service';
import { CopyService } from './copy.service';
import { VerifyService } from './verify.service';
import { BriefResultDto, BriefSamplesDto, CopyPlanDto, CopyResultDto, ParseBriefDto, PipelineSuccessDto, StrategyRequestDto, StrategyResultDto, VerifyPlanDto, VerifyResultDto,
  BriefDisabledDto, BriefUnavailableDto, StrategyDisabledDto, StrategyUnavailableDto, CopyDisabledDto, CopyUnavailableDto, VerifyDisabledDto, VerifyUnavailableDto,
  pipelineResultSchema, PlanJobAcceptedDto, PlanJobDto } from './dto/analysis.dto';

const response = (success: typeof BriefResultDto | typeof CopyResultDto | typeof StrategyResultDto | typeof VerifyResultDto) => {
  const disabled = success === BriefResultDto ? BriefDisabledDto : success === CopyResultDto ? CopyDisabledDto : success === StrategyResultDto ? StrategyDisabledDto : VerifyDisabledDto;
  const unavailable = success === BriefResultDto ? BriefUnavailableDto : success === CopyResultDto ? CopyUnavailableDto : success === StrategyResultDto ? StrategyUnavailableDto : VerifyUnavailableDto;
  return { oneOf: [{ $ref: getSchemaPath(success) }, { $ref: getSchemaPath(disabled) }, { $ref: getSchemaPath(unavailable) }] };
};
const strings = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === 'string');

export function assertPlan(plan: PlanSuccess, campaign?: Campaign): void {
  const invalid = () => { throw new BadRequestException('plan 必须为有效的已成案结果，包含请求、客户、Campaign、媒体明细和排期'); };
  if (!plan || plan.status !== 'ok' || !plan.request || !plan.client || !plan.campaign || !plan.schedule || !Array.isArray(plan.lines) || !plan.lines.length) invalid();
  if (validateSync(plainToInstance(CreatePlanDto, plan.request)).length || validateSync(plainToInstance(CampaignDto, plan.campaign)).length || (campaign && validateSync(plainToInstance(CampaignDto, campaign)).length)) invalid();
  if (!['code', 'alias', 'category', 'scale'].every(field => typeof plan.client[field as keyof typeof plan.client] === 'string')) invalid();
  if (![plan.totalYuan, plan.remainingYuan].every(value => Number.isSafeInteger(value) && value >= 0) || typeof plan.queriedAt !== 'string' || !Number.isFinite(plan.billingMonths) || plan.billingMonths <= 0) invalid();
  if (!strings(plan.assumptions) || !strings(plan.notices) || !Array.isArray(plan.trace) || !Array.isArray(plan.schedule.batches) || !['ok', 'unavailable', 'capacity_short'].includes(plan.schedule.status)) invalid();
  for (const line of plan.lines) {
    if (!line || typeof line.mediaKey !== 'string' || typeof line.name !== 'string' || !['bus', 'metro'].includes(line.kind) || !strings(line.evidenceRefs) || !strings(line.reasons) || !strings(line.sources) ||
      ![line.quantity, line.freeCount, line.monthlyLowYuan, line.monthlyHighYuan, line.productionYuan, line.unitEstimateYuan, line.lineTotalYuan].every(value => Number.isSafeInteger(value) && value >= 0)) invalid();
  }
  for (const batch of plan.schedule.batches) if (!batch || typeof batch.publishStartDate !== 'string' || !Number.isInteger(batch.quantity) || !strings(batch.mediaKeys)) invalid();
}

@ApiTags('analysis')
@ApiExtraModels(BriefResultDto, StrategyResultDto, CopyResultDto, VerifyResultDto, BriefDisabledDto, BriefUnavailableDto, StrategyDisabledDto, StrategyUnavailableDto, CopyDisabledDto, CopyUnavailableDto, VerifyDisabledDto, VerifyUnavailableDto, PipelineSuccessDto, PlanFailureDto)
@ApiBadRequestResponse({ description: '请求参数无效或需求原文包含实名、成交价' })
@Controller()
export class AnalysisController {
  constructor(private readonly brief: BriefService, private readonly strategy: StrategyService, private readonly copy: CopyService, private readonly verify: VerifyService,
    private readonly pipeline: PlanPipelineService, private readonly jobs: PlanJobService) {}
  @Get('brief/samples') @ApiTags('brief') @ApiOperation({ operationId: 'getBriefSamples', summary: '读取与 mock 回放同源的五行业参考需求' }) @ApiOkResponse({ type: BriefSamplesDto })
  samples() { return this.brief.samples(); }
  @Post('brief/parse') @HttpCode(200) @ApiTags('brief') @ApiOperation({ operationId: 'parseBrief', summary: '拆解脱敏需求，仅保留原文明示字段' }) @ApiOkResponse({ schema: response(BriefResultDto) })
  parse(@Body() body: ParseBriefDto) { return this.brief.parse(body.text, body.industry); }
  @Post('plan/strategy') @HttpCode(200) @ApiOperation({ operationId: 'recommendStrategy', summary: '基于可行候选与媒体证据给出偏好' }) @ApiOkResponse({ schema: response(StrategyResultDto) })
  async recommend(@Body() body: StrategyRequestDto) { const { rejected: _rejected, requestedCount: _requested, ...result } = await this.strategy.recommend(body); return result; }
  @Post('plan/copy') @HttpCode(200) @ApiOperation({ operationId: 'composeCopy', summary: '生成提案文案，缺失槽位使用模板' }) @ApiOkResponse({ schema: response(CopyResultDto) })
  compose(@Body() body: CopyPlanDto) { assertPlan(body.plan, body.campaign); return this.copy.compose(body.plan, body.campaign, body.checks); }
  @Post('plan/verify') @HttpCode(200) @ApiOperation({ operationId: 'verifyPlan', summary: '核验成案并扫描文案及导出正文，返回导出许可' }) @ApiOkResponse({ schema: response(VerifyResultDto) })
  check(@Body() body: VerifyPlanDto) { assertPlan(body.plan, body.campaign); return this.verify.verify(body.plan, body.campaign, body.copy, body.exportText); }
  @Post('plan/generate') @HttpCode(200) @ApiOperation({ operationId: 'generatePlanPipeline', summary: '一次执行候选、策略、成案、文案、核验五阶段' })
  @ApiOkResponse({ schema: pipelineResultSchema })
  generate(@Body() body: CreatePlanDto) { return this.pipeline.generate(body); }
  @Post('plan/jobs') @HttpCode(202) @ApiOperation({ operationId: 'startPlanJob', summary: '提交后台成案任务' })
  @ApiAcceptedResponse({ type: PlanJobAcceptedDto })
  startJob(@Body() body: CreatePlanDto): PlanJobAcceptedDto { return this.jobs.start(body); }
  @Get('plan/jobs/:id') @Header('Cache-Control', 'no-store') @ApiOperation({ operationId: 'getPlanJob', summary: '读取成案任务状态及结果' })
  @ApiOkResponse({ type: PlanJobDto }) @ApiNotFoundResponse({ description: '任务不存在或已过期' })
  getJob(@Param('id') id: string): PlanJobDto { return this.jobs.get(id); }
}
