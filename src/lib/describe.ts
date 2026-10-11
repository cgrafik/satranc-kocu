// Hamleleri satranç notasyonu yerine düz Türkçe cümleye çevirir.
// "Nf3" → "Atını g1'den f3'e götür", rakip için "Rakip atıyla e5'teki piyonunu alır" gibi.
import { Chess, type Move, type PieceSymbol } from 'chess.js';
import { pieceForm, squareLoc, squareTo } from './tactics';

/**
 * imp: emir (sana öneri)            "Atını f3'e götür"
 * pastMine: senin yaptığın          "Atını f3'e götürdün"
 * futureMine: bir devamda sen       "atını f3'e götürürsün"
 * oppPast: rakibin yaptığı          "Rakip atını f3'e getirdi"
 * oppFuture: rakibin yapacağı       "Rakip atıyla e5'teki piyonunu alır"
 * oppIf: koşul                      "Rakip atını f3'e getirirse"
 * oppCan: olasılık / tehdit         "Rakip atıyla e5'teki piyonunu alabilir"
 */
export type Voice = 'imp' | 'pastMine' | 'futureMine' | 'oppPast' | 'oppFuture' | 'oppIf' | 'oppCan';

const VERBS = {
  al: { imp: 'al', pastMine: 'aldın', futureMine: 'alırsın', oppPast: 'aldı', oppFuture: 'alır', oppIf: 'alırsa', oppCan: 'alabilir', cv: 'alıp' },
  sur: { imp: 'sür', pastMine: 'sürdün', futureMine: 'sürersin', oppPast: 'sürdü', oppFuture: 'sürer', oppIf: 'sürerse', oppCan: 'sürebilir', cv: 'sürüp' },
  move: { imp: 'götür', pastMine: 'götürdün', futureMine: 'götürürsün', oppPast: 'getirdi', oppFuture: 'getirir', oppIf: 'getirirse', oppCan: 'getirebilir', cv: 'götürüp' },
  yap: { imp: 'yap', pastMine: 'yaptın', futureMine: 'yaparsın', oppPast: 'yaptı', oppFuture: 'yapar', oppIf: 'yaparsa', oppCan: 'yapabilir', cv: 'yapıp' },
} as const;

const INSTR_MINE: Record<PieceSymbol, string> = { p: 'piyonunla', n: 'atınla', b: 'filinle', r: 'kalenle', q: 'vezirinle', k: 'şahınla' };
const INSTR_THEIRS: Record<PieceSymbol, string> = { p: 'piyonuyla', n: 'atıyla', b: 'filiyle', r: 'kalesiyle', q: 'veziriyle', k: 'şahıyla' };
const PROMO: Record<string, string> = { q: 'vezir', r: 'kale', b: 'fil', n: 'at' };

/** "e2'den", "f6'dan", "e4'ten" ayrılma eki. */
export function squareFrom(sq: string): string {
  const s: Record<string, string> = { '1': "'den", '2': "'den", '3': "'ten", '4': "'ten", '5': "'ten", '6': "'dan", '7': "'den", '8': "'den" };
  return sq + (s[sq[1]] ?? "'den");
}

/** Cümleyi noktayla bitirir; zaten ! veya . ile bitiyorsa dokunmaz. */
export function sentence(s: string): string {
  return /[.!?]$/.test(s) ? s : s + '.';
}

export function cap(s: string): string {
  return s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1);
}

const isOpp = (v: Voice) => v.startsWith('opp');

/** chess.js Move nesnesini cümleye çevirir (nokta olmadan). */
export function describeMoveObj(m: Move, voice: Voice, opts: { withFrom?: boolean; check?: boolean; mate?: boolean } = {}): string {
  const opp = isOpp(voice);
  const subject = opp ? 'Rakip ' : '';
  let body: string;
  if (m.isKingsideCastle() || m.isQueensideCastle()) {
    body = `${m.isKingsideCastle() ? 'kısa' : 'uzun'} rok ${VERBS.yap[voice]}`;
  } else {
    const withFrom = opts.withFrom ?? !opp;
    const from = withFrom ? `${squareFrom(m.from)} ` : '';
    if (m.captured) {
      const instr = (opp ? INSTR_THEIRS : INSTR_MINE)[m.piece];
      // Rakip benim taşımı alıyorsa "piyonunu", ben rakibinkini alıyorsam "piyonu"
      const target = `${squareLoc(m.to)} ${pieceForm(m.captured, opp ? 'myAcc' : 'acc')}`;
      // "Atınla f3'ten e5'teki piyonu al"
      const fromPart = withFrom ? `${squareFrom(m.from)} ` : '';
      if (m.promotion) body = `${instr} ${fromPart}${target} ${VERBS.al.cv} ${PROMO[m.promotion]} ${VERBS.yap[voice]}`;
      else body = `${instr} ${fromPart}${target} ${VERBS.al[voice]}`;
      if (m.isEnPassant()) body += ' (geçerken alma)';
    } else {
      const obj = pieceForm(m.piece, opp ? 'theirAcc' : 'myAcc');
      const verb = m.piece === 'p' ? VERBS.sur : VERBS.move;
      if (m.promotion) body = `${obj} ${from}${squareTo(m.to)} ${verb.cv} ${PROMO[m.promotion]} ${VERBS.yap[voice]}`;
      else body = `${obj} ${from}${squareTo(m.to)} ${verb[voice]}`;
    }
  }
  const mate = opts.mate ?? m.san.includes('#');
  const check = opts.check ?? (m.san.includes('+') && !mate);
  const tail = mate ? ' — bu mat!' : check ? ' (şah çekerek)' : '';
  const s = subject + body + tail;
  return opp ? s : cap(s);
}

/** fen konumunda uci hamlesini cümleye çevirir. Hamle geçersizse uci döner. */
export function describeMove(fen: string, uci: string, voice: Voice, opts: { withFrom?: boolean } = {}): string {
  const c = new Chess(fen);
  try {
    const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return describeMoveObj(m, voice, opts);
  } catch {
    return uci;
  }
}

/**
 * Bir devamı adım adım anlatır. me = kullanıcının rengi.
 * Örn: ["Rakip atıyla g5'teki vezirini alır.", "Sen atını b1'den c3'e götürürsün.", ...]
 */
export function describeLine(fen: string, uciLine: string[], me: 'w' | 'b', max = 4): string[] {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const u of uciLine.slice(0, max)) {
    let m: Move;
    try {
      m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    } catch {
      break;
    }
    const mine = m.color === me;
    const s = describeMoveObj(m, mine ? 'futureMine' : 'oppFuture', { withFrom: false });
    out.push((mine ? `Sen ${s.charAt(0).toLocaleLowerCase('tr-TR')}${s.slice(1)}` : s) + '.');
  }
  return out;
}

/** Hamle listesi için kısa, harfsiz gösterim: "Nf3" → "♘f3", "exd5" → "exd5". */
export function toFigurine(san: string): string {
  const map: Record<string, string> = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };
  return san.replace(/[KQRBN]/g, (ch) => map[ch]);
}
