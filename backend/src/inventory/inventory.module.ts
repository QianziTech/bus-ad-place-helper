import { Module } from '@nestjs/common';
import { DataModule } from '../shared/data/data.module';
import { HongdouInventoryService } from './hongdou.client';
import { InventoryService } from './inventory.service';

@Module({ imports: [DataModule], providers: [HongdouInventoryService, InventoryService], exports: [HongdouInventoryService, InventoryService] })
export class InventoryModule {}
