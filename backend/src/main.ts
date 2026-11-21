import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';
import { ContentScanService } from './analysis/content-scan.service';
import { PlanDataService } from './shared/data/plan-data.service';

export async function createApplication() {
  const repositoryRoot = existsSync(resolve(process.cwd(), 'backend')) ? process.cwd() : resolve(process.cwd(), '..');
  // 工作区已有内部映射仅本机读取，不复制到交付仓库。
  const localMapping = resolve(repositoryRoot, '../data/internal/brand_mapping.json');
  if (!process.env.BRAND_MAPPING_PATH && existsSync(localMapping)) process.env.BRAND_MAPPING_PATH = localMapping;
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn', 'log'], bodyParser: false });
  // 导出扫描同时接收方案和最多 20 万字符的 HTML 文本。
  app.useBodyParser('json', { limit: '2mb' });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  const scan = app.get(ContentScanService);
  const startupNames = scan.scan(app.get(PlanDataService).data.briefs, 'briefs').filter(item => item.element === '实名扫描');
  if (startupNames.length) {
    await app.close();
    throw new Error('briefs.json 包含真实客户名称，请改为客户代称');
  }
  app.useGlobalPipes({ transform(value: unknown) {
    if (value && typeof value === 'object') {
      const body = value as Record<string, unknown>;
      for (const name of ['briefText', 'text', 'campaignOverride', 'strategyPreferences']) {
        if (body[name] !== undefined) scan.assertInput(typeof body[name] === 'string' ? body[name] : JSON.stringify(body[name]));
      }
    }
    return value;
  } });
  app.enableCors({ origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:5173', 'http://127.0.0.1:5173'] });
  const config = new DocumentBuilder().setTitle('动线运筹后端 API').setVersion('0.1.0')
    .setDescription('基于完整档期库存与区间刊例估算方案；分析可使用 off、mock、live 模式。').build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: '/api/openapi.json', swaggerOptions: { persistAuthorization: false } });
  const frontendDist = resolve(repositoryRoot, 'frontend/dist');
  if (existsSync(resolve(frontendDist, 'index.html'))) {
    app.useStaticAssets(frontendDist);
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method === 'GET' && !req.path.startsWith('/api') && req.accepts('html')) res.sendFile(resolve(frontendDist, 'index.html'));
      else next();
    });
  }
  return app;
}

async function bootstrap() {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new BadRequestException('PORT 必须为有效端口');
  const app = await createApplication();
  await app.listen(port, process.env.HOST || '127.0.0.1');
}
if (require.main === module) void bootstrap().catch(error => { console.error(error.message); process.exitCode = 1; });
