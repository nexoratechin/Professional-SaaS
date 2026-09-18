# Local Docker Compose dev/demo image only — no multi-stage/production optimization yet
# (blueprint defers managed-cloud deployment to a later phase; this proves docker-compose up
# brings the whole stack up end-to-end).
FROM node:20-alpine
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY tooling ./tooling
COPY apps/api ./apps/api

RUN pnpm install --frozen-lockfile=false

RUN pnpm --filter @college-erp/database prisma:generate \
 && pnpm --filter @college-erp/database build \
 && pnpm --filter @college-erp/auth build \
 && pnpm --filter @college-erp/config build \
 && pnpm --filter @college-erp/api build

EXPOSE 3000
CMD ["sh", "-c", "pnpm --filter @college-erp/database exec prisma migrate deploy && pnpm --filter @college-erp/database exec prisma db seed && node apps/api/dist/main.js"]
