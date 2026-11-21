import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiExtension, ApiExtraModels, ApiOkResponse, ApiOperation, ApiTags, getSchemaPath } from '@nestjs/swagger';
import { EngineService } from './engine.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { RuntimeConfigService } from '../config/runtime-config.service';
import { InventoryService } from '../inventory/inventory.service';
import { MetaDto, MissingDataDto, MissingWindowDto, NoInventoryDto, OverBudgetDto, PlanSuccessDto } from './dto/plan-response.dto';

@ApiTags('engine')
@ApiExtraModels(PlanSuccessDto, MissingWindowDto, MissingDataDto, NoInventoryDto, OverBudgetDto)
@Controller()
export class PlanController {
  constructor(private readonly engine: EngineService, private readonly config: RuntimeConfigService, private readonly inventory: InventoryService) {}

  @Get('meta')
  @ApiOperation({ operationId: 'getMeta', summary: '读取行业预置、预算范围与完整库存档期' })
  @ApiOkResponse({ type: MetaDto })
  getMeta() { return this.engine.getMeta(); }

  @Post('plan') @HttpCode(200)
  @ApiOperation({ operationId: 'generatePlan', summary: '生成确定性方案或按已确认策略重算' })
  @ApiExtension('x-evidence-refs', 'required')
  @ApiOkResponse({ schema: { oneOf: [PlanSuccessDto, MissingWindowDto, MissingDataDto, NoInventoryDto, OverBudgetDto].map(dto => ({ $ref: getSchemaPath(dto) })) } })
  async generate(@Body() request: CreatePlanDto) {
    // 与 /api/plan/generate 共用同一库存解析入口：实时查询失败时回退同区间归档或周截面参考。
    const planRequest = this.config.snapshot().mode === 'off' ? { ...request, strategyPreferences: [] } : request;
    const pool = this.engine.getCandidates(planRequest, false, await this.inventory.resolve(request));
    return pool.status === 'ok' ? this.engine.generate(planRequest, pool) : pool;
  }
}
