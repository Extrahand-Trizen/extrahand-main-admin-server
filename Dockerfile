# Use Node.js 20 Alpine image
FROM node:20-alpine AS base

# Install runtime utilities
RUN apk add --no-cache dumb-init curl

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodeuser -u 1001

# Build stage
FROM base AS build

ARG CACHE_BUST=1

COPY package.json package-lock.json* ./

# Install all deps for TypeScript build
RUN if [ -f package-lock.json ]; then \
      npm ci --no-audit --no-fund; \
    else \
      npm install --no-audit --no-fund; \
    fi

COPY tsconfig.json ./
RUN echo "Cache bust value: ${CACHE_BUST}" > /dev/null
COPY src ./src

RUN npm run build
RUN npm prune --omit=dev

# Production stage
FROM base AS production

ENV NODE_ENV=production
ENV PORT=4007
ENV LOG_LEVEL=info

COPY --from=build --chown=nodeuser:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nodeuser:nodejs /app/dist ./dist
COPY --from=build --chown=nodeuser:nodejs /app/package.json ./

RUN mkdir -p logs && chown -R nodeuser:nodejs logs

USER nodeuser

EXPOSE 4007

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:4007/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
