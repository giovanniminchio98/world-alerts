// Renders the PNG app icons from the master SVG (assets/app-icon.svg).
// Run after changing the icon: `npm run icons` (uses Playwright's Chromium;
// set PLAYWRIGHT_CHROMIUM_PATH to use a preinstalled binary). Outputs are committed.
//   public/favicon.svg              browser tabs and Chrome bookmarks (rounded corners)
//   public/icons/apple-touch-icon   iPhone/iPad home screen and Safari favourites (iOS needs PNG)
//   public/icons/icon-192/512       web app manifest
//   public/icons/maskable-512       Android adaptive icon (mark shrunk into the safe zone)
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const master = await fs.readFile(path.join(root, 'assets/app-icon.svg'), 'utf8');
const body = master.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<!--[\s\S]*?-->/g, '').trim();
const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${inner}</svg>`;

const variants = {
  full: svg(body),
  rounded: svg(body.replace('<rect width="512" height="512"', '<rect width="512" height="512" rx="112"')),
  // Android crops to a circle of radius 40% of the size; scale the mark to fit inside it.
  maskable: svg(body.replace(/<g id="mark">/, '<g id="mark" transform="translate(256 262) scale(.78) translate(-256 -262)">')),
};

await fs.writeFile(path.join(root, 'public/favicon.svg'), variants.rounded + '\n');

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
const page = await browser.newPage();
for (const [file, size, variant] of [
  ['apple-touch-icon.png', 180, 'full'],
  ['icon-192.png', 192, 'full'],
  ['icon-512.png', 512, 'full'],
  ['maskable-512.png', 512, 'maskable'],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${variants[variant]}`);
  await page.screenshot({ path: path.join(root, 'public/icons', file), omitBackground: false });
  console.log(`icons/${file} (${size}px)`);
}
await browser.close();
