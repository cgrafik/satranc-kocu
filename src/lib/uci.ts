// UCI protokol çıktısını ayrıştırma (saf fonksiyonlar, test edilebilir).

/** Skor her zaman HAMLE SIRASI KİMDEYSE onun bakış açısındandır (UCI standardı). */
export type Score = { type: 'cp'; value: number } | { type: 'mate'; value: number };

export interface PvLine {
  multipv: number;
  depth: number;
  score: Score;
  /** Binde olarak [kazanma, beraberlik, kaybetme], hamle sırası olan taraf için. */
  wdl?: [number, number, number];
  /** Skor yalnızca alt/üst sınırsa (aspiration) true. */
  bound?: 'lower' | 'upper';
  pv: string[];
}

export function parseInfo(line: string): PvLine | null {
  if (!line.startsWith('info ') || !line.includes(' pv ') || !line.includes(' score ')) return null;
  const t = line.split(/\s+/);
  let depth = 0;
  let multipv = 1;
  let score: Score | null = null;
  let wdl: [number, number, number] | undefined;
  let bound: 'lower' | 'upper' | undefined;
  let pv: string[] = [];
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'depth':
        depth = Number(t[++i]);
        break;
      case 'multipv':
        multipv = Number(t[++i]);
        break;
      case 'score': {
        const kind = t[++i];
        const v = Number(t[++i]);
        if (kind === 'cp') score = { type: 'cp', value: v };
        else if (kind === 'mate') score = { type: 'mate', value: v };
        if (t[i + 1] === 'lowerbound') { bound = 'lower'; i++; }
        else if (t[i + 1] === 'upperbound') { bound = 'upper'; i++; }
        break;
      }
      case 'wdl':
        wdl = [Number(t[i + 1]), Number(t[i + 2]), Number(t[i + 3])];
        i += 3;
        break;
      case 'pv':
        pv = t.slice(i + 1).filter(Boolean);
        i = t.length;
        break;
    }
  }
  if (!score || pv.length === 0 || !Number.isFinite(depth)) return null;
  return { multipv, depth, score, wdl, bound, pv };
}

export function parseBestMove(line: string): { best: string | null } | null {
  const m = /^bestmove\s+(\S+)/.exec(line);
  if (!m) return null;
  return { best: m[1] === '(none)' ? null : m[1] };
}

export function uciToMove(uci: string): { from: string; to: string; promotion?: string } {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined };
}
