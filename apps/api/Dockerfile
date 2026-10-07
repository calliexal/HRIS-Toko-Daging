# API DagingPeople (NestJS + pg-boss). Build dari ROOT repo, bukan dari apps/api:
#   docker build -f apps/api/Dockerfile -t dagingpeople-api .
#
# API memakai paket workspace (@dagingpeople/api, @dagingpeople/payroll-engine) berupa TypeScript mentah
# yang dijalankan langsung oleh tsx, jadi tidak ada langkah kompilasi.

FROM node:22-alpine AS deps
WORKDIR /app
# Semua package.json workspace disalin supaya npm bisa membaca lockfile utuh; yang dipasang hanya dependensi API.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/employee/package.json apps/employee/
COPY packages/api/package.json packages/api/
COPY packages/payroll-engine/package.json packages/payroll-engine/
COPY packages/tokens/package.json packages/tokens/
COPY packages/ui/package.json packages/ui/
RUN npm ci --workspace @dagingpeople/api-server --include-workspace-root --ignore-scripts --no-audit --no-fund \
 && npm cache clean --force

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Seluruh hasil install (termasuk node_modules bersarang milik workspace bila ada), lalu kode sumber di atasnya.
COPY --from=deps /app ./
COPY packages/api ./packages/api
COPY packages/payroll-engine ./packages/payroll-engine
COPY apps/api ./apps/api
# Jangan pernah membawa .env lokal ke image; konfigurasi datang dari environment platform.
RUN rm -f apps/api/.env apps/api/.env.* && chown -R node:node /app
USER node
WORKDIR /app/apps/api
EXPOSE 4000
# Migrasi dijalankan terpisah sebagai release/pre-deploy command:
#   node --import tsx src/db/migrate.ts
CMD ["node", "--import", "tsx", "src/main.ts"]
