import { Module } from '@nestjs/common';
import { EngineModule } from './engine/engine.module';
import { AnalysisModule } from './analysis/analysis.module';
import { ConfigModule } from './config/config.module';

@Module({ imports: [EngineModule, ConfigModule, AnalysisModule] })
export class AppModule {}
