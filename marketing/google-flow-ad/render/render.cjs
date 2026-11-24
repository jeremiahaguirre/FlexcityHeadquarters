// Renders one cut of the 20.0 s ad: node render.cjs <en|fr> <16x9|9x16> <out.mp4> [crf]
// Loads ad.html in headless Chromium and steps window.setTime() through 600 frames (30 fps).
// Motion blur: inside the stage's window.BLUR windows (fast moves only) each frame is the average of
// 4 sub-frames spread over half a frame (a 180-degree shutter); elsewhere the frame is repeated 4 times.
// ffmpeg reads the 120 fps stream, averages each group of 4 (tmix) and keeps one per group, so every
// output frame is either sharp or a true shutter blur. It muxes the voice + music mix
// (voiceover/mix-<lang>.wav) as AAC 160k stereo 48 kHz and writes H.264 yuv420p with +faststart.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const [lang = 'en', ar = '16x9', out = `FH-ad-${lang.toUpperCase()}-${ar}.mp4`, crf = '18'] = process.argv.slice(2);
const FPS = 30, DUR = 20, N = FPS * DUR, SUB = 4, SHUTTER = 0.5;
const [w, h] = ar === '9x16' ? [1080, 1920] : [1920, 1080];

(async () => {
  const exe = process.env.CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch({ executablePath: exe });
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on('console', (m) => process.stdout.write(`${lang}-${ar} console: ${m.text()}\n`));
  const url = 'file://' + path.join(__dirname, 'ad.html') + `?lang=${lang}&ar=${ar}`;
  await page.goto(url);
  await page.evaluate(() => window.ready);
  const BLUR = await page.evaluate(() => window.BLUR);
  const fast = (t) => BLUR.some(([a, b]) => t >= a - 1 / FPS && t <= b);

  const ff = spawn('ffmpeg', [
    '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(FPS * SUB), '-c:v', 'png', '-i', '-',
    '-i', path.join(__dirname, 'voiceover', `mix-${lang}.wav`),
    '-filter_complex', `[0:v]tmix=frames=${SUB},select='eq(mod(n\\,${SUB})\\,${SUB - 1})',setpts=N/(${FPS}*TB),format=yuv420p[v]`,
    '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', crf, '-r', String(FPS), '-profile:v', 'high',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
    '-t', String(DUR), '-movflags', '+faststart', out,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });

  const clip = { x: 0, y: 0, width: w, height: h };
  const send = async (buf) => { if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r)); };
  let blurred = 0;
  for (let i = 0; i < N; i++) {
    const t = i / FPS;
    if (fast(t)) {
      blurred++;
      for (let j = 0; j < SUB; j++) {
        const ts = t + ((j + 0.5) / SUB - 0.5) * SHUTTER / FPS;
        await page.evaluate((x) => window.setTime(x), Math.max(0, ts));
        await send(await page.screenshot({ type: 'png', clip }));
      }
    } else {
      await page.evaluate((x) => window.setTime(x), t);
      const buf = await page.screenshot({ type: 'png', clip });
      for (let j = 0; j < SUB; j++) await send(buf);
    }
    if (i % 100 === 0) process.stdout.write(`${lang}-${ar}: frame ${i}/${N}\n`);
  }
  ff.stdin.end();
  await new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c)))));
  await browser.close();
  console.log(`wrote ${out} (${blurred} of ${N} frames motion-blurred)`);
})().catch((e) => { console.error(e); process.exit(1); });
