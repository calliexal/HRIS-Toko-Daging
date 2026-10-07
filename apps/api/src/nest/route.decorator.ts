import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { RouteName } from '@dagingpeople/routes';
import type { HandlerContext } from '../http/handlers';
import { ROUTE_NAME } from './tokens';

/** Menandai method controller dengan nama route di ROUTES; AuthGuard membaca mode auth dari sana. */
export const Route = (name: RouteName) => SetMetadata(ROUTE_NAME, name);

/** Konteks handler (aktor/kiosk hasil AuthGuard + params/query/body) untuk tabel handler bersama. */
export const Ctx = createParamDecorator((_: unknown, ec: ExecutionContext): HandlerContext => {
  const req = ec.switchToHttp().getRequest();
  return { actor: req.dpActor ?? null, kiosk: req.dpKiosk ?? null, params: req.params ?? {}, query: req.query ?? {}, body: req.body };
});
