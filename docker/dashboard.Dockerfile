# Dashboard (Next.js standalone).  docker build -f docker/dashboard.Dockerfile -t rmw-analytics-dashboard .
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/dashboard/package.json apps/dashboard/
COPY apps/docs/package.json apps/docs/
COPY packages/shared/package.json packages/shared/
COPY packages/tracker/package.json packages/tracker/
COPY packages/types/package.json packages/types/
COPY database/package.json database/
RUN npm ci --workspace @rmw-analytics/dashboard --include-workspace-root --ignore-scripts
COPY packages/shared ./packages/shared
COPY apps/dashboard ./apps/dashboard
# API_URL is only used by the built-in /api rewrite (when nginx is not in front).
ARG API_URL=http://api:4100
ENV API_URL=$API_URL NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @rmw-analytics/dashboard

FROM node:20-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3100 HOSTNAME=0.0.0.0
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/apps/dashboard/.next/standalone ./
COPY --from=build /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=build /app/apps/dashboard/public ./apps/dashboard/public
USER app
EXPOSE 3100
CMD ["node", "apps/dashboard/server.js"]
