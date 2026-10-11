// Taktik bulmacaları: Lichess bulmaca veritabanından (CC0) süzülmüş gerçek oyun pozisyonları.
// Biçim: fen = rakibin hamlesinden ÖNCEKİ konum; moves[0] rakibin hamlesi, sonra çözüm (kullanıcı, rakip, kullanıcı...).
import { Chess, type Square } from 'chess.js';
import { describeFork, detectFork, lineMaterialSwing } from './tactics';
import { describeLine } from './describe';
import type { Rng } from './bot';

export interface RawPuzzle {
  id: string;
  fen: string;
  moves: string;
  rating: number;
  themes: string[];
  url: string;
}

export interface PuzzleData {
  source: string;
  sourceLastModified: string;
  extractedAt: string;
  puzzles: RawPuzzle[];
}

export interface Puzzle extends Omit<RawPuzzle, 'moves'> {
  moves: string[];
}

export type ThemeId =
  | 'hangingPiece'
  | 'fork'
  | 'pin'
  | 'skewer'
  | 'discoveredAttack'
  | 'mateIn1'
  | 'mateIn2'
  | 'backRankMate'
  | 'smotheredMate'
  | 'trappedPiece'
  | 'deflection'
  | 'capturingDefender'
  | 'interference'
  | 'promotion';

export interface ThemeInfo {
  id: ThemeId;
  name: string;
  /** Tema ne demek? */
  what: string;
  /** Oyunda nasıl fark edilir? */
  spot: string;
  /** 400–900 için öncelik (1 = en önemli). */
  priority: 1 | 2 | 3;
}

export const THEMES: ThemeInfo[] = [
  {
    id: 'hangingPiece',
    name: 'Savunmasız taş',
    what: 'Rakibin korumasız bıraktığı bir taşı bedavaya almak.',
    spot: 'Rakip her hamle yaptığında sor: "Hangi taşı korumasız kaldı? Ben neyi alabilirim?"',
    priority: 1,
  },
  {
    id: 'mateIn1',
    name: '1 hamlede mat',
    what: 'Tek hamlede şahı mat etmek.',
    spot: 'Önce tüm şah çekişlere bak. Rakip şahın kaçabileceği kareleri say.',
    priority: 1,
  },
  {
    id: 'fork',
    name: 'Çatal',
    what: 'Tek taşla aynı anda iki (veya daha fazla) taşa saldırmak. Rakip ancak birini kurtarabilir.',
    spot: 'Rakibin şahı, veziri ve kaleleri arasında atının sıçrayabileceği ortak bir kare var mı?',
    priority: 1,
  },
  {
    id: 'backRankMate',
    name: 'Arka yatay matı',
    what: 'Piyonlarının arkasına hapsolmuş şahı, son yatayda kale veya vezirle mat etmek.',
    spot: 'Rakibin şahı rok yapmış ve önündeki piyonlar hiç oynamamışsa son yatay zayıftır. Kendi şahın için de "luft" (kaçış karesi) aç.',
    priority: 1,
  },
  {
    id: 'pin',
    name: 'Açmaz',
    what: 'Bir taşı, arkasındaki daha değerli taş (çoğu zaman şah) yüzünden hareket edemez hâle getirmek.',
    spot: 'Fil, kale veya vezirinin çizgisinde iki rakip taş üst üste mi duruyor?',
    priority: 1,
  },
  {
    id: 'mateIn2',
    name: '2 hamlede mat',
    what: 'Zorlayıcı bir hamleden sonra mat etmek.',
    spot: 'Şah çeken her hamleyi dene; rakibin cevaplarından sonra mat var mı?',
    priority: 2,
  },
  {
    id: 'skewer',
    name: 'Şiş',
    what: 'Değerli bir taşa (şah/vezir) saldırıp, o kaçınca arkasındaki taşı almak. Açmazın tersi.',
    spot: 'Şah ve vezir ya da şah ve kale aynı çizgide mi? Önlerine uzun menzilli taşınla gel.',
    priority: 2,
  },
  {
    id: 'discoveredAttack',
    name: 'Keşif saldırısı',
    what: 'Önündeki taşı oynatarak arkadaki fil/kale/vezirin saldırısını açmak; iki tehdit birden.',
    spot: 'Uzun menzilli taşının önünde kendi taşın mı var? Onu tehditle oynatırsan arkadaki de saldırır.',
    priority: 2,
  },
  {
    id: 'trappedPiece',
    name: 'Kapana kısılmış taş',
    what: 'Kaçacak güvenli karesi olmayan bir taşı kuşatıp kazanmak.',
    spot: 'Rakibin taşı kenarda ya da derinde mi? Gidebileceği tüm kareleri kontrol edebilir misin?',
    priority: 2,
  },
  {
    id: 'capturingDefender',
    name: 'Savunucuyu ortadan kaldırma',
    what: 'Bir taşı koruyan savunucuyu alıp, savunmasız kalan taşı kazanmak.',
    spot: 'Rakibin taşı "korunuyor" diye bırakma: koruyan taşı alabilir misin?',
    priority: 2,
  },
  {
    id: 'deflection',
    name: 'Saptırma',
    what: 'Önemli bir kareyi ya da taşı koruyan rakip taşı, oradan uzaklaşmaya zorlamak.',
    spot: 'Rakip taşlardan biri iki işi birden mi yapıyor? Onu bir işe çekersen diğeri açıkta kalır.',
    priority: 3,
  },
  {
    id: 'interference',
    name: 'Araya girme',
    what: 'İki rakip taşın arasına girip aralarındaki savunma bağını kesmek.',
    spot: 'Rakip taşlar birbirini uzaktan mı koruyor? Aradaki kareye taş koyabilir misin?',
    priority: 3,
  },
  {
    id: 'smotheredMate',
    name: 'Boğmaca matı',
    what: 'Kendi taşlarıyla çevrili, hareket edemeyen şahı atla mat etmek.',
    spot: 'Rakip şahın etrafındaki kareler kendi taşlarıyla mı dolu? At ile şah çekebilir misin?',
    priority: 3,
  },
  {
    id: 'promotion',
    name: 'Terfi',
    what: 'Piyonu son yatağa ulaştırıp vezir (veya başka taş) yapmak.',
    spot: 'İlerlemiş piyonunun önündeki kareyi kim kontrol ediyor? Savunucuyu saptırabilir misin?',
    priority: 3,
  },
];

