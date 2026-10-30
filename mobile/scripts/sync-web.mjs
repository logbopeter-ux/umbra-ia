/**
 * Copie l'application web d'Umbra dans le dossier qu'embarque l'APK.
 * Les fichiers sont identiques : une seule base de code pour le web et le mobile.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '..', '..', 'web');
const dest = path.resolve(here, '..', 'www');

const SKIP = new Set(['sw.js']); // le service worker ne sert à rien dans l'APK

await fs.rm(dest, { recursive: true, force: true });
await fs.mkdir(dest, { recursive: true });

async function copyDir(from, to) {
  const entries = await fs.readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) {
      await fs.mkdir(d, { recursive: true });
      await copyDir(s, d);
    } else {
      await fs.copyFile(s, d);
    }
  }
}

await copyDir(src, dest);
console.log(`[umbra] web copié vers mobile/www (${src} → ${dest})`);
