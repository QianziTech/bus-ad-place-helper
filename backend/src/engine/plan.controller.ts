import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiExtension, ApiExtraModels, ApiOkResponse, ApiOperation, ApiTags, getSchemaPath } from '@nestjs/swagger';
import { EngineService } from './engine.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { MetaDto, MissingDataDto, MissingWindowDto, NoInventoryDto, OverBudgetDto, PlanSuccessDto } from './dto/plan-response.dto';

@ApiTags('engine')
@ApiExtraModels(PlanSuccessDto, MissingWindowDto, MissingDataDto, NoInventoryDto, OverBudgetDto)
@Controller()
export class PlanController {
  constructor(private readonly engine: EngineService) {}

  @Get('meta')
  @ApiOperation({ operationId: 'getMeta', summary: '读取行业预置、预算范围与完整库存档期' })
  @ApiOkResponse({ type: MetaDto })
  getMeta() { return this.engine.getMeta(); }

  @Post('plan') @HttpCode(200)
  @ApiOperation({ operationId: 'generatePlan', summary: '生成确定性方案或按已确认策略重算' })
  @ApiExtension('x-evidence-refs', 'required')
  @ApiOkResponse({ schema: { oneOf: [PlanSuccessDto, MissingWindowDto, MissingDataDto, NoInventoryDto, OverBudgetDto].map(dto => ({ $ref: getSchemaPath(dto) })) } })
  generate(@Body() request: CreatePlanDto) { return this.engine.generate(request); }
}
