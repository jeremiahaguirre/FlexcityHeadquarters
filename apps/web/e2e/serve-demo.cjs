/**
 * Serves the static demo build (apps/web/out, from `npm run build:demo`) for the phone tests.
 *   node e2e/serve-demo.cjs [port]
 */
const { createServer } = require('node:http');
const { createReadStream, existsSync, statSync } = require('node:fs');
const { extname, join, normalize, resolve } = require('node:path');

// DEMO_OUT: another build folder (absolute, or relative to apps/web).
const ROOT = resolve(join(__dirname, '..'), process.env.DEMO_OUT ?? 'out');
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 3100);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json' };

createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(ROOT, path);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  else if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`;
  if (!file.startsWith(ROOT) || !existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    createReadStream(join(ROOT, '404.html')).pipe(res);
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Demo on http://localhost:${PORT}`));
