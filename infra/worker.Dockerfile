# Disco build worker — build context is the repo root.
FROM node:20-slim
RUN corepack enable
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile

CMD ["pnpm", "--filter", "@disco/worker", "start"]
