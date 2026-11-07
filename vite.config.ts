import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    port: 5175,
    strictPort: true,
    // Enable with WATCH_POLLING=true when file changes don't reach the container.
    watch: { usePolling: process.env.WATCH_POLLING === 'true' },
    // Also answer to LAN hostnames like brix.local (IP addresses and localhost always work).
    allowedHosts: ['.local'],
  },
  preview: { host: true, port: 4173, allowedHosts: ['.local'] },
  // iPadOS 14+ Safari
  // Three.js is a lazily loaded ~600 kB chunk; that's expected.
  build: { target: ['es2020', 'safari14'], chunkSizeWarningLimit: 700 },
});
