// Bot seviyelerinin göreli gücünü doğrulayan bot-vs-bot turnuvası (yavaş).
// Çalıştırma: CALIBRATE=1 npx vitest run src/lib/bot.calibration.test.ts
// Not: Bu yalnızca seviyelerin birbirine göre sıralı olduğunu ölçer; chess.com puanına
// karşılığı insanlarla oynanmadan kesin olarak bilinemez ("≈" değerler tahminidir).
import { afterAll, describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { LEVELS, botSearchOptions, pickBotMove, seededRng, type BotLevel } from './bot';
import { createNodeEngine } from '../test/nodeEngine';
import { materialBalance } from './tactics';

const GAMES = Number(process.env.CALIBRATE_GAMES ?? 10);
const engine = createNodeEngine();
afterAll(() => engine.terminate());

async function play(white: BotLevel, black: BotLevel, seed: number): Promise<1 | 0.5 | 0> {
  const c = new Chess();
  const rng = seededRng(seed);
  for (let ply = 0; ply < 160 && !c.isGameOver(); ply++) {
    const lvl = c.turn() === 'w' ? white : black;
    const a = await engine.analyze(c.fen(), botSearchOptions(lvl));
    const u = pickBotMove(c.fen(), lvl, a, rng);
    if (!u) break;
    c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
  }
  if (c.isCheckmate()) return c.turn() === 'w' ? 0 : 1;
  if (c.isDraw() || c.isStalemate()) return 0.5;
  // Hamle sınırına ulaşıldı: malzeme farkıyla hakemlik
  const bal = materialBalance(c, 'w');
  return bal >= 3 ? 1 : bal <= -3 ? 0 : 0.5;
}

describe.skipIf(!process.env.CALIBRATE)('bot kalibrasyonu', () => {
  for (let i = 0; i + 1 < LEVELS.length; i++) {
    const weak = LEVELS[i];
    const strong = LEVELS[i + 1];
    it(`${strong.name} > ${weak.name}`, async () => {
      let score = 0;
      for (let g = 0; g < GAMES; g++) {
        score += g % 2 === 0 ? await play(strong, weak, g + 1) : 1 - (await play(weak, strong, g + 1));
      }
      console.log(`${strong.name} vs ${weak.name}: ${score}/${GAMES}`);
      expect(score / GAMES).toBeGreaterThan(0.6);
    }, 600000);
  }
});
