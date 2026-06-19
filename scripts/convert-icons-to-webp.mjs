#!/usr/bin/env node
/**
 * HIGH-QUALITY TGS → animated WebP converter.
 *
 * - Renders at 512×512 with 2× device-pixel-ratio (1024px internal)
 * - Uses lottie-web SVG renderer for crisp vector output
 * - Captures at the original Lottie frame-rate (no frame skipping)
 * - Encodes near-lossless animated WebP with full alpha
 * - Level badges → high-res static PNG
 *
 * Usage:  node scripts/convert-icons-to-webp.mjs
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';

const ROOT = process.cwd();
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const ICON_DIR = path.join(ROOT, 'public/images/Icons');
const USED_ICONS = [
  '8key', 'Ai', 'Anony', 'heyredo', 'Medal',
  'RedoandFlag', 'RedoFriend', 'searchduck', 'Vsfriend', 'wallet',
];
const BADGE_DIR = path.join(ROOT, 'public/images/Level_Badges');

// ── Quality settings ──
const RENDER_SIZE = 512;           // CSS pixels for the viewport
const DEVICE_SCALE = 2;            // Retina — actual capture is 1024×1024
const OUTPUT_SIZE = 512;           // Final WebP frame dimension
const BADGE_OUTPUT_SIZE = 512;     // Badge PNG dimension

// Read lottie-web from local file
const LOTTIE_JS_PATH = '/tmp/lottie.min.js';
if (!fs.existsSync(LOTTIE_JS_PATH)) {
  console.error('❌ Missing /tmp/lottie.min.js — run:');
  console.error('   curl -sL "https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js" -o /tmp/lottie.min.js');
  process.exit(1);
}
const LOTTIE_JS = fs.readFileSync(LOTTIE_JS_PATH, 'utf-8');

async function main() {
  console.log('🚀 High-quality TGS → WebP/PNG converter\n');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--force-color-profile=srgb',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({
    width: RENDER_SIZE,
    height: RENDER_SIZE,
    deviceScaleFactor: DEVICE_SCALE,
  });

  let converted = 0, skipped = 0, errors = 0;

  // ── 1. Animated Icons → WebP ──
  console.log(`📂 Icons (${USED_ICONS.length})\n`);
  for (const name of USED_ICONS) {
    const tgsPath = path.join(ICON_DIR, `${name}.tgs`);
    const webpPath = path.join(ICON_DIR, `${name}.webp`);

    if (!fs.existsSync(tgsPath)) { console.warn(`  ⚠ ${name}.tgs missing`); errors++; continue; }

    try {
      const lottieJson = decompressTgs(tgsPath);
      const { frames, fps } = await renderAllFrames(page, lottieJson);
      await assembleAnimatedWebP(frames, fps, webpPath);
      const kb = (fs.statSync(webpPath).size / 1024).toFixed(1);
      console.log(`  ✓ ${name}.webp  ${frames.length}fr @ ${fps}fps  ${kb} KB`);
      converted++;
    } catch (e) {
      console.error(`  ✗ ${name}: ${e.message}`);
      errors++;
    }
  }

  // ── 2. Level Badges → static PNG ──
  const badgeTgs = fs.readdirSync(BADGE_DIR).filter(f => f.endsWith('.tgs'));
  console.log(`\n📂 Level Badges (${badgeTgs.length} → PNG)\n`);

  // Resize viewport for badge rendering
  await page.setViewport({
    width: RENDER_SIZE,
    height: RENDER_SIZE,
    deviceScaleFactor: DEVICE_SCALE,
  });

  for (const tgsFile of badgeTgs) {
    const baseName = path.basename(tgsFile, '.tgs');
    const tgsPath = path.join(BADGE_DIR, tgsFile);
    const pngPath = path.join(BADGE_DIR, `${baseName}.png`);

    if (fs.existsSync(pngPath)) { skipped++; continue; }

    try {
      const lottieJson = decompressTgs(tgsPath);
      const frameBuffer = await renderSingleFrame(page, lottieJson, 0.5);
      await sharp(frameBuffer)
        .resize(BADGE_OUTPUT_SIZE, BADGE_OUTPUT_SIZE, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
          kernel: 'lanczos3',
        })
        .png({ compressionLevel: 9 })
        .toFile(pngPath);
      const kb = (fs.statSync(pngPath).size / 1024).toFixed(1);
      console.log(`  ✓ ${baseName}.png  ${kb} KB`);
      converted++;
    } catch (e) { console.error(`  ✗ ${baseName}: ${e.message}`); errors++; }
  }

  await page.close();
  await browser.close();
  console.log(`\n✅ Done!  Converted: ${converted}  Skipped: ${skipped}  Errors: ${errors}`);
}

function decompressTgs(filePath) {
  const compressed = fs.readFileSync(filePath);
  return JSON.parse(zlib.gunzipSync(compressed).toString());
}

/**
 * Render EVERY frame at the Lottie's native frame-rate.
 * Returns { frames: Buffer[], fps: number }
 */
