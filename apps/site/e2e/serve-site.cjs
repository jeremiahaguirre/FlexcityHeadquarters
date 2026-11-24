/**
 * Serves the static site build (apps/site/out, from `npm run build`) for the browser tests, with the
 * response headers vercel.json gives production (Content-Security-Policy included), so a page that
 * breaks the policy fails here too. Byte ranges are served, as browsers ask for them for video.
 *   node e2e/serve-site.cjs [port]
 */
const { createServer } = require('node:http');
const { createReadStream, existsSync, readFileSync, statSync } = require('node:fs');
const { extname, join, normalize, resolve } = require('node:path');

const APP = join(__dirname, '..');
const ROOT = resolve(APP, process.env.SITE_OUT ?? 'out');
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 3101);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain', '.xml': 'application/xml', '.mp4': 'video/mp4', '.vtt': 'text/vtt; charset=utf-8' };
// vercel.json's sources here are plain patterns such as "/(.*)" and "/clips/(.*)".
const RULES = JSON.parse(readFileSync(join(APP, 'vercel.json'), 'utf8')).headers.map((r) => ({ re: new RegExp(`^${r.source}$`), headers: r.headers }));

createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  for (const r of RULES) if (r.re.test(path)) for (const h of r.headers) res.setHeader(h.key, h.value);
  let file = join(ROOT, path);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!file.startsWith(ROOT) || !existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    if (existsSync(join(ROOT, '404.html'))) createReadStream(join(ROOT, '404.html')).pipe(res);
    else res.end('Not found');
    return;
  }
  const size = statSync(file).size;
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : size - Number(range[2]);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      res.writeHead(416, { 'content-range': `bytes */${size}` });
      res.end();
      return;
    }
    res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': size });
  createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Site on http://localhost:${PORT}`));
