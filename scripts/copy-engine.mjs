// Stockfish (lite, tek iş parçacıklı) motor dosyalarını public/engine altına kopyalar.
// Bu sürüm COOP/COEP başlığı gerektirmez; her statik hostta çalışır.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'stockfish');
const out = join(root, 'public', 'engine');

const files = [
  // .js dosyası .wasm dosyasını kendi adından türetir; isimleri değiştirme.
  ['bin/stockfish-19-lite-single.js', 'stockfish-19-lite-single.js'],
  ['bin/stockfish-19-lite-single.wasm', 'stockfish-19-lite-single.wasm'],
  ['Copying.txt', 'STOCKFISH-LICENSE-GPL3.txt'],
];

if (!existsSync(src)) {
  console.error('[copy-engine] node_modules/stockfish bulunamadı. Önce `npm install` çalıştırın.');
  process.exit(1);
}
mkdirSync(out, { recursive: true });
for (const [from, to] of files) copyFileSync(join(src, from), join(out, to));
console.log('[copy-engine] Stockfish 19 lite → public/engine');
