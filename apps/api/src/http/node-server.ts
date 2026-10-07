import { createServer, type IncomingMessage, type Server } from 'node:http';
import { API_PREFIX, ROUTES, type RouteName } from '@dagingpeople/routes';
import type { AppServices } from '../app/container';
import { resolveAuth } from './auth';
import { createHandlers, isFileResult } from './handlers';
import { toHttpError } from './http-error';

/**
 * Server HTTP minimal (node:http) di atas tabel handler yang sama dengan controller NestJS.
 * Dipakai untuk uji end-to-end (klien HTTP frontend ↔ API ↔ Postgres) dan dev lokal tanpa Nest.
 * Produksi memakai NestJS (src/nest) — perilaku identik karena handler, auth, dan pemetaan error sama.
 */
const MAX_BODY = 256 * 1024;

const compiled = (Object.keys(ROUTES) as RouteName[]).map((name) => {
  const r = ROUTES[name];
  const keys: string[] = [];
  const pattern = new RegExp(`^${API_PREFIX}${r.path.replace(/:([A-Za-z]+)/g, (_, k: string) => (keys.push(k), '([^/]+)'))}$`);
  return { name, method: r.method, auth: r.auth, pattern, keys };
});

export const matchRoute = (method: string, pathname: string) => {
  for (const c of compiled) {
    if (c.method !== method) continue;
    const m = c.pattern.exec(pathname);
    if (m) return { ...c, params: Object.fromEntries(c.keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)])) };
  }
  return null;
};

const readBody = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Body terlalu besar'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('JSON tidak valid'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });

export const createNodeServer = (svc: AppServices, log: (msg: string, err?: unknown) => void = () => undefined): Server => {
  const handlers = createHandlers(svc);
  return createServer(async (req, res) => {
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const route = matchRoute(req.method ?? 'GET', url.pathname);
      if (!route) return send(404, { code: 'ROUTE_NOT_FOUND', message: 'Endpoint tidak ditemukan.' });
      const auth = await resolveAuth(route.auth, req.headers, route.params, svc);
      const body = route.method === 'GET' ? undefined : await readBody(req);
      const result = await handlers[route.name]({ ...auth, params: route.params, query: Object.fromEntries(url.searchParams), body });
      if (isFileResult(result)) {
        res.writeHead(200, {
          'Content-Type': result.contentType,
          'Content-Disposition': `attachment; filename="${result.filename}"`,
          'Cache-Control': 'no-store',
          ...result.headers,
        });
        return res.end(result.content);
      }
      return send(route.method === 'POST' && route.name === 'leaveSubmit' ? 201 : 200, result);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 400 || status === 413) return send(status, { code: status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON', message: (e as Error).message });
      const mapped = toHttpError(e);
      if (mapped.unexpected) log(`${req.method} ${req.url}`, e);
      return send(mapped.status, mapped.body);
    }
  });
};
