# API + worker image (same image, different command).
# Build from the repo root:  docker build -f docker/api.Dockerfile -t rmw-analytics-api .
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/dashboard/package.json apps/dashboard/
COPY apps/docs/package.json apps/docs/
COPY packages/shared/package.json packages/shared/
COPY packages/tracker/package.json packages/tracker/
COPY packages/types/package.json packages/types/
COPY database/package.json database/
RUN npm ci --workspace @rmw-analytics/api --workspace @rmw-analytics/database --workspace @rmw-analytics/shared --workspace @rmw-analytics/tracker --include-workspace-root --ignore-scripts

FROM deps AS build
COPY packages ./packages
COPY database ./database
COPY apps/api ./apps/api
RUN npm run build -w @rmw-analytics/tracker

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache tini && addgroup -S app && adduser -S app -G app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/dashboard/package.json apps/dashboard/
COPY apps/docs/package.json apps/docs/
COPY packages/shared/package.json packages/shared/
COPY packages/tracker/package.json packages/tracker/
COPY packages/types/package.json packages/types/
COPY database/package.json database/
RUN npm ci --omit=dev --workspace @rmw-analytics/api --workspace @rmw-analytics/database --workspace @rmw-analytics/shared --include-workspace-root --ignore-scripts && npm cache clean --force
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/packages/tracker/dist ./packages/tracker/dist
COPY --from=build /app/database ./database
COPY --from=build /app/apps/api/src ./apps/api/src
USER app
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:4100/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/api/src/server.js"]
