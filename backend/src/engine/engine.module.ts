import { Module } from '@nestjs/common';
import { DataModule } from '../shared/data/data.module';
import { EngineService } from './engine.service';
import { ScheduleService } from './schedule.service';
import { PlanController } from './plan.controller';
import { ConfigModule } from '../config/config.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({ imports: [DataModule, ConfigModule, InventoryModule], providers: [EngineService, ScheduleService], controllers: [PlanController], exports: [EngineService, ScheduleService, DataModule] })
export class EngineModule {}
