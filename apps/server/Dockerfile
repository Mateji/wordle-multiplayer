FROM node:22-alpine AS builder

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

COPY apps/server apps/server
COPY packages/shared packages/shared
COPY apps/client/src/assets apps/client/src/assets

RUN pnpm --filter @wordle/shared build
RUN pnpm --filter @wordle/server build
RUN pnpm deploy --filter @wordle/server --prod /prod/server

FROM node:22-alpine AS runner

WORKDIR /app/apps/server

ENV NODE_ENV=production
ENV PORT=3001

COPY --from=builder /prod/server /app/apps/server
COPY --from=builder /app/apps/client/src/assets /app/apps/client/src/assets

EXPOSE 3001

CMD ["node", "dist/index.js"]
