import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsString, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';

export class LlmConfigInputDto {
  @ApiProperty({ required: false, example: 'compatible' }) @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(80) provider?: string;
  @ApiProperty({ required: false, example: 'https://api.openai.com/v1' }) @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(2048) baseUrl?: string;
  @ApiProperty({ required: false, example: 'configured-model' }) @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(200) model?: string;
  @ApiProperty({ required: false, example: 8000, minimum: 100, maximum: 8000 }) @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(100) @Max(8000) timeoutMs?: number;
  @ApiProperty({ required: false, example: 1, minimum: 0, maximum: 1 }) @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(0) @Max(1) retries?: number;
  @ApiProperty({ required: false, example: 0.2, minimum: 0, maximum: 2 }) @ValidateIf((_object, value) => value !== undefined) @IsNumber() @Min(0) @Max(2) temperature?: number;
  @ApiHideProperty() @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(4096) apiKey?: string;
}
export class PutConfigDto {
  @ApiProperty({ required: false, enum: ['off', 'mock', 'live'], example: 'mock' }) @ValidateIf((_object, value) => value !== undefined) @IsIn(['off', 'mock', 'live']) mode?: 'off' | 'mock' | 'live';
  @ApiProperty({ required: false, type: LlmConfigInputDto, example: { model: 'configured-model' } }) @ValidateIf((_object, value) => value !== undefined) @IsObject() @ValidateNested() @Type(() => LlmConfigInputDto) llm?: LlmConfigInputDto;
  @ApiProperty({ required: false, example: true }) @ValidateIf((_object, value) => value !== undefined) @IsBoolean() includeHistoricalProfiles?: boolean;
}
export class PublicLlmConfigDto {
  @ApiProperty({ example: 'compatible' }) provider!: string;
  @ApiProperty({ example: 'https://api.openai.com/v1' }) baseUrl!: string;
  @ApiProperty({ example: 'configured-model' }) model!: string;
  @ApiProperty({ example: 8000, minimum: 100, maximum: 8000 }) timeoutMs!: number;
  @ApiProperty({ example: 1, minimum: 0, maximum: 1 }) retries!: number;
  @ApiProperty({ example: 0.2 }) temperature!: number;
  @ApiProperty({ example: true }) hasKey!: boolean;
  @ApiProperty({ example: '****abcd' }) keyPreview!: string;
}
export class PublicConfigDto {
  @ApiProperty({ enum: ['off', 'mock', 'live'], example: 'mock' }) mode!: string;
  @ApiProperty({ type: PublicLlmConfigDto }) llm!: PublicLlmConfigDto;
  @ApiProperty({ example: true }) includeHistoricalProfiles!: boolean;
  @ApiProperty({ example: '2026-11-21T00:00:00.000Z' }) updatedAt!: string;
  @ApiProperty({ enum: ['file', 'environment'], example: 'file' }) source!: string;
}
export class FixtureCoverageDto {
  @ApiProperty({ example: 5 }) covered!: number;
  @ApiProperty({ example: 5 }) total!: number;
}
export class ConfigTestSuccessDto {
  @ApiProperty({ enum: [true], example: true }) ok!: boolean;
  @ApiProperty({ required: false, example: 100 }) latencyMs?: number;
  @ApiProperty({ required: false, example: 'configured-model' }) modelEcho?: string;
  @ApiProperty({ required: false, type: FixtureCoverageDto }) fixtures?: FixtureCoverageDto;
}
export class ConfigTestFailureDto {
  @ApiProperty({ enum: [false], example: false }) ok!: boolean;
  @ApiProperty({ enum: ['disabled', 'unavailable'], example: 'unavailable' }) code!: string;
  @ApiProperty({ example: '模型连接不可用' }) message!: string;
}