async function renderAllFrames(page, lottieJson) {
  await loadLottie(page, lottieJson);

  const { totalFrames, frameRate } = await page.evaluate(() => ({
    totalFrames: window.__totalFrames,
    frameRate: window.__frameRate,
  }));

  // Use original frame rate (capped at 30 for sanity, min 12)
  const fps = Math.min(30, Math.max(12, Math.round(frameRate)));
  // Calculate how many output frames to render at the target fps
  const duration = totalFrames / frameRate;
  const count = Math.max(2, Math.round(duration * fps));

  const frames = [];
  for (let i = 0; i < count; i++) {
    // Map output frame index to Lottie frame
    const lottieFrame = (i / count) * totalFrames;
    await page.evaluate(f => {
      window.__anim.goToAndStop(f, true);
    }, lottieFrame);
    // Let SVG renderer fully settle
    await delay(25);
    const buf = await page.screenshot({ type: 'png', omitBackground: true });
    frames.push(buf);
  }

  return { frames, fps };
}

/**
 * Render a single frame at progress 0..1
 */
async function renderSingleFrame(page, lottieJson, progress) {
  await loadLottie(page, lottieJson);
  const totalFrames = await page.evaluate(() => window.__totalFrames);
  const frame = Math.min(totalFrames - 1, Math.floor(progress * totalFrames));
  await page.evaluate(f => window.__anim.goToAndStop(f, true), frame);
  await delay(40);
  return page.screenshot({ type: 'png', omitBackground: true });
}

async function loadLottie(page, lottieJson) {
  const html = `<!DOCTYPE html>
<html><head><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${RENDER_SIZE}px;height:${RENDER_SIZE}px;overflow:hidden;background:transparent}
#c{width:${RENDER_SIZE}px;height:${RENDER_SIZE}px}
</style></head><body><div id="c"></div>
<script>${LOTTIE_JS}<\/script>
<script>
var a=lottie.loadAnimation({
  container:document.getElementById('c'),
  renderer:'svg',
  loop:false,
  autoplay:false,
  rendererSettings:{
    preserveAspectRatio:'xMidYMid meet',
    progressiveLoad:false,
    hideOnTransparent:true
  },
  animationData:${JSON.stringify(lottieJson)}
});
a.addEventListener('DOMLoaded',function(){
  window.__ready=true;
  window.__totalFrames=a.totalFrames;
  window.__frameRate=a.frameRate||30;
});
window.__anim=a;
<\/script></body></html>`;

  await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction('window.__ready === true', { timeout: 15000 });
  // Extra settle time for complex SVG
  await delay(50);
}

/**
 * Assemble PNG frames → animated WebP with near-lossless quality.
 */
async function assembleAnimatedWebP(pngFrames, fps, outputPath) {
  const frameDelay = Math.round(1000 / fps);
  const size = OUTPUT_SIZE;

  // Convert each PNG → raw RGBA at exact output size using high-quality resampling
  const rawBuffers = [];
  for (const png of pngFrames) {
    const { data } = await sharp(png)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        kernel: 'lanczos3',
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    rawBuffers.push(data);
  }

  // Stack all frames vertically into one tall RGBA buffer
  const frameBytes = size * size * 4;
  const stacked = Buffer.alloc(frameBytes * rawBuffers.length);
  for (let i = 0; i < rawBuffers.length; i++) {
    rawBuffers[i].copy(stacked, i * frameBytes);
  }

  await sharp(stacked, {
    raw: { width: size, height: size * rawBuffers.length, channels: 4 },
  })
    .webp({
      quality: 95,         // High quality
      alphaQuality: 100,   // Perfect alpha
      effort: 6,           // Max compression effort
      nearLossless: true,   // Near-lossless mode
      loop: 0,             // Infinite loop
      delay: new Array(rawBuffers.length).fill(frameDelay),
      pageHeight: size,
    })
    .toFile(outputPath);
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
