// Bitmiş bir oyunun tamamını analiz edip kişisel rapor çıkarır.
// Her konum bir kez analiz edilir: hamle i'nin "öncesi" = konum i, "sonrası" = konum i+1.
import type { Analysis, AnalyzeOptions } from './engine';
import { reviewMove, type MistakeTag, type MoveClass, type MoveReview } from './coach';
import { baseTime, type ParsedGame } from './importer';

export const GAME_ANALYSIS_OPTS: AnalyzeOptions = { depth: 11, multipv: 2, movetime: 900, timeoutMs: 5000 };

export interface GameReport {
  id: string;
  myColor: 'w' | 'b';
  /** Yalnızca kullanıcının hamleleri. */
  reviews: MoveReview[];
  /** Tüm hamlelerin SAN listesi (gezinme için). */
  sans: string[];
  fens: string[];
  accuracy: number | null;
  counts: Partial<Record<MoveClass, number>>;
  tags: Partial<Record<MistakeTag, number>>;
  /** En kritik anlar: kayba göre sıralı ply indeksleri. */
  critical: number[];
  analyzedAt: string;
}

export function accuracyOf(losses: number[]): number | null {
  if (losses.length === 0) return null;
  const acc = losses.map((l) => Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * l) - 3.1669)));
  return Math.round(acc.reduce((a, b) => a + b, 0) / acc.length);
}

export async function analyzeGame(
  game: ParsedGame,
  myColor: 'w' | 'b',
  analyze: (fen: string) => Promise<Analysis>,
  opts: { id: string; onProgress?: (done: number, total: number) => void; isCancelled?: () => boolean },
): Promise<GameReport | null> {
  const fens = [game.startFen, ...game.moves.map((m) => m.fenAfter)];
  const base = baseTime(game.headers.TimeControl);
  // Analiz edilmesi gereken konumlar: kullanıcının hamlesinden önceki ve sonraki konumlar
  const need = new Set<number>();
  game.moves.forEach((m, i) => {
    if (m.color === myColor) {
      need.add(i);
      need.add(i + 1);
    }
  });
  const order = [...need].sort((a, b) => a - b);
  const analyses = new Map<number, Analysis>();
  let done = 0;
  for (const i of order) {
    if (opts.isCancelled?.()) return null;
    const a = await analyze(fens[i]);
    analyses.set(i, a);
    opts.onProgress?.(++done, order.length);
  }

  const reviews: MoveReview[] = [];
  game.moves.forEach((m, i) => {
    if (m.color !== myColor) return;
    const before = analyses.get(i);
    if (!before || before.lines.length === 0) return;
    const after = analyses.get(i + 1);
    const r = reviewMove(m.fenBefore, { from: m.from, to: m.to, promotion: m.uci[4] }, before, after && after.lines.length ? after : null, i);
    if (base && m.clock !== undefined && m.clock < base * 0.1 && (r.cls === 'mistake' || r.cls === 'blunder')) r.tags.push('timePressure');
    reviews.push(r);
  });

  const counts: GameReport['counts'] = {};
  const tags: GameReport['tags'] = {};
  for (const r of reviews) {
    counts[r.cls] = (counts[r.cls] ?? 0) + 1;
    for (const t of r.tags) tags[t] = (tags[t] ?? 0) + 1;
  }
  const critical = reviews
    .filter((r) => r.cls === 'blunder' || r.cls === 'mistake' || r.cls === 'missed')
    .sort((a, b) => b.loss - a.loss)
    .slice(0, 5)
    .map((r) => r.ply);

  return {
    id: opts.id,
    myColor,
    reviews,
    sans: game.moves.map((m) => m.san),
    fens,
    accuracy: accuracyOf(reviews.map((r) => r.loss)),
    counts,
    tags,
    critical,
    analyzedAt: new Date().toISOString(),
  };
}

/** Birden çok raporda en sık hata türleri. */
export function topTags(reports: GameReport[], n = 3): { tag: MistakeTag; count: number }[] {
  const sum: Partial<Record<MistakeTag, number>> = {};
  for (const r of reports) for (const [t, c] of Object.entries(r.tags) as [MistakeTag, number][]) sum[t] = (sum[t] ?? 0) + c;
  return (Object.entries(sum) as [MistakeTag, number][])
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}
