import { Module } from '@nestjs/common';
import { ConfigController } from './config.controller';
import { RuntimeConfigService } from './runtime-config.service';
import { LlmClient } from '../analysis/llm.client';

@Module({ controllers: [ConfigController], providers: [RuntimeConfigService, LlmClient], exports: [RuntimeConfigService, LlmClient] })
export class ConfigModule {}
