/** @type {import('next').NextConfig} */
// Backend URL on Render, e.g. https://rmw-analytics-api.onrender.com (set in Vercel env vars).
const API_URL = (process.env.API_URL || 'http://localhost:4100').replace(/\/$/, '');

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@rmw-analytics/shared'],
  // The browser calls /api/v1 on the Vercel domain; Vercel proxies it to Render.
  // This keeps the session cookie first-party (no cross-site cookie issues).
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${API_URL}/api/v1/:path*` }];
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    }];
  },
};

export default nextConfig;
