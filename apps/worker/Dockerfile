# Local Docker Compose dev/demo image. Runs the BullMQ worker (all background queues).
FROM node:20-alpine
# PostgreSQL client tools (pg_dump/pg_restore/psql) power the scheduled backup + verification jobs;
# redis-cli powers the Redis RDB export. See docs/backup-recovery.md.
RUN apk add --no-cache redis \
  && (apk add --no-cache postgresql16-client || apk add --no-cache postgresql-client)
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY tooling ./tooling
COPY apps/worker ./apps/worker

RUN pnpm install --frozen-lockfile=false

RUN pnpm --filter @college-erp/database prisma:generate \
  && pnpm --filter @college-erp/worker... build

CMD ["node", "apps/worker/dist/main.js"]
