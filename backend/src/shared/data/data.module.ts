import { Module } from '@nestjs/common';
import { PlanDataService } from './plan-data.service';

@Module({ providers: [PlanDataService], exports: [PlanDataService] })
export class DataModule {}
