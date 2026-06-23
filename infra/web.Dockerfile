# Disco dashboard — build context is the repo root.
FROM node:20-slim
RUN corepack enable
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile

# The dashboard runs in the user's browser, so it must reach the API at a browser-visible URL.
# Override at build time: docker compose build --build-arg VITE_API_BASE=https://api.example.com
ARG VITE_API_BASE=http://localhost:4000
ENV VITE_API_BASE=$VITE_API_BASE
RUN pnpm --filter @disco/web build

EXPOSE 5173
CMD ["pnpm", "--filter", "@disco/web", "preview", "--port", "5173", "--host"]
