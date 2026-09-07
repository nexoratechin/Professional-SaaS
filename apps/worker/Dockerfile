# Local Docker Compose dev/demo image only. Worker has no queues/processors yet (Phase 1
# scaffold) — see apps/worker/src/main.ts.
FROM node:20-alpine
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker

RUN pnpm install --frozen-lockfile=false

RUN pnpm --filter @college-erp/database prisma:generate \
 && pnpm --filter @college-erp/database build \
 && pnpm --filter @college-erp/config build \
 && pnpm --filter @college-erp/worker build

CMD ["node", "apps/worker/dist/main.js"]
