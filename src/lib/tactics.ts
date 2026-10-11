// Tahtadaki statik durumu okuyan yardımcılar (motor gerektirmez).
// Bunlar açıklama metni ve tahta vurguları içindir; "hata mı?" kararı motora aittir.
import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js';

export const PIECE_VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

const PIECE_NAME_TR: Record<PieceSymbol, string> = {
  p: 'piyon',
  n: 'at',
  b: 'fil',
  r: 'kale',
  q: 'vezir',
  k: 'şah',
};

export function pieceName(p: PieceSymbol): string {
  return PIECE_NAME_TR[p];
}

/**
 * Ünlü uyumuna göre hazır çekimler.
 * myNom: "atın" (senin atın), myAcc: "atını", myDat: "atına",
 * theirAcc: "atını / kalesini" (rakibin ...), acc: "atı / kaleyi" (belirli nesne).
 */
const FORMS: Record<PieceSymbol, Record<'myNom' | 'myAcc' | 'myDat' | 'theirAcc' | 'acc', string>> = {
  p: { myNom: 'piyonun', myAcc: 'piyonunu', myDat: 'piyonuna', theirAcc: 'piyonunu', acc: 'piyonu' },
  n: { myNom: 'atın', myAcc: 'atını', myDat: 'atına', theirAcc: 'atını', acc: 'atı' },
  b: { myNom: 'filin', myAcc: 'filini', myDat: 'filine', theirAcc: 'filini', acc: 'fili' },
  r: { myNom: 'kalen', myAcc: 'kaleni', myDat: 'kalene', theirAcc: 'kalesini', acc: 'kaleyi' },
  q: { myNom: 'vezirin', myAcc: 'vezirini', myDat: 'vezirine', theirAcc: 'vezirini', acc: 'veziri' },
  k: { myNom: 'şahın', myAcc: 'şahını', myDat: 'şahına', theirAcc: 'şahını', acc: 'şahı' },
};

export function pieceForm(p: PieceSymbol, form: keyof (typeof FORMS)['p']): string {
  return FORMS[p][form];
}

export function colorName(c: Color): string {
  return c === 'w' ? 'Beyaz' : 'Siyah';
}

export function opposite(c: Color): Color {
  return c === 'w' ? 'b' : 'w';
}

/** Türkçe cebirsel notasyon: Ş=şah, V=vezir, K=kale, F=fil, A=at. "Nf3" → "Af3", "e8=Q" → "e8=V". */
export function toTurkishSan(san: string): string {
  const map: Record<string, string> = { K: 'Ş', Q: 'V', R: 'K', B: 'F', N: 'A' };
  return san.replace(/[KQRBN]/g, (ch) => map[ch]);
}

/** Kare adını Türkçe ekle birlikte yazmak için: "e4'teki", "f5'teki" vb. */
export function squareLoc(sq: string): string {
  // Türkçede rakamın okunuşuna göre ünsüz/ünlü uyumu: 1 bir'deki, 2 iki'deki, 3 üç'teki, 4 dört'teki,
  // 5 beş'teki, 6 altı'daki, 7 yedi'deki, 8 sekiz'deki
  const suffix: Record<string, string> = {
    '1': "'deki", '2': "'deki", '3': "'teki", '4': "'teki",
    '5': "'teki", '6': "'daki", '7': "'deki", '8': "'deki",
  };
  return sq + (suffix[sq[1]] ?? "'deki");
}

/** "e4'e", "f5'e" vb. yönelme eki. */
export function squareTo(sq: string): string {
  const suffix: Record<string, string> = {
    '1': "'e", '2': "'ye", '3': "'e", '4': "'e", '5': "'e", '6': "'ya", '7': "'ye", '8': "'e",
  };
  return sq + (suffix[sq[1]] ?? "'e");
}

export interface PieceOnSquare {
  square: Square;
  type: PieceSymbol;
  color: Color;
}

export function piecesOf(chess: Chess, color: Color): PieceOnSquare[] {
  const out: PieceOnSquare[] = [];
  for (const row of chess.board()) for (const p of row) if (p && p.color === color) out.push(p);
  return out;
}

export function material(chess: Chess, color: Color): number {
  return piecesOf(chess, color).reduce((s, p) => s + PIECE_VALUE[p.type], 0);
}

/** color açısından malzeme farkı (kendi - rakip). */
export function materialBalance(chess: Chess, color: Color): number {
  return material(chess, color) - material(chess, opposite(color));
}

export interface Hanging {
  square: Square;
  type: PieceSymbol;
  /** 'undefended': savunmasız ve saldırı altında; 'cheaper': daha değersiz bir taş tarafından saldırı altında. */
  reason: 'undefended' | 'cheaper';
  attackers: Square[];
}

