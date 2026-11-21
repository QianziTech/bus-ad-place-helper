import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CampaignDto, CreatePlanDto, StrategyPreferenceDto } from './create-plan.dto';
import { PlanFailure } from '../../shared/contracts';

export class ClientDto {
  @ApiProperty({ example: 'F1' }) code!: string;
  @ApiProperty({ example: '某全国性饮用水品牌' }) alias!: string;
  @ApiProperty() category!: string;
  @ApiProperty() scale!: string;
  @ApiPropertyOptional() channelNote?: string;
}
export class AgeGroupDto {
  @ApiProperty() label!: string;
  @ApiProperty({ minimum: 0, maximum: 100 }) percent!: number;
}
export class TrafficReferenceDto {
  @ApiProperty({ example: '2023-05' }) period!: string;
  @ApiProperty() source!: string;
  @ApiPropertyOptional({ minimum: 0 }) coveragePv?: number;
  @ApiPropertyOptional({ type: [AgeGroupDto] }) ageGroups?: AgeGroupDto[];
}
export class AnchorSummaryDto {
  @ApiProperty({ example: 'food-人民广场' }) id!: string;
  @ApiProperty({ example: '人民广场 · 南京东路商圈' }) areaName!: string;
  @ApiProperty({ example: '人民广场' }) station!: string;
  @ApiProperty({ enum: ['businessArea', 'landmark'] }) role!: string;
  @ApiProperty({ example: '全市地铁换乘量最大的口，通勤与游客叠加' }) rationale!: string;
  @ApiProperty({ description: '覆盖模块给出的候选数，不代表当前可售量', example: { bus: 17, metro: 9 } }) candidateCounts!: { bus: number; metro: number };
}
export class PlanAnchorDto extends AnchorSummaryDto {
  @ApiProperty({ minimum: 0, description: '本方案选中且命中该锚点的媒体数；同一媒体命中多个锚点时各锚点分别计数', example: 2 }) selectedCount!: number;
}
export class TrajectoryDto {
  @ApiProperty({ enum: ['GCJ02'], description: '坐标系；BD09 源数据已转换' }) crs?: string;
  @ApiPropertyOptional({ minimum: 0, description: '线路里程，公里（按轨迹逐段累加）' }) lengthKm?: number;
  @ApiProperty({ description: '[经度, 纬度] 数组，已按 12 m 容差简化，不用于优于 50 m 的测距', example: [[121.4894, 31.2453], [121.4894, 31.2443]] })
  polyline!: number[][];
}
export class PlanLineDto {
  @ApiProperty() mediaKey!: string;
  @ApiProperty({ enum: ['bus', 'metro'] }) kind!: 'bus' | 'metro';
  @ApiProperty() name!: string;
  @ApiProperty() levelName!: string;
  @ApiPropertyOptional() mediaForm?: string;
  @ApiPropertyOptional() exit?: string;
  @ApiPropertyOptional({ minimum: 0 }) total?: number;
  @ApiProperty({ minimum: 1 }) freeCount!: number;
  @ApiPropertyOptional({ minimum: 0 }) contractCount?: number;
  @ApiPropertyOptional({ minimum: 0 }) reservedCount?: number;
  @ApiProperty({ description: '单位月刊例下限，元', minimum: 0 }) monthlyLowYuan!: number;
  @ApiProperty({ description: '单位月刊例上限，元', minimum: 0 }) monthlyHighYuan!: number;
  @ApiProperty({ description: '本行全部数量的一次性制作费，元', minimum: 0 }) productionYuan!: number;
  @ApiProperty({ description: '单位估算，含完整档期月价与单位制作费，元', minimum: 1 }) unitEstimateYuan!: number;
  @ApiProperty({ minimum: 1 }) quantity!: number;
  @ApiProperty({ description: 'quantity × unitEstimateYuan，元', minimum: 1 }) lineTotalYuan!: number;
  @ApiProperty({ type: [String] }) evidenceRefs!: string[];
  @ApiProperty({ type: [String] }) reasons!: string[];
  @ApiProperty({ type: [String] }) sources!: string[];
  @ApiPropertyOptional({ type: TrafficReferenceDto }) trafficReference?: TrafficReferenceDto;
  @ApiPropertyOptional({ type: TrajectoryDto, description: '线路走向；同线路不同媒体形式共用一份' }) trajectory?: TrajectoryDto;
  @ApiPropertyOptional() preferredByAi?: boolean;
}
export class ScheduleBatchDto {
  @ApiProperty({ minimum: 1 }) no!: number;
  @ApiProperty({ format: 'date' }) nightDate!: string;
  @ApiProperty({ type: [String] }) mediaKeys!: string[];
  @ApiProperty({ minimum: 1 }) quantity!: number;
  @ApiProperty({ minimum: 1 }) cumulative!: number;
  @ApiProperty({ format: 'date', description: '该批施工照次日 08:00 起算的日期' }) publishStartDate!: string;
  @ApiProperty({ type: String, nullable: true }) risk!: string | null;
}
export class ScheduleDto {
  @ApiProperty({ enum: ['ok', 'unavailable', 'capacity_short'] }) status!: string;
  @ApiProperty({ minimum: 1 }) singleNightCap!: number;
  @ApiProperty({ type: [ScheduleBatchDto] }) batches!: ScheduleBatchDto[];
  @ApiProperty({ minimum: 0 }) rainBufferNights!: number;
  @ApiProperty({ minimum: 0 }) compensationBufferQty!: number;
  @ApiProperty({ type: [String] }) notes!: string[];
  @ApiProperty({ type: [String] }) assumptions!: string[];
}
export class TraceStepDto {
  @ApiProperty() step!: string;
  @ApiProperty() message!: string;
  @ApiPropertyOptional({ type: [String] }) evidenceRefs?: string[];
  @ApiPropertyOptional({ minimum: 0 }) elapsedMs?: number;
}
export class AppliedStrategyPreferenceDto extends StrategyPreferenceDto {
  @ApiProperty({ enum: ['accepted', 'rejected:unknown_media', 'rejected:no_stock', 'rejected:over_budget', 'rejected:premium_exceeded', 'rejected:invalid_evidence'] }) disposition!: string;
}
export class InventoryKindStatusDto {
  @ApiProperty({ enum: ['bus', 'metro'] }) kind!: 'bus' | 'metro';
  @ApiProperty({ enum: ['hongdou', 'archive', 'snapshot', 'missing'], example: 'hongdou', description: '该媒体本次库存来源' }) source!: string;
  @ApiProperty({ example: '红豆实时查询' }) sourceLabel!: string;
  @ApiPropertyOptional({ format: 'date-time', description: '实时或归档的实际查询时间，周截面来源省略' }) queriedAt?: string;
  @ApiPropertyOptional({ format: 'date', isArray: true, description: '周截面参考参与的周一采样日期' }) sampleDates?: string[];
  @ApiProperty({ type: Number, nullable: true, description: '已确认计费月数；周截面或待核对时为 null' }) billingMonths!: number | null;
  @ApiPropertyOptional({ description: '回退或待核对的原因' }) reason?: string;
}
export class InventoryPreviewRowDto {
  @ApiProperty() mediaKey!: string;
  @ApiProperty({ enum: ['bus', 'metro'] }) kind!: 'bus' | 'metro';
  @ApiProperty() name!: string;
  @ApiProperty() levelName!: string;
  @ApiPropertyOptional() mediaForm?: string;
  @ApiPropertyOptional() exit?: string;
  @ApiProperty({ type: Number, nullable: true, description: '可用采样日的最小空位数；缺样为 null' }) freeCount!: number | null;
  @ApiPropertyOptional({ format: 'date', isArray: true }) sampleDates?: string[];
}
export class InventoryDetailDto {
  @ApiProperty({ format: 'date' }) startDate!: string;
  @ApiProperty({ format: 'date' }) endDate!: string;
  @ApiProperty({ type: Number, nullable: true }) billingMonths!: number | null;
  @ApiProperty({ enum: ['confirmed', 'pending'], description: '计费口径是否已确认' }) billingStatus!: string;
  @ApiProperty({ type: [InventoryKindStatusDto] }) kinds!: InventoryKindStatusDto[];
  @ApiPropertyOptional({ type: [InventoryPreviewRowDto], description: '存在周截面参考时返回可售空位参考值，仅用于库存预览' }) preview?: InventoryPreviewRowDto[];
}
export class PlanSuccessDto {
  @ApiProperty({ enum: ['ok'] }) status!: 'ok';
  @ApiProperty({ type: CreatePlanDto }) request!: CreatePlanDto;
  @ApiProperty({ type: ClientDto }) client!: ClientDto;
  @ApiProperty({ type: CampaignDto }) campaign!: CampaignDto;
  @ApiProperty({ type: [PlanLineDto] }) lines!: PlanLineDto[];
  @ApiProperty({ type: [PlanAnchorDto], description: '本轮参与选点的锚点及各锚点的选中数' }) anchors!: PlanAnchorDto[];
  @ApiProperty({ minimum: 0, exclusiveMinimum: true }) billingMonths!: number;
  @ApiProperty({ enum: ['confirmed', 'pending'], description: '计费口径是否已确认；pending 时报价为按 1 个计费月的参考估算' }) billingStatus!: string;
  @ApiProperty({ type: InventoryDetailDto, description: '本次库存来源、查询时间与计费口径' }) inventory!: InventoryDetailDto;
  @ApiProperty({ minimum: 0 }) totalYuan!: number;
  @ApiProperty({ minimum: 0 }) remainingYuan!: number;
  @ApiProperty({ format: 'date-time' }) queriedAt!: string;
  @ApiProperty({ type: ScheduleDto }) schedule!: ScheduleDto;
  @ApiProperty({ type: [String] }) assumptions!: string[];
  @ApiProperty({ type: [String] }) notices!: string[];
  @ApiProperty({ type: [TraceStepDto] }) trace!: TraceStepDto[];
  @ApiPropertyOptional({ type: [AppliedStrategyPreferenceDto] }) strategyPreferences?: AppliedStrategyPreferenceDto[];
}
export class PlanFailureDto {
  @ApiProperty({ enum: ['missing_window', 'missing_data', 'no_inventory', 'over_budget'] }) status!: PlanFailure['status'];
  @ApiProperty() message!: string;
  @ApiProperty({ type: [String] }) suggestions!: string[];
  @ApiPropertyOptional({ type: InventoryDetailDto, description: '库存来源与周截面参考；缺整段库存时随失败返回' }) inventory?: InventoryDetailDto;
}
export class MissingWindowDto extends PlanFailureDto { @ApiProperty({ enum: ['missing_window'] }) declare status: 'missing_window'; }
export class MissingDataDto extends PlanFailureDto { @ApiProperty({ enum: ['missing_data'] }) declare status: 'missing_data'; }
export class NoInventoryDto extends PlanFailureDto { @ApiProperty({ enum: ['no_inventory'] }) declare status: 'no_inventory'; }
export class OverBudgetDto extends PlanFailureDto { @ApiProperty({ enum: ['over_budget'] }) declare status: 'over_budget'; }
export class MetaIndustryDto {
  @ApiProperty({ enum: ['food', 'finance', 'health', 'hospital', 'park'] }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: ClientDto }) client!: ClientDto;
  @ApiProperty({ type: CampaignDto }) campaign!: CampaignDto;
  @ApiProperty({ type: [AnchorSummaryDto], description: '该行业全部锚点，用于切换行业后的预览；候选数为覆盖口径' }) anchors!: AnchorSummaryDto[];
}
export class BudgetDto {
  @ApiProperty({ example: 1000000 }) minYuan!: number;
  @ApiProperty({ example: 5000000 }) maxYuan!: number;
  @ApiProperty({ example: 10000, description: '滑块步长，元' }) stepYuan!: number;
  @ApiProperty({ type: [Number], example: [1000000, 2000000, 5000000] }) presetsYuan!: number[];
  @ApiPropertyOptional({ example: 2000000, description: '默认展示金额；建议金额不可成案时为最近可行金额。仅全区间生成结果带此字段' }) defaultYuan?: number;
}
export class InventoryDatesDto {
  @ApiProperty({ format: 'date' }) startDate!: string;
  @ApiProperty({ format: 'date' }) endDate!: string;
}
export class MetaDto {
  @ApiProperty({ type: [MetaIndustryDto] }) industries!: MetaIndustryDto[];
  @ApiProperty({ enum: ['bus', 'metro'], isArray: true }) media!: string[];
  @ApiProperty({ type: BudgetDto }) budget!: BudgetDto;
  @ApiProperty({ type: [InventoryDatesDto] }) windows!: InventoryDatesDto[];
}
