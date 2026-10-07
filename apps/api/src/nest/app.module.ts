import { Module, type OnApplicationShutdown, Inject } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { buildServices, type AppServices } from '../app/container';
import { systemClock } from '../common/clock';
import { loadConfig, type AppConfig } from '../common/config';
import { createPgDb } from '../common/pg-db';
import { createHandlers } from '../http/handlers';
import { AuthGuard } from './auth.guard';
import { CONTROLLERS } from './controllers';
import { ErrorFilter } from './error.filter';
import { CONFIG, DATABASE, HANDLERS, SERVICES } from './tokens';

/**
 * Modular monolith: satu proses, modul domain dipisah per folder (src/modules/*).
 * Service dibuat lewat factory (bukan @Injectable) agar domain tetap bebas framework dan bisa diuji tanpa Nest.
 */
@Module({
  controllers: CONTROLLERS,
  providers: [
    { provide: CONFIG, useFactory: (): AppConfig => loadConfig() },
    { provide: DATABASE, inject: [CONFIG], useFactory: (cfg: AppConfig) => createPgDb(cfg.databaseUrl) },
    {
      provide: SERVICES,
      inject: [CONFIG, DATABASE],
      useFactory: (cfg: AppConfig, database: ReturnType<typeof createPgDb>): AppServices =>
        buildServices(database.db, systemClock, { dataKey: cfg.dataKey, indexKey: cfg.indexKey, jwtKey: cfg.jwtKey, jwtTtlSeconds: cfg.jwtTtlSeconds, legalEntityId: cfg.legalEntityId }),
    },
    { provide: HANDLERS, inject: [SERVICES], useFactory: (svc: AppServices) => createHandlers(svc) },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ErrorFilter },
  ],
  exports: [SERVICES, CONFIG, DATABASE],
})
export class AppModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly database: ReturnType<typeof createPgDb>) {}

  async onApplicationShutdown() {
    await this.database.close();
  }
}