/**
 * color renkli taşlardan tehlikede olanlar:
 *  - saldırı altında ve hiç savunanı yok, ya da
 *  - kendisinden daha değersiz bir taş tarafından saldırı altında (ör. piyon atına saldırıyor).
 * Açmazdaki saldıranlar da sayılır; bu yaklaşık bir göstergedir.
 */
export function hangingPieces(chess: Chess, color: Color): Hanging[] {
  const enemy = opposite(color);
  const out: Hanging[] = [];
  for (const p of piecesOf(chess, color)) {
    if (p.type === 'k') continue;
    const attackers = chess.attackers(p.square, enemy);
    if (attackers.length === 0) continue;
    const defenders = chess.attackers(p.square, color);
    const cheapest = Math.min(...attackers.map((s) => PIECE_VALUE[chess.get(s)!.type] || 100));
    if (defenders.length === 0) out.push({ square: p.square, type: p.type, reason: 'undefended', attackers });
    else if (cheapest < PIECE_VALUE[p.type]) out.push({ square: p.square, type: p.type, reason: 'cheaper', attackers });
  }
  return out;
}

/** from karesindeki taşın saldırdığı rakip taşlar. */
export function attackedBy(chess: Chess, from: Square): PieceOnSquare[] {
  const piece = chess.get(from);
  if (!piece) return [];
  const enemy = opposite(piece.color);
  return piecesOf(chess, enemy).filter((t) => chess.attackers(t.square, piece.color).includes(from));
}

export interface Fork {
  square: Square;
  piece: PieceSymbol;
  targets: PieceOnSquare[];
}

/**
 * Çatal: tek taşın aynı anda en az iki değerli hedefe (şah veya kendisinden değerli / savunmasız taş)
 * saldırması. square'deki taşın kendisi alınabilir durumdaysa ve hedefler küçükse çatal sayılmaz.
 */
export function detectFork(chess: Chess, square: Square): Fork | null {
  const piece = chess.get(square);
  if (!piece) return null;
  const own = piece.color;
  const targets = attackedBy(chess, square).filter((t) => {
    if (t.type === 'k') return true;
    if (t.type === 'p') return false;
    const defended = chess.attackers(t.square, opposite(own)).length > 0;
    return PIECE_VALUE[t.type] > PIECE_VALUE[piece.type] || !defended;
  });
  if (targets.length < 2) return null;
  return { square, piece: piece.type, targets };
}

export function describeFork(f: Fork): string {
  const names = f.targets
    .sort((a, b) => (b.type === 'k' ? 100 : PIECE_VALUE[b.type]) - (a.type === 'k' ? 100 : PIECE_VALUE[a.type]))
    .map((t) => `${pieceName(t.type)} (${t.square})`);
  const list = names.length === 2 ? `${names[0]} ve ${names[1]}` : `${names.slice(0, -1).join(', ')} ve ${names.at(-1)}`;
  return `Çatal: ${pieceName(f.piece)} aynı anda ${list} taşlarına saldırıyor.`;
}

/** Bir hamle dizisini uygulayıp malzeme değişimini (perspective açısından) döndürür. */
export function lineMaterialSwing(fen: string, uciMoves: string[], perspective: Color, maxPlies = 6): {
  swing: number;
  sans: string[];
  playedPlies: number;
} {
  const c = new Chess(fen);
  const start = materialBalance(c, perspective);
  const sans: string[] = [];
  let i = 0;
  // maxPlies kadar oyna; takas yarıdaysa (sıradaki hamle alma ise) takası bitirmek için 4 yarım hamleye kadar uzat.
  while (i < uciMoves.length) {
    const u = uciMoves[i];
    const isCapture = Boolean(c.get(u.slice(2, 4) as Square)) || /[qrbn]$/.test(u.length > 4 ? u : '');
    if (i >= maxPlies && (!isCapture || i >= maxPlies + 4)) break;
    try {
      sans.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san);
    } catch {
      break;
    }
    i++;
  }
  return { swing: materialBalance(c, perspective) - start, sans, playedPlies: i };
}

/** "e4'te", "f6'da" bulunma eki. */
export function squareAt(sq: string): string {
  const suffix: Record<string, string> = {
    '1': "'de", '2': "'de", '3': "'te", '4': "'te", '5': "'te", '6': "'da", '7': "'de", '8': "'de",
  };
  return sq + (suffix[sq[1]] ?? "'de");
}

/** Sırayı karşı tarafa geçiren FEN (null move). Geçersizse null. */
export function passTurnFen(fen: string): string | null {
  const parts = fen.split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  const out = parts.join(' ');
  try {
    const c = new Chess(fen);
    if (c.inCheck()) return null;
    new Chess(out);
    return out;
  } catch {
    return null;
  }
}
