// Copies the static site into _site/ for GitHub Pages.
// There is no bundling step: the app is plain ES modules.
import { cpSync, existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '_site');
const entries = ['index.html', 'styles.css', 'manifest.webmanifest', 'src', 'icons'];

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const entry of entries) {
  const src = join(root, entry);
  if (!existsSync(src)) throw new Error(`Missing build input: ${entry}`);
  cpSync(src, join(out, entry), { recursive: true });
}

// Guard against absolute asset paths, which break when served from /quilling-editor/.
const html = readFileSync(join(out, 'index.html'), 'utf8');
const absolute = [...html.matchAll(/(?:src|href)="(\/[^"]*)"/g)].map((m) => m[1]);
if (absolute.length) throw new Error(`Absolute asset paths found in index.html: ${absolute.join(', ')}`);

console.log(`Built site into ${out}`);
