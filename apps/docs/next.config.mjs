/** Static documentation site (next build → ./out, deployable to any static host or served by nginx at /docs). */
export default {
  output: 'export',
  basePath: process.env.DOCS_BASE_PATH || '',
  trailingSlash: true,
  images: { unoptimized: true },
};
