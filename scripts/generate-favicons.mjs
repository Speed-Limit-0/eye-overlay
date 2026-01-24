import sharp from 'sharp';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = join(__dirname, '..', 'public');

// Read SVG files
const lightSvg = readFileSync(join(publicDir, 'icon-light.svg'));
const darkSvg = readFileSync(join(publicDir, 'icon-dark.svg'));

// Generate 32x32 PNG files
await sharp(lightSvg)
  .resize(32, 32)
  .png()
  .toFile(join(publicDir, 'icon-light-32x32.png'));

await sharp(darkSvg)
  .resize(32, 32)
  .png()
  .toFile(join(publicDir, 'icon-dark-32x32.png'));

// Generate Apple icon (180x180)
await sharp(lightSvg)
  .resize(180, 180)
  .png()
  .toFile(join(publicDir, 'apple-icon.png'));

console.log('✅ Favicons generated successfully!');
