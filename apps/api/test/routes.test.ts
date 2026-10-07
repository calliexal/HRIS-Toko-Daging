import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ROUTES, type RouteName } from '@dagingpeople/routes';


test('setiap ROUTES punya controller NestJS dengan verb & path yang cocok', () => {
  const src = readFileSync(join(import.meta.dirname, '../src/nest/controllers.ts'), 'utf8');
  const found = new Map<string, { verb: string; path: string }>();
  for (const m of src.matchAll(/@(Get|Post|Put)\('([^']+)'\)\n\s+@Route\('(\w+)'\)/g)) found.set(m[3]!, { verb: m[1]!.toUpperCase(), path: m[2]! });
  for (const name of Object.keys(ROUTES) as RouteName[]) {
    assert.deepEqual(found.get(name), { verb: ROUTES[name].method, path: ROUTES[name].path }, name);
  }
  assert.equal(found.size, Object.keys(ROUTES).length);
});
