// Renders one cut of the 20.0 s ad: node render.cjs <en|fr> <16x9|9x16> <out.mp4> [crf]
// Loads ad.html in headless Chromium, steps window.setTime() through 600 frames (30 fps) and pipes PNG
// frames to ffmpeg, which adds a silent AAC stereo track and writes H.264 yuv420p with +faststart.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const [lang = 'en', ar = '16x9', out = `FH-ad-${lang.toUpperCase()}-${ar}.mp4`, crf = '20'] = process.argv.slice(2);
const FPS = 30, DUR = 20, N = FPS * DUR;
const [w, h] = ar === '9x16' ? [1080, 1920] : [1920, 1080];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const url = 'file://' + path.join(__dirname, 'ad.html') + `?lang=${lang}&ar=${ar}`;
  await page.goto(url);
  await page.evaluate(() => window.ready);

  const ff = spawn('ffmpeg', [
    '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', crf, '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-profile:v', 'high', '-tune', 'animation',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    '-t', String(DUR), '-movflags', '+faststart', out,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });

  const clip = { x: 0, y: 0, width: w, height: h };
  for (let i = 0; i < N; i++) {
    await page.evaluate(t => window.setTime(t), i / FPS);
    const buf = await page.screenshot({ type: 'png', clip });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 100 === 0) process.stdout.write(`${lang}-${ar}: frame ${i}/${N}\n`);
  }
  ff.stdin.end();
  await new Promise((res, rej) => ff.on('close', c => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c)))));
  await browser.close();
  console.log('wrote', out);
})().catch(e => { console.error(e); process.exit(1); });
