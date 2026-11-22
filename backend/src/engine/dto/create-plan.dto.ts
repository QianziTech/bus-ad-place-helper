import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsObject, IsString, Max, MaxLength, Min, Validate, ValidateIf, ValidateNested, ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';
import { Campaign, CampaignOverride, INDUSTRIES, IndustryId, MediaKind, PlanRequest, PipelineRequest, StrategyPreference } from '../../shared/contracts';
import { isPlanDate } from '../../shared/data/plan-data';

@ValidatorConstraint({ name: 'planDate', async: false })
export class PlanDateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) { return isPlanDate(value); }
  defaultMessage() { return '$property 必须是 2027 年内真实有效的 YYYY-MM-DD 日期'; }
}
@ValidatorConstraint({ name: 'dateOrder', async: false })
export class DateOrderConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments) {
    const record = args.object as Record<string, unknown>;
    const start = record[args.constraints[0]];
    return typeof start === 'string' && typeof value === 'string' && start <= value;
  }
  defaultMessage() { return '结束日期不得早于开始日期'; }
}
@ValidatorConstraint({ name: 'positiveMediaBias', async: false })
export class PositiveMediaBiasConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments) {
    const bias = args.object as { bus: number; metro: number };
    return Number.isFinite(bias.bus + bias.metro) && bias.bus + bias.metro > 0;
  }
  defaultMessage() { return '媒体权重之和必须大于 0'; }
}

export class CampaignWindowDto {
  @ApiProperty({ example: '2027-06-01', pattern: '^2027-\\d{2}-\\d{2}$' })
  @Validate(PlanDateConstraint) start!: string;

  @ApiProperty({ example: '2027-06-30', pattern: '^2027-\\d{2}-\\d{2}$' })
  @Validate(PlanDateConstraint) @Validate(DateOrderConstraint, ['start']) end!: string;
}
export class MediaBiasDto {
  @ApiProperty({ example: 0.6, minimum: 0 })
  @IsNumber({ allowInfinity: false, allowNaN: false }) @Min(0) bus!: number;

  @ApiProperty({ example: 0.4, minimum: 0 })
  @IsNumber({ allowInfinity: false, allowNaN: false }) @Min(0) @Validate(PositiveMediaBiasConstraint) metro!: number;
}
export class SuccessMetricDto {
  @ApiProperty({ example: '到店扫码量' })
  @IsString() @IsNotEmpty() @MaxLength(1000) kpi!: string;

  @ApiProperty({ example: '上下刊照片与结案报告' })
  @IsString() @IsNotEmpty() @MaxLength(1000) proof!: string;
}

export class CampaignOverrideDto implements CampaignOverride {
  @ApiPropertyOptional({ description: '活动名称', example: '夏季新品认知' })
  @ValidateIf((_o, value) => value !== undefined) @IsString() @IsNotEmpty() @MaxLength(200) name?: string;

  @ApiPropertyOptional({ description: '要解决的生意目标', example: '增加上海市场的新品认知' })
  @ValidateIf((_o, value) => value !== undefined) @IsString() @IsNotEmpty() @MaxLength(2000) businessGoal?: string;

  @ApiPropertyOptional({ enum: ['认知', '到店', '促销', '拉新'], example: '认知' })
  @ValidateIf((_o, value) => value !== undefined) @IsIn(['认知', '到店', '促销', '拉新']) primaryGoal?: Campaign['primaryGoal'];

  @ApiPropertyOptional({ example: '18–40 岁通勤人群' })
  @ValidateIf((_o, value) => value !== undefined) @IsString() @IsNotEmpty() @MaxLength(2000) audience?: string;

  @ApiPropertyOptional({ type: CampaignWindowDto })
  @ValidateIf((_o, value) => value !== undefined) @IsObject() @ValidateNested() @Type(() => CampaignWindowDto) window?: CampaignWindowDto;

  @ApiPropertyOptional({ description: '预置建议预算；本次 budgetYuan 优先', minimum: 1, example: 2000000 })
  @ValidateIf((_o, value) => value !== undefined) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) budgetHintYuan?: number;

  @ApiPropertyOptional({ enum: ['bus', 'metro'], isArray: true, minItems: 1, uniqueItems: true })
  @ValidateIf((_o, value) => value !== undefined) @IsArray() @ArrayMinSize(1) @ArrayUnique() @IsIn(['bus', 'metro'], { each: true }) mediaScope?: MediaKind[];

  @ApiPropertyOptional({ type: MediaBiasDto })
  @ValidateIf((_o, value) => value !== undefined) @IsObject() @ValidateNested() @Type(() => MediaBiasDto) mediaBias?: MediaBiasDto;

  @ApiPropertyOptional({ type: SuccessMetricDto })
  @ValidateIf((_o, value) => value !== undefined) @IsObject() @ValidateNested() @Type(() => SuccessMetricDto) successMetric?: SuccessMetricDto;

  @ApiPropertyOptional({ type: [String], example: ['客户资料均为提案假设'] })
  @ValidateIf((_o, value) => value !== undefined) @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(1000, { each: true }) constraints?: string[];
}

