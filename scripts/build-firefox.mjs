// Forks the Chrome build (`dist/`) into a Firefox-flavored copy at
// `dist-firefox/`. The only difference is the background block: Chrome MV3
// requires `service_worker`, Firefox stable still rejects it and requires
// `scripts` (event page). Run this AFTER `pnpm run build`.
import { cpSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'dist');
const dest = resolve(root, 'dist-firefox');

if (!existsSync(src)) {
  console.error('dist/ not found — run `pnpm run build` first.');
  process.exit(1);
}

if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });

const manifestPath = resolve(dest, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

delete manifest.background.service_worker;
manifest.background.scripts = ['background.js'];

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('Firefox build written to dist-firefox/');
