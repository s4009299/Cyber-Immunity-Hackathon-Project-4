/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produces .next/standalone — a minimal, self-contained server bundle with
  // its own pruned node_modules. Used by the production Dockerfile so the
  // final image doesn't need the full node_modules tree. Has no effect on
  // `npm run dev` or a non-Docker `npm run build && npm run start`.
  output: 'standalone',
}
module.exports = nextConfig
