// Oyun durumuna dair küçük yardımcılar (chess.js üzerinde).
import { Chess, type Color, type Move, type Square } from 'chess.js';

/** Yasal değilse null döner, tahtayı değiştirmez. Terfi belirtilmezse vezir. */
export function tryMove(chess: Chess, from: string, to: string, promotion?: string): Move | null {
  try {
    return chess.move({ from, to, promotion: promotion ?? (isPromotionMove(chess, from, to) ? 'q' : undefined) });
  } catch {
    return null;
  }
}

export function isPromotionMove(chess: Chess, from: string, to: string): boolean {
  const p = chess.get(from as Square);
  if (!p || p.type !== 'p') return false;
  if (!((p.color === 'w' && to[1] === '8') || (p.color === 'b' && to[1] === '1'))) return false;
  return chess.moves({ square: from as Square, verbose: true }).some((m) => m.to === to);
}

export interface GameResult {
  over: boolean;
  winner: Color | null;
  reason: string | null;
}

export function gameResult(chess: Chess): GameResult {
  if (chess.isCheckmate()) return { over: true, winner: chess.turn() === 'w' ? 'b' : 'w', reason: 'Mat' };
  if (chess.isStalemate()) return { over: true, winner: null, reason: 'Pat' };
  if (chess.isInsufficientMaterial()) return { over: true, winner: null, reason: 'Yetersiz malzeme' };
  if (chess.isThreefoldRepetition()) return { over: true, winner: null, reason: 'Üç kez tekrar' };
  if (chess.isDrawByFiftyMoves()) return { over: true, winner: null, reason: '50 hamle kuralı' };
  return { over: false, winner: null, reason: null };
}

/** Hamle dizisinden (UCI) oyun kurar. */
export function chessFromMoves(startFen: string, uciMoves: string[]): Chess {
  const c = new Chess(startFen);
  for (const u of uciMoves) c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
  return c;
}
