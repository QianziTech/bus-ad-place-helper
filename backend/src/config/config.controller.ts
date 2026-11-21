import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiBadRequestResponse, ApiExtraModels, ApiOkResponse, ApiOperation, ApiTags, getSchemaPath } from '@nestjs/swagger';
import { RuntimeConfigService } from './runtime-config.service';
import { LlmClient, failureReason } from '../analysis/llm.client';
import { FIXTURE_INDUSTRIES } from '../analysis/prompts/__fixtures__/fixtures';
import { ConfigTestFailureDto, ConfigTestSuccessDto, PublicConfigDto, PutConfigDto } from './config.dto';

@ApiTags('config')
@ApiExtraModels(ConfigTestSuccessDto, ConfigTestFailureDto)
@Controller('config')
export class ConfigController {
  constructor(private readonly config: RuntimeConfigService, private readonly llm: LlmClient) {}
  @Get() @ApiOperation({ operationId: 'getConfig', summary: '读取运行配置（密钥只返回掩码）' }) @ApiOkResponse({ type: PublicConfigDto })
  get() { return this.config.publicConfig(); }
  @Put() @ApiOperation({ operationId: 'putConfig', summary: '原子保存并热应用运行配置' }) @ApiOkResponse({ type: PublicConfigDto }) @ApiBadRequestResponse({ description: '配置参数无效' })
  put(@Body() input: PutConfigDto) { return this.config.update(input); }
  @Post('test') @HttpCode(200) @ApiOperation({ operationId: 'testConfig', summary: '测试当前模型连接或离线样例覆盖' })
  @ApiOkResponse({ schema: { oneOf: [{ $ref: getSchemaPath(ConfigTestSuccessDto) }, { $ref: getSchemaPath(ConfigTestFailureDto) }] } })
  async test() {
    const context = this.config.context();
    if (context.mode === 'off') return { ok: false, code: 'disabled', message: '分析模式已关闭' };
    if (context.mode === 'mock') return { ok: true, fixtures: { covered: FIXTURE_INDUSTRIES.length, total: 5 } };
    const started = Date.now();
    try {
      await this.llm.complete('brief.parse', context, '[客户]\n{}\n[活动]\n{"briefText":"连接测试，请返回空 campaignDraft"}\n[候选]\n\n[约束]\n{}', () => ({}));
      return { ok: true, latencyMs: Date.now() - started, modelEcho: context.config.llm.model };
    } catch (error) { return { ok: false, code: 'unavailable', message: failureReason(error) }; }
  }
}
