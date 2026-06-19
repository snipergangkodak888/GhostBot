import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { execSync } from 'child_process';

const TGS_DIR = path.join(process.cwd(), 'public/images/Stickers/tgs');
const OUTPUT_DIR = path.join(process.cwd(), 'public/images/Stickers/webp');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Get all TGS files
const tgsFiles = fs.readdirSync(TGS_DIR).filter(f => f.endsWith('.tgs'));

console.log(`Found ${tgsFiles.length} TGS files to process`);

for (const tgsFile of tgsFiles) {
  const inputPath = path.join(TGS_DIR, tgsFile);
  const baseName = path.basename(tgsFile, '.tgs');
  const tempJsonPath = path.join(OUTPUT_DIR, `${baseName}.json`);
  const outputPath = path.join(OUTPUT_DIR, `${baseName}.webp`);
  
  console.log(`\nProcessing: ${tgsFile}`);
  
  try {
    // 1. Decompress TGS (gzipped JSON)
    const compressed = fs.readFileSync(inputPath);
    const decompressed = zlib.gunzipSync(compressed);
    const lottie = JSON.parse(decompressed.toString());
    
    // 2. Remove Background layer from main layers
    const originalLayerCount = lottie.layers.length;
    lottie.layers = lottie.layers.filter(layer => {
      const name = layer.nm?.toLowerCase() || '';
      if (name === 'background') {
        console.log(`  - Removed main layer: ${layer.nm}`);
        return false;
      }
      return true;
    });
    console.log(`  - Main layers: ${originalLayerCount} -> ${lottie.layers.length}`);
    
    // 3. Remove 'Icon' elements from Pattern asset (asset id 'P')
    if (lottie.assets) {
      for (const asset of lottie.assets) {
        if (asset.id === 'P' && asset.layers) {
          const originalAssetLayers = asset.layers.length;
          asset.layers = asset.layers.filter(layer => {
            const name = layer.nm?.toLowerCase() || '';
            if (name === 'icon') {
              return false;
            }
            return true;
          });
          if (originalAssetLayers !== asset.layers.length) {
            console.log(`  - Removed ${originalAssetLayers - asset.layers.length} Icon elements from Pattern asset`);
          }
        }
      }
    }
    
    // 4. Save modified JSON temporarily
    fs.writeFileSync(tempJsonPath, JSON.stringify(lottie));
    console.log(`  - Saved modified Lottie JSON`);
    
  } catch (error) {
    console.error(`  ERROR processing ${tgsFile}:`, error.message);
  }
}

console.log('\n✅ All TGS files processed and saved as JSON.');
console.log(`\nJSON files saved to: ${OUTPUT_DIR}`);
console.log('\nTo convert to animated WebP, you need to install a Lottie renderer.');
console.log('Options:');
console.log('  1. Use lottie-to-gif/webp npm package');
console.log('  2. Use Puppeteer with lottie-web');
console.log('  3. Use rlottie library');
