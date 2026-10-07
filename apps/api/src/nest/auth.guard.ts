import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROUTES, type RouteName } from '@dagingpeople/routes';
import type { AppServices } from '../app/container';
import { resolveAuth } from '../http/auth';
import { ROUTE_NAME, SERVICES } from './tokens';

/**
 * Guard global. Endpoint tanpa @Route ditolak (default tertutup, mencegah endpoint baru lupa diberi auth).
 * Logika autentikasi sama persis dengan server uji (resolveAuth).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SERVICES) private readonly svc: AppServices,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const name = this.reflector.get<RouteName | undefined>(ROUTE_NAME, ctx.getHandler());
    if (!name) return false;
    const req = ctx.switchToHttp().getRequest();
    const auth = await resolveAuth(ROUTES[name].auth, req.headers, req.params ?? {}, this.svc);
    req.dpActor = auth.actor;
    req.dpKiosk = auth.kiosk;
    return true;
  }
}
