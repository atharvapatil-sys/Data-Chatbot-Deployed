# ============================================================
# InsightStream — Docker image (Cloud Run / self-hosted)
#
# Multi-stage build:
#   builder  — installs all deps + compiles the Vite frontend
#   runner   — prod deps only + server source + built frontend
#
# tsx transpiles TypeScript at runtime (no separate tsc step).
# The server listens on $PORT (default 3000).
#
# Build:
#   docker build -t insightstream .
#
# Run:
#   docker run -p 3000:3000 --env-file .env insightstream
# ============================================================

# ── Stage 1: build the Vite frontend ─────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies first (layer-cached unless package.json changes)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# ── Stage 2: production runtime ──────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy pre-built frontend from builder
COPY --from=builder /app/dist ./dist

# Copy only the server-side TypeScript source files needed at runtime
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/src/server ./src/server
COPY --from=builder /app/src/constants ./src/constants
COPY --from=builder /app/src/types.ts ./src/types.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

EXPOSE 3000

# tsx transpiles and runs the entry point; serves dist/ as static files
CMD ["npx", "tsx", "server.ts"]
