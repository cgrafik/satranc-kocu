// chess.com'un herkese açık API'sinden (anahtar gerekmez) BİTMİŞ oyunları getirir ve PGN'i çözümler.
// https://www.chess.com/news/view/published-data-api — arşivler yalnızca tamamlanmış oyunları içerir.
import { Chess } from 'chess.js';

export interface GameMeta {
  url: string;
  endTime: number; // unix saniye
  timeClass: string; // bullet | blitz | rapid | daily
  timeControl: string;
  myColor: 'w' | 'b';
  myResult: 'win' | 'loss' | 'draw';
  me: { username: string; rating: number };
  opponent: { username: string; rating: number };
  pgn: string;
}

export interface ParsedMove {
  uci: string;
  san: string;
  from: string;
  to: string;
  fenBefore: string;
  fenAfter: string;
  color: 'w' | 'b';
  /** Hamleden sonra kalan süre (saniye), PGN'de varsa. */
  clock?: number;
}

export interface ParsedGame {
  headers: Record<string, string>;
  startFen: string;
  moves: ParsedMove[];
}

export class ImportError extends Error {}

type Fetch = typeof fetch;

interface CCPlayer {
  username: string;
  rating: number;
  result: string;
}
interface CCGame {
  url: string;
  pgn?: string;
  end_time: number;
  time_class: string;
  time_control: string;
  rules: string;
  white: CCPlayer;
  black: CCPlayer;
}

const DRAW_RESULTS = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);

export function normalizeUsername(u: string): string {
  return u.trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?chess\.com\/member\//i, '').replace(/\/.*$/, '').toLowerCase();
}

async function getJson(url: string, f: Fetch): Promise<unknown> {
  let res: Response;
  try {
    res = await f(url, { headers: { Accept: 'application/json' } });
  } catch {
    throw new ImportError("chess.com'a ulaşılamadı. İnternet bağlantını kontrol et.");
  }
  if (res.status === 404) throw new ImportError('Bu kullanıcı adıyla chess.com hesabı bulunamadı.');
  if (res.status === 429) throw new ImportError('chess.com çok fazla istek aldı; biraz sonra tekrar dene.');
  if (!res.ok) throw new ImportError(`chess.com hata verdi (${res.status}).`);
  return res.json();
}

/** Bir chess.com oyununu uygulamanın biçimine çevirir. Standart satranç değilse null. */
export function toMeta(g: CCGame, username: string): GameMeta | null {
  if (g.rules !== 'chess' || !g.pgn) return null;
  const u = username.toLowerCase();
  const isWhite = g.white.username.toLowerCase() === u;
  const isBlack = g.black.username.toLowerCase() === u;
  if (!isWhite && !isBlack) return null;
  const mine = isWhite ? g.white : g.black;
  const theirs = isWhite ? g.black : g.white;
  const myResult = mine.result === 'win' ? 'win' : DRAW_RESULTS.has(mine.result) ? 'draw' : 'loss';
  return {
    url: g.url,
    endTime: g.end_time,
    timeClass: g.time_class,
    timeControl: g.time_control,
    myColor: isWhite ? 'w' : 'b',
    myResult,
    me: { username: mine.username, rating: mine.rating },
    opponent: { username: theirs.username, rating: theirs.rating },
    pgn: g.pgn,
  };
}

/** Son oyunlar (yeniden eskiye), en fazla `limit` tane; en fazla 3 aylık arşive bakar. */
export async function fetchRecentGames(username: string, limit = 20, f: Fetch = fetch): Promise<GameMeta[]> {
  const user = normalizeUsername(username);
  if (!/^[a-z0-9_-]{3,25}$/.test(user)) throw new ImportError('Geçerli bir chess.com kullanıcı adı yaz.');
  const arch = (await getJson(`https://api.chess.com/pub/player/${user}/games/archives`, f)) as { archives?: string[] };
  const archives = (arch.archives ?? []).slice().reverse().slice(0, 3);
  if (archives.length === 0) throw new ImportError('Bu hesapta henüz bitmiş oyun yok.');
  const out: GameMeta[] = [];
  for (const a of archives) {
    const data = (await getJson(a, f)) as { games?: CCGame[] };
    const games = (data.games ?? []).slice().sort((x, y) => y.end_time - x.end_time);
    for (const g of games) {
      const m = toMeta(g, user);
      if (m) out.push(m);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

function parseClock(s: string): number {
  const [h, m, sec] = s.split(':');
  return Number(h) * 3600 + Number(m) * 60 + Number(sec);
}

/** PGN'i çözümler (chess.com saat yorumları dahil). Geçersizse ImportError. */
export function parsePgn(pgn: string): ParsedGame {
  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch (e) {
    throw new ImportError(`PGN okunamadı: ${(e as Error).message}`);
  }
  const headers = chess.getHeaders() as Record<string, string>;
  const history = chess.history({ verbose: true });
  if (history.length === 0) throw new ImportError('PGN içinde hamle yok.');
  const clocks = [...pgn.matchAll(/\[%clk\s+([\d:.]+)\]/g)].map((m) => parseClock(m[1]));
  const useClocks = clocks.length === history.length;
  return {
    headers,
    startFen: history[0].before,
    moves: history.map((m, i) => ({
      uci: m.from + m.to + (m.promotion ?? ''),
      san: m.san,
      from: m.from,
      to: m.to,
      fenBefore: m.before,
      fenAfter: m.after,
      color: m.color,
      clock: useClocks ? clocks[i] : undefined,
    })),
  };
}

/** "600", "180+2", "1/86400" → başlangıç süresi (saniye); günlük oyunlarda null. */
export function baseTime(timeControl: string | undefined): number | null {
  if (!timeControl || timeControl.includes('/')) return null;
  const base = Number(timeControl.split('+')[0]);
  return Number.isFinite(base) && base > 0 ? base : null;
}

export const TIME_CLASS_TR: Record<string, string> = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', daily: 'Günlük' };
