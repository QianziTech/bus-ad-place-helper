import { Module } from '@nestjs/common';
import { DataModule } from '../shared/data/data.module';
import { HongdouInventoryService } from './hongdou.client';
import { HongdouConnectionController } from './hongdou-connection.controller';
import { InventoryService } from './inventory.service';

@Module({ imports: [DataModule], controllers: [HongdouConnectionController], providers: [HongdouInventoryService, InventoryService], exports: [HongdouInventoryService, InventoryService] })
export class InventoryModule {}
