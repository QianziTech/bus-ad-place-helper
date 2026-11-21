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
export class PlanSuccessDto {
  @ApiProperty({ enum: ['ok'] }) status!: 'ok';
  @ApiProperty({ type: CreatePlanDto }) request!: CreatePlanDto;
  @ApiProperty({ type: ClientDto }) client!: ClientDto;
  @ApiProperty({ type: CampaignDto }) campaign!: CampaignDto;
  @ApiProperty({ type: [PlanLineDto] }) lines!: PlanLineDto[];
  @ApiProperty({ minimum: 0, exclusiveMinimum: true }) billingMonths!: number;
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
}
export class BudgetDto {
  @ApiProperty({ example: 1000000 }) minYuan!: number;
  @ApiProperty({ example: 5000000 }) maxYuan!: number;
  @ApiProperty({ type: [Number], example: [1000000, 2000000, 5000000] }) presetsYuan!: number[];
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
