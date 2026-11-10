# nginx front door + static docs site.  docker build -f docker/nginx.Dockerfile -t rmw-analytics-nginx .
FROM node:20-alpine AS docs
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/dashboard/package.json apps/dashboard/
COPY apps/docs/package.json apps/docs/
COPY packages/shared/package.json packages/shared/
COPY packages/tracker/package.json packages/tracker/
COPY packages/types/package.json packages/types/
COPY database/package.json database/
RUN npm ci --workspace @rmw-analytics/docs --include-workspace-root --ignore-scripts
COPY apps/docs ./apps/docs
COPY docs ./docs
COPY infrastructure/DEPLOYMENT.md ./infrastructure/DEPLOYMENT.md
COPY packages/tracker/README.md ./packages/tracker/README.md
ENV DOCS_BASE_PATH=/docs NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @rmw-analytics/docs

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=docs /app/apps/docs/out /usr/share/nginx/docs
EXPOSE 80