export class CampaignDto implements Campaign {
  @ApiProperty({ example: 'F1-C1' }) @IsString() @IsNotEmpty() id!: string;
  @ApiProperty({ example: '夏季新品认知' }) @IsString() @IsNotEmpty() name!: string;
  @ApiProperty({ example: '增加上海市场新品认知' }) @IsString() @IsNotEmpty() businessGoal!: string;
  @ApiProperty({ enum: ['认知', '到店', '促销', '拉新'], example: '认知' }) @IsIn(['认知', '到店', '促销', '拉新']) primaryGoal!: Campaign['primaryGoal'];
  @ApiProperty({ example: '通勤人群' }) @IsString() @IsNotEmpty() audience!: string;
  @ApiProperty({ type: CampaignWindowDto }) @IsObject() @ValidateNested() @Type(() => CampaignWindowDto) window!: CampaignWindowDto;
  @ApiProperty({ minimum: 1, example: 2000000 }) @IsInt() @Min(1) budgetHintYuan!: number;
  @ApiProperty({ enum: ['bus', 'metro'], isArray: true, example: ['bus', 'metro'] }) @IsArray() @ArrayMinSize(1) @ArrayUnique() @IsIn(['bus', 'metro'], { each: true }) mediaScope!: MediaKind[];
  @ApiProperty({ type: MediaBiasDto }) @IsObject() @ValidateNested() @Type(() => MediaBiasDto) mediaBias!: MediaBiasDto;
  @ApiProperty({ type: SuccessMetricDto }) @IsObject() @ValidateNested() @Type(() => SuccessMetricDto) successMetric!: SuccessMetricDto;
  @ApiProperty({ type: [String], example: ['客户背景均为提案假设'] }) @IsArray() @IsString({ each: true }) constraints!: string[];
}

export class StrategyPreferenceDto implements StrategyPreference {
  @ApiProperty({ example: 'bus|1|大三侧', description: '引擎候选媒体键' })
  @IsString() @IsNotEmpty() @MaxLength(300) mediaKey!: string;

  @ApiProperty({ example: '历史画像支持通勤人群匹配' })
  @IsString() @IsNotEmpty() @MaxLength(2000) reason!: string;

  @ApiProperty({ type: [String], description: '至少含一条本媒体覆盖或历史画像证据', minItems: 1, example: ['traffic:bus|1|大三侧:2023-05'] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsString({ each: true }) @MaxLength(500, { each: true }) evidenceRefs!: string[];
}

export class CreatePlanDto implements PlanRequest {
  @ApiProperty({ enum: INDUSTRIES, example: 'food' }) @IsIn(INDUSTRIES) industry!: IndustryId;

  @ApiProperty({ minimum: 1000000, maximum: 5000000, example: 2000000, description: '预算上限，整数元，允许余量' })
  @IsInt() @Min(1000000) @Max(5000000) budgetYuan!: number;

  @ApiProperty({ enum: ['bus', 'metro'], isArray: true, minItems: 1, uniqueItems: true, example: ['bus', 'metro'] })
  @IsArray() @ArrayMinSize(1) @ArrayUnique() @IsIn(['bus', 'metro'], { each: true }) media!: MediaKind[];

  @ApiProperty({ example: '2027-06-01', pattern: '^2027-\\d{2}-\\d{2}$' })
  @Validate(PlanDateConstraint) startDate!: string;

  @ApiProperty({ example: '2027-06-30', pattern: '^2027-\\d{2}-\\d{2}$' })
  @Validate(PlanDateConstraint) @Validate(DateOrderConstraint, ['startDate']) endDate!: string;

  @ApiPropertyOptional({ description: '已确认采用本地周截面做参考排期' })
  @ValidateIf((_o, value) => value !== undefined) @IsBoolean() acceptWeekly?: boolean;

  @ApiPropertyOptional({ type: CampaignOverrideDto, description: '只接受 Campaign 的可编辑字段，不接受客户身份或 campaign.id' })
  @ValidateIf((_o, value) => value !== undefined) @IsObject() @ValidateNested() @Type(() => CampaignOverrideDto) campaignOverride?: CampaignOverrideDto;

  @ApiPropertyOptional({ type: [StrategyPreferenceDto], description: '按业务价值排序；每次重新核对证据、库存、预算和溢价' })
  @ValidateIf((_o, value) => value !== undefined) @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => StrategyPreferenceDto) strategyPreferences?: StrategyPreferenceDto[];

  @ApiPropertyOptional({ maxLength: 2000, description: '可选需求原文，流水线解析为 Campaign；敏感文本由服务端扫描', example: '希望增加通勤人群对新品的认知。' })
  @ValidateIf((_o, value) => value !== undefined) @IsString() @MaxLength(2000) briefText?: string;
}

/** 流水线请求：省略 budgetYuan 时一次生成 100–500 万元全区间。显式给出时保持单预算契约。 */
export class GeneratePlanDto extends OmitType(CreatePlanDto, ['budgetYuan'] as const) implements PipelineRequest {
  @ApiPropertyOptional({ minimum: 1000000, maximum: 5000000, example: 2000000, description: '省略时按滑块全区间生成；给出时只算该金额' })
  @ValidateIf((_o, value) => value !== undefined) @IsInt() @Min(1000000) @Max(5000000) budgetYuan?: number;
}
