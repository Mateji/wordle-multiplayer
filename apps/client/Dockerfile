FROM node:22-alpine AS builder

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/client/package.json apps/client/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

COPY apps/client apps/client
COPY packages/shared packages/shared

RUN pnpm --filter @wordle/shared build
RUN pnpm --filter @wordle/client build

FROM nginx:1.27-alpine AS runner

COPY deploy/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/client/dist/wordle/browser /usr/share/nginx/html

EXPOSE 80
