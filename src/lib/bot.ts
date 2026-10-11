// Rakip bot: Stockfish'in aday hamlelerinden insan benzeri seçim yaparak zayıflatılır.
// Stockfish'in kendi UCI_Elo ayarı en düşük 1320 olduğundan 400–900 bandı için yeterince zayıf değildir;
// bu yüzden düşük derinlik + MultiPV + olasılıklı seçim + ara sıra rastgele hamle kullanılır.
import { Chess } from 'chess.js';
import type { Analysis, AnalyzeOptions } from './engine';
import { scoreToNumber } from './evaluation';

export type LevelId = 'baslangic' | 'kolay' | 'orta' | 'ileri' | 'usta';

export interface BotLevel {
  id: LevelId;
  name: string;
  /** Kullanıcıya gösterilen yaklaşık güç (kalibrasyon notuna bakın). */
  approx: string;
  depth: number;
  multipv: number;
  /** Softmax sıcaklığı (santipiyon). Büyüdükçe zayıf adaylar daha sık seçilir. */
  temperature: number;
  /** Tamamen rastgele yasal hamle oynama olasılığı. */
  randomRate: number;
  /** Mat-1'i her zaman görür mü? */
  seesMateInOne: boolean;
}

export const LEVELS: BotLevel[] = [
  { id: 'baslangic', name: 'Başlangıç', approx: '≈ 400', depth: 3, multipv: 8, temperature: 260, randomRate: 0.12, seesMateInOne: false },
  { id: 'kolay', name: 'Kolay', approx: '≈ 600', depth: 4, multipv: 7, temperature: 170, randomRate: 0.07, seesMateInOne: false },
  { id: 'orta', name: 'Orta', approx: '≈ 800', depth: 5, multipv: 6, temperature: 115, randomRate: 0.04, seesMateInOne: true },
  { id: 'ileri', name: 'İleri', approx: '≈ 1000', depth: 6, multipv: 5, temperature: 70, randomRate: 0.02, seesMateInOne: true },
  { id: 'usta', name: 'Usta', approx: '1800+', depth: 14, multipv: 1, temperature: 0, randomRate: 0, seesMateInOne: true },
];

export function getLevel(id: LevelId): BotLevel {
  return LEVELS.find((l) => l.id === id) ?? LEVELS[0];
}

export function botSearchOptions(level: BotLevel): AnalyzeOptions {
  return { depth: level.depth, multipv: level.multipv, timeoutMs: 6000 };
}

export type Rng = () => number;

/** Analiz sonuçlarından seviyeye göre hamle seçer (UCI döndürür). */
export function pickBotMove(fen: string, level: BotLevel, analysis: Analysis | null, rng: Rng = Math.random): string | null {
  const chess = new Chess(fen);
  const legal = chess.moves({ verbose: true });
  if (legal.length === 0) return null;
  const toUci = (m: { from: string; to: string; promotion?: string }) => m.from + m.to + (m.promotion ?? '');

  const lines = analysis?.lines.filter((l) => l.pv.length > 0) ?? [];
  if (lines.length === 0) return toUci(legal[Math.floor(rng() * legal.length)]);

  const best = lines[0];
  if (level.seesMateInOne && best.score.type === 'mate' && best.score.value === 1) return best.pv[0];
  if (level.temperature === 0) return best.pv[0];

  if (rng() < level.randomRate) {
    // Başlangıç seviyesinde rastgele hamleler de "doğal" görünsün: almalar ve gelişim hamleleri biraz daha olası.
    const weights = legal.map((m) => (m.captured ? 2 : 1) + (m.piece !== 'k' ? 0.5 : 0));
    return toUci(legal[weightedIndex(weights, rng)]);
  }

  const bestVal = scoreToNumber(best.score);
  const weights = lines.map((l) => {
    const diff = Math.min(2000, bestVal - scoreToNumber(l.score));
    return Math.exp(-diff / level.temperature);
  });
  return lines[weightedIndex(weights, rng)].pv[0];
}

function weightedIndex(weights: number[], rng: Rng): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

/** Testler için tekrarlanabilir rastgele sayı üreteci (mulberry32). */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
