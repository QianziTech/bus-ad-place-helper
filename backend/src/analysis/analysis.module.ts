import { Module } from '@nestjs/common';
import { EngineModule } from '../engine/engine.module';
import { ConfigModule } from '../config/config.module';
import { PlanPipelineService } from '../shared/pipeline/plan-pipeline.service';
import { AnalysisController } from './analysis.controller';
import { BriefService } from './brief.service';
import { StrategyService } from './strategy.service';
import { CopyService } from './copy.service';
import { VerifyService } from './verify.service';
import { ContentScanService } from './content-scan.service';

@Module({ imports: [EngineModule, ConfigModule], controllers: [AnalysisController], providers: [BriefService, StrategyService, CopyService, VerifyService, ContentScanService, PlanPipelineService],
  exports: [BriefService, StrategyService, CopyService, VerifyService, ContentScanService, PlanPipelineService] })
export class AnalysisModule {}
