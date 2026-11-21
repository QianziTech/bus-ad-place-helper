import { ApiProperty, getSchemaPath, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Campaign, Check, INDUSTRIES, IndustryId, PipelineSuccess, PlanCopy, PlanFailure, PlanSuccess } from '../../shared/contracts';
import { CampaignDto, CampaignOverrideDto, CreatePlanDto, StrategyPreferenceDto } from '../../engine/dto/create-plan.dto';
import { PlanFailureDto, PlanSuccessDto } from '../../engine/dto/plan-response.dto';

export class ParseBriefDto {
  @ApiProperty({ example: '客户：某饮料品牌；主目标：认知；人群：通勤人群；媒体：公交', maxLength: 2000 }) @IsString() @MinLength(1) @MaxLength(2000) text!: string;
  @ApiProperty({ required: false, enum: INDUSTRIES, example: 'food' }) @IsOptional() @IsIn(INDUSTRIES) industry?: IndustryId;
}
export class CheckDto {
  @ApiProperty({ example: '⑤' }) element!: string;
  @ApiProperty({ enum: ['pass', 'warn', 'fail'], example: 'pass' }) status!: string;
  @ApiProperty({ example: '预算与库存未超过上限' }) message!: string;
  @ApiProperty({ type: [String], example: ['rule:budget'] }) evidenceRefs!: string[];
  @ApiProperty({ required: false, example: false }) blocking?: boolean;
  @ApiProperty({ required: false, example: 'copy.headline' }) location?: string;
  @ApiProperty({ required: false, example: '请使用客户代称' }) suggestion?: string;
}
export class CopyDto {
  @ApiProperty({ example: '让清凉走进通勤日常' }) headline!: string;
  @ApiProperty({ example: '客户背景与活动目标为提案假设。' }) brandContext!: string;
  @ApiProperty({ example: '围绕已核对的目标场景组织媒体分工。' }) strategyLine!: string;
  @ApiProperty({ example: '选择依据见媒体证据。' }) selectionRationale!: string;
  @ApiProperty({ example: '客户与目标沿用假设书，预算按请求上限。' }) assumptionEcho!: string;
  @ApiProperty({ enum: ['llm', 'mock', 'template'], example: 'template' }) source!: string;
}
export class PlanAnalysisDto {
  @ApiProperty({ type: PlanSuccessDto }) @IsObject() plan!: PlanSuccess;
  @ApiProperty({ required: false, type: CampaignDto }) @IsOptional() @IsObject() @ValidateNested() @Type(() => CampaignDto) campaign?: Campaign;
}
export class CopyPlanDto extends PlanAnalysisDto {
  @ApiProperty({ required: false, type: [CheckDto], example: [] }) @IsOptional() @IsArray() checks?: Check[];
}
export class VerifyPlanDto extends PlanAnalysisDto {
  @ApiProperty({ required: false, type: CopyDto }) @IsOptional() @IsObject() copy?: Partial<PlanCopy>;
  @ApiProperty({ required: false, example: '某客户的媒体提案正文', maxLength: 200000 }) @IsOptional() @IsString() @MaxLength(200000) exportText?: string;
}
export class TraceDto {
  @ApiProperty({ example: 'verify.scan' }) step!: string;
  @ApiProperty({ example: '已执行确定性扫描' }) message!: string;
  @ApiProperty({ required: false, type: [String], example: ['rule:real-name'] }) evidenceRefs?: string[];
  @ApiProperty({ required: false, example: 50 }) elapsedMs?: number;
}
export class BriefResultDto {
  @ApiProperty({ enum: ['ok'], example: 'ok' }) status!: string;
  @ApiProperty({ type: CampaignOverrideDto }) campaignDraft!: CampaignOverrideDto;
  @ApiProperty({ type: [String], example: ['⑤ 时间与预算'] }) missing!: string[];
  @ApiProperty({ example: 0.71, minimum: 0, maximum: 1 }) confidence!: number;
  @ApiProperty({ type: [TraceDto] }) trace!: TraceDto[];
}
export class WindowFitDto {
  @ApiProperty({ enum: ['aligned', 'risk', 'unknown'], example: 'unknown' }) status!: string;
  @ApiProperty({ example: '实际发布起算日需成案后核对' }) reason!: string;
  @ApiProperty({ type: [String], example: ['campaign:F1-C1:window'] }) evidenceRefs!: string[];
}
export class MeasurementDto {
  @ApiProperty({ example: '到店量' }) kpi!: string;
  @ApiProperty({ example: '上下刊照片' }) proof!: string;
}
export class StrategyResultDto {
  @ApiProperty({ enum: ['ok'], example: 'ok' }) status!: string;
  @ApiProperty({ type: [StrategyPreferenceDto] }) strategyPreferences!: StrategyPreferenceDto[];
  @ApiProperty({ example: '围绕目的地覆盖支持活动响应' }) mediaObjective!: string;
  @ApiProperty({ example: false }) requestReplan!: boolean;
  @ApiProperty({ required: false, example: '本轮候选集中在同一锚点' }) replanReason?: string;
  @ApiProperty({ required: false, type: WindowFitDto }) windowFit?: WindowFitDto;
  @ApiProperty({ required: false, type: MeasurementDto }) measurement?: MeasurementDto;
}
export class CopyResultDto {
  @ApiProperty({ enum: ['ok'], example: 'ok' }) status!: string;
  @ApiProperty({ type: CopyDto }) copy!: CopyDto;
  @ApiProperty({ required: false, example: '缺失槽位已回退模板' }) reason?: string;
}
export class VerifyResultDto {
  @ApiProperty({ enum: ['ok'], example: 'ok' }) status!: string;
  @ApiProperty({ type: [CheckDto] }) checks!: CheckDto[];
  @ApiProperty({ example: '确定性扫描未发现阻断项' }) summary!: string;
  @ApiProperty({ type: [TraceDto] }) trace!: TraceDto[];
  @ApiProperty({ example: true }) exportAllowed!: boolean;
}
export class BriefDisabledDto extends BriefResultDto { @ApiProperty({ enum: ['disabled'], example: 'disabled' }) declare status: string; }
export class BriefUnavailableDto extends BriefResultDto { @ApiProperty({ enum: ['unavailable'], example: 'unavailable' }) declare status: string; }
export class StrategyDisabledDto extends StrategyResultDto { @ApiProperty({ enum: ['disabled'], example: 'disabled' }) declare status: string; }
export class StrategyUnavailableDto extends StrategyResultDto {
  @ApiProperty({ enum: ['unavailable'], example: 'unavailable' }) declare status: string;
  @ApiProperty({ example: '模型请求超时' }) reason!: string;
}
export class CopyDisabledDto extends CopyResultDto { @ApiProperty({ enum: ['disabled'], example: 'disabled' }) declare status: string; }
export class CopyUnavailableDto extends CopyResultDto { @ApiProperty({ enum: ['unavailable'], example: 'unavailable' }) declare status: string; }
export class VerifyDisabledDto extends VerifyResultDto { @ApiProperty({ enum: ['disabled'], example: 'disabled' }) declare status: string; }
export class VerifyUnavailableDto extends VerifyResultDto {
  @ApiProperty({ enum: ['unavailable'], example: 'unavailable' }) declare status: string;
  @ApiProperty({ example: '模型请求超时' }) reason!: string;
}
export class BriefSampleDto {
  @ApiProperty({ enum: INDUSTRIES, example: 'food' }) industry!: string;
  @ApiProperty({ example: '食品饮料 · 夏季铺市' }) title!: string;
  @ApiProperty({ example: '客户：某全国性饮用水品牌；主目标：促销' }) text!: string;
}
export class BriefSamplesDto { @ApiProperty({ type: [BriefSampleDto] }) samples!: BriefSampleDto[]; }
export class RoundDto {
  @ApiProperty({ example: 1, maximum: 2 }) round!: number;
  @ApiProperty({ example: 20 }) candidateCount!: number;
  @ApiProperty({ example: 8 }) preferredCount!: number;
  @ApiProperty({ example: 6 }) acceptedCount!: number;
  @ApiProperty({ type: 'array', items: { type: 'object', properties: { mediaKey: { type: 'string' }, reason: { type: 'string', enum: ['unknown_media', 'no_stock', 'over_budget', 'premium_exceeded', 'invalid_evidence'] } } }, example: [] }) rejected!: object[];
  @ApiProperty({ example: false }) requestReplan!: boolean;
  @ApiProperty({ example: 10 }) elapsedMs!: number;
}
export class DegradedDto {
  @ApiProperty({ enum: ['brief', 'strategy', 'copy', 'verify'], example: 'copy' }) stage!: string;
  @ApiProperty({ example: '模型请求超时' }) reason!: string;
}
export class PipelineSuccessDto extends PlanSuccessDto {
  @ApiProperty({ required: false, example: '围绕已核对的目标场景组织媒体分工' }) mediaObjective?: string;
  @ApiProperty({ required: false, type: WindowFitDto }) windowFit?: WindowFitDto;
  @ApiProperty({ required: false, type: MeasurementDto }) measurement?: MeasurementDto;
  @ApiProperty({ type: CopyDto }) copy!: CopyDto;
  @ApiProperty({ type: [CheckDto] }) checks!: CheckDto[];
  @ApiProperty({ type: [RoundDto] }) rounds!: RoundDto[];
  @ApiProperty({ type: [DegradedDto] }) degraded!: DegradedDto[];
  @ApiProperty({ example: true }) exportAllowed!: boolean;
}
export const pipelineResultSchema = {
  oneOf: [
    { $ref: getSchemaPath(PipelineSuccessDto) },
    ...['missing_window', 'missing_data', 'no_inventory', 'over_budget'].map(status => ({
      allOf: [{ $ref: getSchemaPath(PlanFailureDto) }, { type: 'object' as const, properties: { status: { type: 'string' as const, enum: [status] } } }],
    })),
  ],
};
export class PlanJobAcceptedDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
}
export class PlanJobDto extends PlanJobAcceptedDto {
  @ApiProperty({ enum: ['running', 'completed', 'failed'] }) status!: 'running' | 'completed' | 'failed';
  @ApiProperty({ required: false, ...pipelineResultSchema }) result?: PipelineSuccess | PlanFailure;
  @ApiProperty({ required: false, example: '方案生成失败，请重试' }) message?: string;
}
export class StrategyRequestDto extends OmitType(CreatePlanDto, ['budgetYuan'] as const) {
  @ApiProperty({ required: false, minimum: 1000000, maximum: 5000000, example: 2000000, description: '省略时使用行业 Campaign 建议预算，仍按预算上限筛选' })
  @IsOptional() @IsInt() @Min(1000000) @Max(5000000) budgetYuan?: number;
}
