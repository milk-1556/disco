# Disco API — build context is the repo root.
FROM node:20-slim
RUN corepack enable
WORKDIR /app

# Install workspace deps (whole monorepo; workspace protocol needs all manifests present).
COPY . .
RUN pnpm install --frozen-lockfile

ENV API_HOST=0.0.0.0
ENV API_PORT=4000
EXPOSE 4000
CMD ["pnpm", "--filter", "@disco/api", "start"]
