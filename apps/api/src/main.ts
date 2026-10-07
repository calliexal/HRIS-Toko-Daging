import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AppServices } from './app/container';
import type { AppConfig } from './common/config';
import { createRateLimiter, DEFAULT_RATE_LIMITS } from './http/rate-limit';
import { startJobs } from './jobs/scheduler';
import { AppModule } from './nest/app.module';
import { CONFIG, SERVICES } from './nest/tokens';

type HeaderResponse = { setHeader(k: string, v: string): void; status(code: number): { json(body: unknown): void } };

const bootstrap = async () => {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: true, bufferLogs: true });
  const cfg = app.get<AppConfig>(CONFIG);
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: cfg.corsOrigins, credentials: false, allowedHeaders: ['Authorization', 'Content-Type', 'X-Kiosk-Token'] });
  app.useBodyParser('json', { limit: '256kb' });
  // Di balik proxy (Railway/Render/Fly/Nginx) IP klien ada di X-Forwarded-For. Hanya dipercaya bila TRUST_PROXY
  // diset: tanpa proxy, header itu bisa dipalsukan penyerang untuk lolos dari rate limit.
  app.disable('x-powered-by');
  if (cfg.trustProxy > 0) app.set('trust proxy', cfg.trustProxy);
  const rateLimit = createRateLimiter(DEFAULT_RATE_LIMITS);
  // Header keamanan dasar (tanpa helmet agar dependensi minimal).
  app.use((req: { method: string; path: string; ip?: string }, res: HeaderResponse, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    // Respons berisi data gaji & pribadi: jangan pernah disimpan cache peramban atau proxy.
    res.setHeader('Cache-Control', 'no-store');
    if (cfg.production) res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    const decision = rateLimit(req.method, req.path, req.ip ?? 'unknown');
    if (!decision.allowed) {
      res.setHeader('Retry-After', String(decision.retryAfterSeconds));
      res.status(429).json({ code: 'RATE_LIMITED', message: 'Terlalu banyak percobaan dari jaringan ini. Tunggu sebentar lalu coba lagi.' });
      return;
    }
    next();
  });
  app.enableShutdownHooks();
  const jobs = cfg.runJobs ? await startJobs(cfg.databaseUrl, app.get<AppServices>(SERVICES)) : null;
  app.getHttpServer().on('close', () => void jobs?.stop());
  await app.listen(cfg.port);
};

void bootstrap();
