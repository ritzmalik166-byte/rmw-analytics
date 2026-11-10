/**
 * PM2 process file for bare-metal / VM deployments (no Docker).
 *   npm ci && npm run build:tracker && npm run build -w @rmw-analytics/dashboard
 *   pm2 start infrastructure/pm2/ecosystem.config.cjs && pm2 save
 * Environment comes from apps/api/.env (API + worker) — never hardcode secrets here.
 */
module.exports = {
  apps: [
    {
      name: 'analytics-api',
      cwd: './apps/api',
      script: 'src/server.js',
      instances: 2,               // cluster mode; requires REDIS_URL for shared realtime + quotas
      exec_mode: 'cluster',
      env: { NODE_ENV: 'production', RUN_JOBS_IN_PROCESS: 'false' },
      max_memory_restart: '700M',
      kill_timeout: 10000,
    },
    {
      name: 'analytics-worker',
      cwd: './apps/api',
      script: 'src/worker.js',
      instances: 1,
      env: { NODE_ENV: 'production', AUTO_MIGRATE: 'false' },
      max_memory_restart: '500M',
    },
    {
      name: 'analytics-dashboard',
      cwd: './apps/dashboard',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3100',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '500M',
    },
  ],
};
