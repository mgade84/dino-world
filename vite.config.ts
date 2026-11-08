import { defineConfig, type Plugin } from 'vite';
import { chownSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The map editor's Save button (dev server only): writes a map's source to src/game/maps/<id>.ts.
 * The game itself never calls it, and it isn't part of the production build.
 */
function saveMaps(): Plugin {
  const dir = resolve(process.cwd(), 'src/game/maps');
  return {
    name: 'dino-save-maps',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__maps/save', (req, res) => {
        const fail = (code: number, msg: string) => {
          res.statusCode = code;
          res.end(msg);
        };
        if (req.method !== 'POST') return fail(405, 'POST only');
        let body = '';
        req.on('data', (c) => {
          body += c;
          if (body.length > 4e6) req.destroy();
        });
        req.on('end', () => {
          try {
            const { id, source } = JSON.parse(body) as { id: string; source: string };
            if (!/^[a-z][a-z0-9-]{0,40}$/.test(id) || ['index', 'types', 'source'].includes(id)) return fail(400, 'bad map id');
            if (typeof source !== 'string' || !source.includes('export default')) return fail(400, 'bad source');
            const file = resolve(dir, `${id}.ts`);
            writeFileSync(file, source);
            // In Docker the server runs as root: give the file to whoever owns the folder.
            try {
              const { uid, gid } = statSync(dir);
              chownSync(file, uid, gid);
            } catch {
              /* not allowed, or not needed */
            }
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ file: `src/game/maps/${id}.ts` }));
          } catch (err) {
            fail(500, String(err));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [saveMaps()],
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
