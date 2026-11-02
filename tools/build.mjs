/**
 * Erzeugt dist/prio-board.html: eine einzige, eigenständige Datei mit allem CSS und JS inline.
 * Damit funktioniert das Tool auch, wenn nur eine Datei geöffnet/verschickt wird
 * (Vorschau, Mail-Anhang, direkt aus dem ZIP usw.).
 *
 * Aufruf (Node.js ≥ 18, keine Abhängigkeiten):  node tools/build.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

let html = read('index.html');

// <link rel="stylesheet" href="css/…"> → <style>…</style>
html = html.replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g,
  (_, path) => `<style>\n/* ${path} */\n${read(path)}</style>`);

// <script src="js/…"></script> → <script>…</script>
// "</script" im Code würde das Inline-Skript vorzeitig beenden → maskieren.
html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g,
  (_, path) => `<script>\n/* ${path} */\n${read(path).replace(/<\/script/gi, '<\\/script')}</script>`);

const leftovers = html.match(/(href|src)="(css|js)\/[^"]+"/g);
if (leftovers) throw new Error(`Nicht eingebettet: ${leftovers.join(', ')}`);

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'prio-board.html'), html);
console.log(`dist/prio-board.html erstellt (${Math.round(html.length / 1024)} KB)`);