export const THEME_BY_ID = Object.fromEntries(THEMES.map((t) => [t.id, t])) as Record<ThemeId, ThemeInfo>;

export function parsePuzzles(data: PuzzleData): Puzzle[] {
  return data.puzzles.map((p) => ({ ...p, moves: p.moves.split(' ') }));
}

export async function loadPuzzles(): Promise<{ puzzles: Puzzle[]; meta: Omit<PuzzleData, 'puzzles'> }> {
  const mod = (await import('../data/puzzles.json')).default as PuzzleData;
  const { puzzles, ...meta } = mod;
  return { puzzles: parsePuzzles({ ...mod, puzzles }), meta };
}

/** Kullanıcının puanına yakın, henüz çözülmemiş bir bulmaca seçer. Aralık bulunamazsa genişletir. */
export function pickPuzzle(
  all: Puzzle[],
  opts: { theme: ThemeId | null; rating: number; exclude?: Set<string>; onlyIds?: Set<string> },
  rng: Rng = Math.random,
): Puzzle | null {
  const pool = all.filter(
    (p) => (!opts.theme || p.themes.includes(opts.theme)) && (!opts.onlyIds || opts.onlyIds.has(p.id)),
  );
  if (pool.length === 0) return null;
  const fresh = pool.filter((p) => !opts.exclude?.has(p.id));
  const base = fresh.length ? fresh : pool;
  for (const width of [125, 250, 400, 700, 3000]) {
    const near = base.filter((p) => Math.abs(p.rating - opts.rating) <= width);
    if (near.length) return near[Math.floor(rng() * near.length)];
  }
  return base[Math.floor(rng() * base.length)];
}

/** Elo güncellemesi (bulmaca da bir "rakip" gibi). */
export function updateRating(user: number, puzzle: number, solved: boolean, attempts: number): number {
  const expected = 1 / (1 + 10 ** ((puzzle - user) / 400));
  const k = attempts < 20 ? 40 : 24;
  const next = user + k * ((solved ? 1 : 0) - expected);
  return Math.round(Math.max(100, Math.min(3000, next)));
}

export type MoveCheck = 'correct' | 'complete' | 'wrong';

/**
 * Kullanıcının hamlesini kontrol eder.
 * @param ply çözüm dizisindeki sıra (1 = kullanıcının ilk hamlesi; moves[0] rakibindir)
 */
export function checkPuzzleMove(puzzle: Puzzle, fenBefore: string, ply: number, uci: string): MoveCheck {
  const expected = puzzle.moves[ply];
  const isLast = ply >= puzzle.moves.length - 1;
  if (uci === expected) return isLast ? 'complete' : 'correct';
  // Lichess kuralı: mat eden alternatif hamle de kabul edilir.
  const c = new Chess(fenBefore);
  try {
    c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return 'wrong';
  }
  if (c.isCheckmate()) return 'complete';
  return 'wrong';
}

