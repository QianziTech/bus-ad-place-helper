import { Body, Controller, Delete, Get, Header, HttpCode, Post, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';
import { HongdouInventoryService, InventoryUnavailable, type HongdouLogin } from './hongdou.client';
import { InventoryService } from './inventory.service';

class HongdouLoginDto implements HongdouLogin {
  @ApiProperty() @IsString() @Matches(/\S/) @MaxLength(256) username!: string;
  @ApiProperty({ format: 'password', writeOnly: true }) @IsString() @Matches(/\S/) @MaxLength(1024) password!: string;
}

class HongdouConnectionDto {
  @ApiProperty({ enum: ['session', 'environment', 'none'] }) source!: HongdouInventoryService['source'];
  @ApiProperty() online!: boolean;
  @ApiProperty() forceOffline!: boolean;
}

@ApiTags('config')
@Controller('config/hongdou')
export class HongdouConnectionController {
  constructor(private readonly hongdou: HongdouInventoryService, private readonly inventory: InventoryService) {}

  @Get() @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'getHongdouConnection', summary: '读取红豆连接状态' })
  @ApiOkResponse({ type: HongdouConnectionDto })
  status(): HongdouConnectionDto {
    return { source: this.hongdou.source, online: this.inventory.online, forceOffline: this.inventory.forceOffline };
  }

  @Post() @HttpCode(200) @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'connectHongdou', summary: '使用红豆 OAuth2 登录并启用实时库存' })
  @ApiOkResponse({ type: HongdouConnectionDto })
  async connect(@Body() input: HongdouLoginDto): Promise<HongdouConnectionDto> {
    try {
      await this.inventory.connect({ username: input.username.trim(), password: input.password });
    } catch (error) {
      if (error instanceof InventoryUnavailable) throw new ServiceUnavailableException(error.message);
      throw error;
    }
    return this.status();
  }

  @Delete() @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'disconnectHongdou', summary: '退出工作台中的红豆登录' })
  @ApiOkResponse({ type: HongdouConnectionDto })
  disconnect(): HongdouConnectionDto {
    this.hongdou.disconnect();
    return this.status();
  }
}
