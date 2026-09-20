# Local Docker Compose dev/demo image only — runs the Vite dev server, not a production static
# build (that arrives with the managed-cloud deployment phase).
FROM node:20-alpine
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY tooling ./tooling
COPY apps/web ./apps/web

RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @college-erp/ui build && pnpm --filter @college-erp/types build

EXPOSE 5173
CMD ["pnpm", "--filter", "@college-erp/web", "dev"]