/** Bulmacanın başlangıç konumu (rakibin hamlesi yapıldıktan sonra) ve çözen taraf. */
export function puzzleStart(p: Puzzle): { fenBeforeOpp: string; fen: string; solver: 'w' | 'b'; oppMove: { from: string; to: string } } {
  const c = new Chess(p.fen);
  const u = p.moves[0];
  const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
  return { fenBeforeOpp: p.fen, fen: c.fen(), solver: c.turn(), oppMove: { from: m.from, to: m.to } };
}

// --- Kişisel ilerleme (yalnızca bu tarayıcıda) ---
export interface TacticsProgress {
  rating: number;
  attempts: number;
  streak: number;
  bestStreak: number;
  perTheme: Partial<Record<ThemeId, { ok: number; fail: number }>>;
  /** Yanlış çözülen bulmacalar: tekrar sorulur, ilk denemede çözülünce listeden çıkar. */
  failedIds: string[];
  seenIds: string[];
}

export const EMPTY_PROGRESS: TacticsProgress = {
  rating: 600,
  attempts: 0,
  streak: 0,
  bestStreak: 0,
  perTheme: {},
  failedIds: [],
  seenIds: [],
};

/** Bir bulmaca sonucunu ilerlemeye işler. */
export function recordResult(
  prog: TacticsProgress,
  puzzle: Puzzle,
  result: 'solved' | 'failed' | 'assisted',
): TacticsProgress {
  const themes = puzzle.themes.filter((t): t is ThemeId => t in THEME_BY_ID);
  const perTheme = { ...prog.perTheme };
  for (const t of themes) {
    const cur = perTheme[t] ?? { ok: 0, fail: 0 };
    perTheme[t] = result === 'solved' ? { ...cur, ok: cur.ok + 1 } : { ...cur, fail: cur.fail + 1 };
  }
  const solved = result === 'solved';
  const rating = result === 'assisted' ? prog.rating : updateRating(prog.rating, puzzle.rating, solved, prog.attempts);
  const streak = solved ? prog.streak + 1 : 0;
  const failed = new Set(prog.failedIds);
  if (solved) failed.delete(puzzle.id);
  else failed.add(puzzle.id);
  const seen = prog.seenIds.includes(puzzle.id) ? prog.seenIds : [...prog.seenIds, puzzle.id].slice(-2000);
  return {
    rating,
    attempts: prog.attempts + 1,
    streak,
    bestStreak: Math.max(prog.bestStreak, streak),
    perTheme,
    failedIds: [...failed],
    seenIds: seen,
  };
}

/** En zayıf temalar (en az 3 deneme yapılmış, başarı oranına göre). */
export function weakestThemes(prog: TacticsProgress, n = 3): { id: ThemeId; rate: number; total: number }[] {
  return (Object.entries(prog.perTheme) as [ThemeId, { ok: number; fail: number }][])
    .map(([id, s]) => ({ id, total: s.ok + s.fail, rate: s.ok / Math.max(1, s.ok + s.fail) }))
    .filter((x) => x.total >= 3)
    .sort((a, b) => a.rate - b.rate)
    .slice(0, n);
}

/** Çözülen bulmacanın düz Türkçe açıklaması: adım adım çözüm, ne kazanıldı, hangi taktik. */
export function explainSolution(p: Puzzle): { line: string[]; points: string[] } {
  const start = puzzleStart(p);
  const sol = p.moves.slice(1);
  const c = new Chess(start.fen);
  const points: string[] = [];
  sol.forEach((u, i) => {
    const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    if (i % 2 === 0 && !c.isCheckmate()) {
      const fork = detectFork(c, m.to as Square);
      if (fork) points.push(describeFork(fork));
    }
  });
  if (c.isCheckmate()) points.unshift('Mat! Rakip şahın kaçacak karesi kalmadı.');
  else {
    const swing = lineMaterialSwing(start.fen, sol, start.solver, 12).swing;
    if (swing > 0) points.unshift(`Bu hamlelerle yaklaşık ${swing} piyon değerinde malzeme kazandın.`);
  }
  const names = p.themes.filter((t): t is ThemeId => t in THEME_BY_ID).map((t) => THEME_BY_ID[t].name);
  if (names.length) points.push(`Taktik türü: ${names.join(', ')}.`);
  return { line: describeLine(start.fen, sol, start.solver, 8), points };
}