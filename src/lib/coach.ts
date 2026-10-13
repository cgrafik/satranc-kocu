// Hamle değerlendirme: motor analizini (hamle öncesi + sonrası) sade Türkçe geri bildirime çevirir.
// Kullanıcıya notasyon (Fxf7+ gibi) yerine düz cümle gösterilir: "Atını g1'den f3'e götür".
import { Chess, type Color, type Move, type PieceSymbol, type Square } from 'chess.js';
import type { Analysis } from './engine';
import { scoreFor, winPercent, formatScore, describeScore, scoreToNumber } from './evaluation';
import type { PvLine, Score } from './uci';
import {
  describeFork,
  detectDiscovered,
  detectFork,
  detectLineTactic,
  hangingPieces,
  lineMaterialSwing,
  opposite,
  pieceForm,
  regionOf,
  squareAt,
  squareLoc,
  toTurkishSan,
} from './tactics';
import { cap, describeLine, describeMoveObj } from './describe';

export type MoveClass = 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder' | 'missed';

export const CLASS_INFO: Record<MoveClass, { label: string; short: string; tone: 'good' | 'ok' | 'warn' | 'bad' }> = {
  best: { label: 'En iyi hamle', short: '★', tone: 'good' },
  excellent: { label: 'Çok iyi hamle', short: '!', tone: 'good' },
  good: { label: 'İyi hamle', short: '✓', tone: 'ok' },
  inaccuracy: { label: 'Daha iyisi vardı', short: '?!', tone: 'warn' },
  mistake: { label: 'Hata', short: '?', tone: 'bad' },
  blunder: { label: 'Büyük hata', short: '??', tone: 'bad' },
  missed: { label: 'Fırsatı kaçırdın', short: '✗', tone: 'warn' },
};

/**
 * Sınıflandırma eşikleri, hamle yapanın kazanma yüzdesindeki (0–100) kayba göre.
 * Lichess'in hata eşikleriyle (10/20/30 puanlık kazanma şansı farkı ≈ 5/10/15 yüzde) uyumlu,
 * 400–900 seviyesi için "iyi" bandı biraz geniş tutuldu.
 */
export const THRESHOLDS = { best: 1, excellent: 3, good: 6, inaccuracy: 10, mistake: 18 } as const;

export interface BoardArrow {
  from: string;
  to: string;
  color: 'green' | 'red' | 'orange' | 'blue' | 'purple';
}

/** Hata türü etiketleri (oyun raporunda en sık hataları saymak için). */
export type MistakeTag = 'hung' | 'missedThreat' | 'allowedMate' | 'missedMate' | 'missedCapture' | 'missedFork' | 'timePressure';

export const TAG_INFO: Record<MistakeTag, { label: string; tip: string; theme: string }> = {
  hung: { label: 'Taşını korumasız kareye götürdün', tip: 'Hamleni yapmadan önce sor: gittiğim kareye rakibin hangi taşı saldırıyor?', theme: 'hangingPiece' },
  missedThreat: { label: 'Rakibin tehdidini görmedin', tip: 'Rakip her hamle yaptığında önce sor: bu hamle neye saldırıyor?', theme: 'hangingPiece' },
  allowedMate: { label: 'Rakibe mat imkânı verdin', tip: 'Şahının etrafındaki kaçış karelerini kontrol et; arka sıra matına dikkat.', theme: 'backRankMate' },
  missedMate: { label: 'Mat fırsatını kaçırdın', tip: 'Her hamlede önce tüm şah çekişlere bak.', theme: 'mateIn1' },
  missedCapture: { label: 'Bedava taşı almadın', tip: 'Rakibin korumasız taşlarını her hamlede tara.', theme: 'hangingPiece' },
  missedFork: { label: 'Çatal fırsatını kaçırdın', tip: 'Atının sıçrayabileceği karelerden iki taşa birden saldırabilir misin?', theme: 'fork' },
  timePressure: { label: 'Süre baskısında hata yaptın', tip: 'Açılışta hızlı oyna, süreni karmaşık anlara sakla.', theme: 'mixed' },
};

export interface MoveReview {
  ply: number;
  mover: Color;
  san: string;
  trSan: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  cls: MoveClass;
  /** Hamle yapan açısından kazanma yüzdesi: en iyi hamleyle ve oynanan hamleyle. */
  winBest: number;
  winPlayed: number;
  loss: number;
  /** Beyaz bakışından değerlendirme (hamleden sonra). */
  whiteScoreAfter: Score;
  isBest: boolean;
  /** "Filini f1'den a6'ya götürdün" */
  playedText: string;
  /** Daha iyi hamle: düz cümle ("Atını g1'den f3'e götür") ve devamı adım adım. */
  best?: { uci: string; text: string; steps: string[] };
  /** Rakibin en güçlü cevabı ("Rakip piyonuyla a6'daki filini alır") ve devamı. */
  refutation?: { uci: string; text: string; steps: string[] };
  /** "Neden?" maddeleri. */
  reasons: string[];
  /** Hata türleri. */
  tags: MistakeTag[];
  beforeArrows: BoardArrow[];
  afterArrows: BoardArrow[];
  dangerSquares: string[];
  evalText: string;
}

const uciOf = (m: { from: string; to: string; promotion?: string }) => m.from + m.to + (m.promotion ?? '');

/** Cümle sonu noktalamasını toparlar: "bu mat!." → "bu mat!" */
const tidy = (s: string) => s.replace(/!\./g, '!').replace(/\.\./g, '.');

function moveOf(fen: string, uci: string): { chess: Chess; move: Move } | null {
  const chess = new Chess(fen);
  try {
    const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return { chess, move };
  } catch {
    return null;
  }
}

/** "8 piyon değerinde" gibi malzeme ifadesi. */
const worth = (n: number) => `${n} piyon değerinde`;

export function classify(loss: number, isBest: boolean): MoveClass {
  if (isBest || loss <= THRESHOLDS.best) return 'best';
  if (loss <= THRESHOLDS.excellent) return 'excellent';
  if (loss <= THRESHOLDS.good) return 'good';
  if (loss <= THRESHOLDS.inaccuracy) return 'inaccuracy';
  if (loss <= THRESHOLDS.mistake) return 'mistake';
  return 'blunder';
}

/**
 * @param before hamle öncesi konumun analizi (MultiPV ≥ 1, sıra hamle yapanda)
 * @param after hamle sonrası konumun analizi (sıra rakipte). Oyun bittiyse null olabilir.
 */
export function reviewMove(
  fenBefore: string,
  move: { from: string; to: string; promotion?: string },
  before: Analysis,
  after: Analysis | null,
  ply = 0,
): MoveReview {
  const board = new Chess(fenBefore);
  const mover = board.turn();
  const opp = opposite(mover);
  const hangingBefore = hangingPieces(board, mover);
  const played = board.move(move);
  const fenAfter = board.fen();
  const uci = uciOf(played);

  const bestLine = before.lines[0];
  const bestUci = bestLine?.pv[0] ?? before.bestMove ?? uci;
  const isBest = bestUci === uci;
  const bestScore: Score = bestLine ? bestLine.score : { type: 'cp', value: 0 };

  let playedScore: Score;
  if (board.isCheckmate()) playedScore = { type: 'mate', value: 1 };
  else if (board.isDraw() || board.isStalemate()) playedScore = { type: 'cp', value: 0 };
  else {
    const sameDepth = before.lines.find((l) => l.pv[0] === uci);
    if (sameDepth) playedScore = sameDepth.score;
    else if (after?.lines[0]) playedScore = scoreFor(after.lines[0].score, opp, mover);
    else playedScore = bestScore;
  }
  if (isBest) playedScore = bestScore;

  const winBest = winPercent(bestScore);
  const winPlayed = winPercent(playedScore);
  const loss = Math.max(0, winBest - winPlayed);
  let cls = classify(loss, isBest);

  const reasons: string[] = [];
  const beforeArrows: BoardArrow[] = [];
  const afterArrows: BoardArrow[] = [];
  const dangerSquares: string[] = [];
  const tags: MistakeTag[] = [];
  const playedText = describeMoveObj(played, 'pastMine');

  let best: MoveReview['best'];
  if (!isBest && bestLine) {
    const bm = moveOf(fenBefore, bestUci);
    if (bm) {
      best = { uci: bestUci, text: describeMoveObj(bm.move, 'imp'), steps: describeLine(fenBefore, bestLine.pv, mover, 4) };
      beforeArrows.push({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), color: 'green' });
    }
  }

  let refutation: MoveReview['refutation'];
  const reply = after?.lines[0];
  if (reply && reply.pv.length > 0) {
    const rm = moveOf(fenAfter, reply.pv[0]);
    if (rm) {
      refutation = { uci: reply.pv[0], text: describeMoveObj(rm.move, 'oppFuture'), steps: describeLine(fenAfter, reply.pv, mover, 4) };
      if (cls !== 'best' && cls !== 'excellent' && cls !== 'good') {
        afterArrows.push({ from: reply.pv[0].slice(0, 2), to: reply.pv[0].slice(2, 4), color: 'red' });
      }
    }
  }

  if (board.isCheckmate()) {
    reasons.push('Mat! Rakibin şahının kaçacak karesi yok. Oyunu kazandın.');
  } else if (board.isStalemate()) {
    reasons.push(
      winBest > 70
        ? 'Dikkat: Pat oldu, oyun berabere bitti. Kazanıyordun! Rakibin şahına mutlaka bir hamle hakkı bırak.'
        : 'Pat: rakibin yapabileceği hamle yok ama şahı tehdit altında değil, oyun berabere.',
    );
  } else {
    // 1) Rakip mat ediyor mu?
    const replyScoreMover = reply ? scoreFor(reply.score, opp, mover) : null;
    if (replyScoreMover?.type === 'mate' && replyScoreMover.value < 0 && !(bestScore.type === 'mate' && bestScore.value < 0)) {
      const n = Math.abs(replyScoreMover.value);
      reasons.push(
        n === 1
          ? `Bu hamle rakibe mat imkânı veriyor: ${refutation?.text}.`
          : `Bu hamleden sonra rakip ${n} hamlede mat edebilir. İlk adımı: ${refutation?.text}.`,
      );
      cls = 'blunder';
      tags.push('allowedMate');
    }

    // 2) Mat fırsatı kaçtı mı?
    if (bestScore.type === 'mate' && bestScore.value > 0 && !(playedScore.type === 'mate' && playedScore.value > 0) && best) {
      reasons.push(
        bestScore.value === 1
          ? `Mat vardı! ${best.text}.`
          : `Mat fırsatı vardı! ${best.text}; ${bestScore.value} hamlede mat ediyordun.`,
      );
      tags.push('missedMate');
    }

    // 3) Taş kaybı
    if (reply && refutation && cls !== 'best' && cls !== 'excellent') {
      const { swing } = lineMaterialSwing(fenAfter, reply.pv, mover, 6);
      if (swing <= -2) {
        const r = moveOf(fenAfter, reply.pv[0])!;
        const first = r.move;
        if (first.captured) {
          const capSq = first.to as Square;
          const wasHangingBefore = hangingBefore.some((h) => h.square === capSq);
          if (capSq === played.to) {
            reasons.push(`${cap(pieceForm(played.piece, 'myAcc'))} savunmasız bir kareye götürdün. ${refutation.text}.`);
            tags.push('hung');
          } else if (wasHangingBefore) {
            reasons.push(`Rakibin tehdidini kaçırdın: ${squareLoc(capSq)} ${pieceForm(first.captured, 'myNom')} zaten saldırı altındaydı. ${refutation.text}.`);
            tags.push('missedThreat');
          } else {
            reasons.push(`${refutation.text}.`);
          }
          dangerSquares.push(capSq);
        } else {
          const fork = detectFork(r.chess, first.to as Square);
          if (fork) reasons.push(`${refutation.text} ve çatal yapar. ${describeFork(fork)}`);
          else reasons.push(`${refutation.text} ve sonunda taş kaybediyorsun.`);
        }
        reasons.push(`Sonuçta yaklaşık ${worth(Math.abs(swing))} malzeme kaybediyorsun.`);
      }
    }

    // 4) Kaçırılan kazanç
    if (!isBest && bestLine && best) {
      const gainBest = lineMaterialSwing(fenBefore, bestLine.pv, mover, 6).swing;
      const bm = moveOf(fenBefore, bestUci)!;
      const fork = detectFork(bm.chess, bm.move.to as Square);
      if (gainBest >= 2) {
        if (bm.move.captured) {
          tags.push('missedCapture');
          const undefended = new Chess(fenBefore).attackers(bm.move.to as Square, opp).length === 0;
          reasons.push(
            undefended
              ? `Bunun yerine: ${best.text}. ${cap(squareLoc(bm.move.to))} ${pieceNom(bm.move.captured)} korumasızdı, bedava alabilirdin.`
              : `Bunun yerine: ${best.text}. Böylece yaklaşık ${worth(gainBest)} malzeme kazanıyordun.`,
          );
        } else if (fork) {
          tags.push('missedFork');
          reasons.push(`Bunun yerine: ${best.text}. ${describeFork(fork)}`);
        } else {
          reasons.push(`Bunun yerine: ${best.text}. Bu devamla yaklaşık ${worth(gainBest)} malzeme kazanıyordun.`);
        }
        if ((cls === 'mistake' || cls === 'blunder') && winPlayed >= 35) cls = 'missed';
      } else if (bestScore.type === 'mate' && bestScore.value > 0) {
        if ((cls === 'mistake' || cls === 'blunder') && winPlayed >= 35) cls = 'missed';
      }
    }

    // 5) İyi hamleler için olumlu geri bildirim
    if (cls === 'best' || cls === 'excellent' || cls === 'good') {
      const fork = detectFork(board, played.to as Square);
      if (played.captured) {
        const gain = lineMaterialSwing(fenBefore, [uci, ...(reply?.pv ?? [])], mover, 6).swing;
        reasons.push(gain >= 2 ? `Rakibin ${pieceForm(played.captured, 'theirAcc')} aldın ve malzeme kazandın.` : `Karşılıklı taş değişimi yaptın.`);
      }
      if (fork) reasons.push(describeFork(fork));
      if (board.inCheck() && !fork) reasons.push('Şah çektin; rakip önce şahını kurtarmak zorunda.');
      if (reasons.length === 0) reasons.push(isBest ? 'Motorun da en iyi bulduğu hamle.' : 'Sağlam bir hamle; konumunu korudun.');
      if (!isBest && best && loss > THRESHOLDS.best) reasons.push(`Motorun tercihi biraz farklıydı: ${best.text}.`);
    }

    // 6) Genel durum
    if (reasons.length === 0) {
      if (best) reasons.push(`Daha iyisi: ${best.text}.`);
      if (cls === 'inaccuracy') reasons.push('Taş kaybetmedin ama rakibe daha rahat bir oyun verdin.');
      else if ((cls === 'mistake' || cls === 'blunder') && refutation) reasons.push(`${refutation.text} ve konumun belirgin şekilde kötüleşir.`);
    }
  }

  if (!board.isGameOver()) {
    for (const h of hangingPieces(board, mover)) if (!dangerSquares.includes(h.square)) dangerSquares.push(h.square);
  }

  const whiteScoreAfter = scoreFor(
    after?.lines[0]?.score ?? (board.isCheckmate() ? { type: 'mate', value: 0 } : { type: 'cp', value: 0 }),
    opp,
    'w',
  );

  return {
    ply,
    mover,
    san: played.san,
    trSan: toTurkishSan(played.san),
    uci,
    fenBefore,
    fenAfter,
    cls,
    winBest,
    winPlayed,
    loss,
    whiteScoreAfter,
    isBest,
    playedText,
    best,
    refutation,
    reasons: reasons.map(tidy),
    tags: [...new Set(tags)],
    beforeArrows,
    afterArrows,
    dangerSquares,
    evalText: `${formatScore(whiteScoreAfter)} — ${describeScore(whiteScoreAfter)}`,
  };
}

function pieceNom(p: PieceSymbol): string {
  return { p: 'piyon', n: 'at', b: 'fil', r: 'kale', q: 'vezir', k: 'şah' }[p];
}

// ---------------------------------------------------------------------------
// "Rakibim ne tehdit ediyor?"
export interface ThreatInfo {
  ok: boolean;
  message: string;
  details: string[];
  /** Ne yapmalısın? (düz cümle) */
  advice?: string;
  arrows: BoardArrow[];
  dangerSquares: string[];
}

export function explainThreat(fen: string, passed: Analysis | null, current: Analysis | null): ThreatInfo {
  const chess = new Chess(fen);
  const me = chess.turn();
  const opp = opposite(me);
  const hanging = hangingPieces(chess, me);
  const dangerSquares = hanging.map((h) => h.square as string);
  const hangText = hanging.map((h) =>
    h.reason === 'undefended'
      ? `${cap(squareAt(h.square))} duran ${pieceForm(h.type, 'myNom')} saldırı altında ve onu koruyan yok.`
      : `${cap(squareAt(h.square))} duran ${pieceForm(h.type, 'myDat')} daha değersiz bir taş saldırıyor.`,
  );
  // Öneri: şu anki konumda en iyi hamle
  const bestNow = current?.lines[0]?.pv[0];
  const bestMove = bestNow ? moveOf(fen, bestNow) : null;
  const advice = bestMove ? describeMoveObj(bestMove.move, 'imp') : undefined;
  const adviceArrow: BoardArrow[] = bestMove ? [{ from: bestMove.move.from, to: bestMove.move.to, color: 'green' }] : [];

  if (chess.inCheck()) {
    return { ok: true, message: 'Şah altındasın! Önce şahını kurtarmalısın.', details: hangText, advice, arrows: adviceArrow, dangerSquares };
  }
  if (!passed || !passed.lines[0]) {
    return {
      ok: hanging.length > 0,
      message: hanging.length ? 'Dikkat: korumasız taşların var.' : 'Belirgin bir tehdit görünmüyor.',
      details: hangText,
      advice,
      arrows: adviceArrow,
      dangerSquares,
    };
  }
  const line = passed.lines[0];
  const tm = moveOf(passed.fen, line.pv[0]);
  if (!tm) return { ok: false, message: 'Tehdit hesaplanamadı.', details: hangText, advice, arrows: adviceArrow, dangerSquares };
  const arrows: BoardArrow[] = [{ from: tm.move.from, to: tm.move.to, color: 'orange' }];

  const oppNow = current?.lines[0] ? scoreFor(current.lines[0].score, me, opp) : ({ type: 'cp', value: 0 } as Score);
  const oppIfPass = line.score;
  const gain = scoreToNumber(oppIfPass) - scoreToNumber(oppNow);

  const details = [...hangText];
  let message: string;
  if (oppIfPass.type === 'mate' && oppIfPass.value > 0) {
    message =
      oppIfPass.value === 1
        ? `Mat tehdidi! ${describeMoveObj(tm.move, 'oppIf', { mate: false, check: false })}, mat olursun.`
        : `Mat tehdidi! Rakip ${oppIfPass.value} hamlede mat etmeye çalışıyor. İlk adımı: ${describeMoveObj(tm.move, 'oppFuture')}.`;
  } else if (gain > 150) {
    const fork = !tm.move.captured ? detectFork(tm.chess, tm.move.to as Square) : null;
    message = fork
      ? `Dikkat! ${describeMoveObj(tm.move, 'oppCan')} ve çatal yapar. ${describeFork(fork)}`
      : `Dikkat! ${describeMoveObj(tm.move, 'oppCan')}.`;
    const swing = lineMaterialSwing(passed.fen, line.pv, opp, 6).swing;
    if (swing >= 2) details.push(`Bu olursa yaklaşık ${worth(swing)} malzeme kaybedersin.`);
  } else {
    message = 'Şu an ciddi bir tehdit yok.';
    details.push(`Rakibin sıradaki mantıklı hamlesi: ${describeMoveObj(tm.move, 'oppFuture')}.`);
  }
  return { ok: true, message: tidy(message), details: details.map(tidy), advice, arrows: [...arrows, ...adviceArrow], dangerSquares };
}

// ---------------------------------------------------------------------------
// "Ne oynamalıyım?" / "Rakip bunu yaparsa ne yapmalıyım?" — doğrudan öneri.
export interface Advice {
  uci: string;
  /** "Atını g1'den f3'e götür" */
  text: string;
  reasons: string[];
  /** Rakibin muhtemel cevabı. */
  reply?: string;
  alternatives: { uci: string; text: string; quality: string }[];
  arrows: BoardArrow[];
}

/** Bir hamlenin neden iyi olduğunu kısaca açıklar (gelecek zaman). */
function whyGood(fen: string, line: PvLine, me: Color): string[] {
  const out: string[] = [];
  const res = moveOf(fen, line.pv[0]);
  if (!res) return out;
  const { chess: after, move } = res;
  const before = new Chess(fen);
  if (line.score.type === 'mate' && line.score.value > 0) {
    out.push(line.score.value === 1 ? 'Bu hamle hemen mat eder!' : `Bu hamleyle ${line.score.value} hamlede mat edersin.`);
    return out;
  }
  const gain = lineMaterialSwing(fen, line.pv, me, 6).swing;
  if (move.captured) {
    const undefended = before.attackers(move.to as Square, opposite(me)).length === 0;
    if (undefended) out.push(`${cap(squareLoc(move.to))} ${pieceNom(move.captured)} korumasız; bedava alırsın.`);
    else if (gain >= 2) out.push(`Bu devamla yaklaşık ${worth(gain)} malzeme kazanırsın.`);
    else out.push('Karşılıklı taş değişimi olur; konumun sağlam kalır.');
  } else if (gain >= 2) {
    out.push(`Bu devamla yaklaşık ${worth(gain)} malzeme kazanırsın.`);
  }
  const fork = detectFork(after, move.to as Square);
  if (fork) out.push(describeFork(fork));
  const hangingBefore = hangingPieces(before, me);
  if (hangingBefore.some((h) => h.square === move.from)) out.push(`Saldırı altındaki ${pieceForm(move.piece, 'myNom')} güvenli bir kareye kaçar.`);
  else if (hangingBefore.length > hangingPieces(after, me).length) out.push('Saldırı altındaki taşını korumuş olursun.');
  if (after.inCheck() && !fork) out.push('Şah çekersin; rakip önce şahını kurtarmak zorunda kalır.');
  if (move.isKingsideCastle() || move.isQueensideCastle()) out.push('Şahını güvenli köşeye alır, kaleni oyuna sokarsın.');
  const moveNo = Number(fen.split(' ')[5] ?? 1);
  const backRank = me === 'w' ? '1' : '8';
  if (out.length === 0 && moveNo <= 12 && (move.piece === 'n' || move.piece === 'b') && move.from[1] === backRank)
    out.push('Taşını oyuna sokarsın. Açılışta at ve fillerini hızlıca çıkarmak önemlidir.');
  if (out.length === 0 && move.piece === 'p' && 'de'.includes(move.to[0]) && moveNo <= 10)
    out.push('Merkezi kontrol edersin; taşların için yer açılır.');
  if (out.length === 0) out.push('Motorun en iyi bulduğu hamle: konumunu en sağlam tutan devam bu.');
  return out;
}

export function advise(fen: string, analysis: Analysis): Advice | null {
  const line = analysis.lines[0];
  if (!line || line.pv.length === 0) return null;
  const me = new Chess(fen).turn();
  const bm = moveOf(fen, line.pv[0]);
  if (!bm) return null;
  let reply: string | undefined;
  if (line.pv[1]) {
    const rm = moveOf(bm.chess.fen(), line.pv[1]);
    if (rm) reply = describeMoveObj(rm.move, 'oppFuture');
  }
  const bestWin = winPercent(line.score);
  const alternatives = analysis.lines.slice(1, 3).flatMap((l) => {
    const m = l.pv[0] ? moveOf(fen, l.pv[0]) : null;
    if (!m) return [];
    const diff = bestWin - winPercent(l.score);
    const quality = diff <= 3 ? 'aynı derecede iyi' : diff <= 8 ? 'biraz daha zayıf' : 'belirgin şekilde daha zayıf';
    return [{ uci: l.pv[0], text: describeMoveObj(m.move, 'imp'), quality }];
  });
  return {
    uci: line.pv[0],
    text: describeMoveObj(bm.move, 'imp'),
    reasons: whyGood(fen, line, me).map(tidy),
    reply,
    alternatives,
    arrows: [{ from: bm.move.from, to: bm.move.to, color: 'green' }],
  };
}

// ---------------------------------------------------------------------------
// Tahmin sorusu: "Bu üç hamleden hangisi en iyi?" — öneriyi direkt vermek yerine düşündürür.
export interface QuizOption {
  uci: string;
  letter: 'A' | 'B' | 'C';
  text: string;
  color: 'blue' | 'orange' | 'purple';
  /** En iyi hamleye göre kazanma yüzdesi kaybı. */
  diff: number;
  /** En iyiye çok yakınsa (≤ 2) doğru sayılır. */
  correct: boolean;
  quality: string;
}

export interface Quiz {
  fen: string;
  options: QuizOption[];
  bestUci: string;
}

/** Soru için önerilen analiz ayarı: daha çok aday hamle gerekir. */
export const QUIZ_OPTS = { depth: 12, multipv: 6, movetime: 2500, timeoutMs: 7000 } as const;

const qualityOf = (diff: number) =>
  diff <= 2 ? 'en iyi hamle' : diff <= 8 ? 'biraz daha zayıf' : diff <= 20 ? 'zayıf' : 'kötü — konumu bozuyor';

/**
 * En iyi hamle + biri biraz zayıf + biri belirgin şekilde zayıf üç seçenek üretir.
 * Seçenekler yeterince farklı değilse (hepsi neredeyse eşit) null döner; o zaman normal öneri gösterilir.
 */
export function buildQuiz(fen: string, analysis: Analysis, rng: () => number = Math.random): Quiz | null {
  const lines = analysis.lines.filter((l) => l.pv.length > 0);
  if (lines.length < 3) return null;
  const bestWin = winPercent(lines[0].score);
  const scored = lines.map((l) => ({ l, diff: Math.max(0, bestWin - winPercent(l.score)) }));
  const distractors = scored.filter((x) => x.diff >= 5);
  if (distractors.length < 2) return null;
  // Orta zorlukta bir çeldirici (en küçük fark) ve belirgin bir çeldirici (en büyük fark)
  const medium = distractors[0];
  const strong = distractors[distractors.length - 1];
  const picked = [scored[0], medium, strong];
  const order = picked.map((p) => ({ p, k: rng() })).sort((a, b) => a.k - b.k).map((x) => x.p);
  const letters = ['A', 'B', 'C'] as const;
  const colors = ['blue', 'orange', 'purple'] as const;
  const options: QuizOption[] = [];
  order.forEach((p, i) => {
    const m = moveOf(fen, p.l.pv[0]);
    if (!m) return;
    options.push({
      uci: p.l.pv[0],
      letter: letters[i],
      text: describeMoveObj(m.move, 'imp'),
      color: colors[i],
      diff: p.diff,
      correct: p.diff <= 2,
      quality: qualityOf(p.diff),
    });
  });
  if (options.length !== 3) return null;
  return { fen, options, bestUci: lines[0].pv[0] };
}
/**
 * Tahmin sorusunda seçilen hamlenin açıklaması.
 * Doğruysa neden iyi olduğu; yanlışsa neden zayıf olduğu ve en iyi hamlenin faydası.
 * @param after seçilen hamleden sonraki konumun analizi (yanlış seçimde gerekir)
 */
export function explainQuizChoice(fen: string, analysis: Analysis, uci: string, after: Analysis | null): string[] {
  const me = new Chess(fen).turn();
  const best = analysis.lines[0];
  const line = analysis.lines.find((l) => l.pv[0] === uci);
  const bestWin = best ? winPercent(best.score) : 50;
  if (line && bestWin - winPercent(line.score) <= 2) return whyGood(fen, line, me).map(tidy);
  const r = reviewMove(fen, { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }, analysis, after);
  const out = r.reasons.filter((x) => !/^(Bunun yerine|Daha iyisi|Motorun tercihi|Sağlam bir hamle|Motorun da)/.test(x));
  if (out.length === 0) out.push('Bu hamle kötü değil ama rakibe daha rahat bir oyun bırakıyor.');
  if (best) {
    const good = whyGood(fen, best, me)[0];
    if (good) out.push(`En iyi hamlenin faydası: ${good.charAt(0).toLocaleLowerCase('tr-TR')}${good.slice(1)}`);
  }
  return out.map(tidy);
}
// ---------------------------------------------------------------------------
// Sadece ipucu: hamleyi söylemeden, en iyi hamledeki taktik temayı üstü kapalı anlatır.
export type HintMotif = 'mate' | 'fork' | 'discovered' | 'pin' | 'skewer' | 'freePiece' | 'defend' | 'material' | 'check' | 'quiet';

export interface TacticalHint {
  motif: HintMotif;
  /** Kısa ipucu: "Şah kanadında bir çatal fırsatı var." */
  text: string;
  /** Nasıl aranır? */
  detail: string;
  /** Kullanıcı isterse açılacak gerçek cevap. */
  reveal: Advice | null;
}

const MOTIF_DETAIL: Record<Exclude<HintMotif, 'mate' | 'quiet'>, string> = {
  fork: 'Taşlarının gidebileceği karelerden iki rakip taşa birden saldırabilir misin? Rakibin şahı, veziri ve kalelerinin dizilimine dikkat et.',
  discovered: 'Uzun menzilli bir taşının (fil, kale, vezir) önünde kendi taşın duruyor. O taşı tehditle oynatırsan arkadaki de saldırır.',
  pin: 'Aynı çizgide duran iki rakip taşa bak: öndeki kıpırdarsa arkasındaki değerli taş açıkta kalır.',
  skewer: 'Değerli bir rakip taş ile arkasındaki taş aynı çizgide. Öndekine saldırırsan kaçınca arkadaki düşer.',
  freePiece: 'Rakibin taşlarını tek tek kontrol et: hangisini kimse korumuyor?',
  defend: 'Önce kendi taşlarına bak: saldırı altında olan ve korunmayan var mı?',
  material: 'Sırayla bak: şah çekişler, almalar, tehditler. Zorlayıcı hamlelerle başla.',
  check: 'Şah çeken hamleleri dene; rakip önce şahını kurtarmak zorunda kalır.',
};

export function tacticalHint(fen: string, analysis: Analysis): TacticalHint | null {
  const line = analysis.lines[0];
  if (!line || line.pv.length === 0) return null;
  const me = new Chess(fen).turn();
  const reveal = advise(fen, analysis);
  const make = (motif: HintMotif, text: string, detail?: string): TacticalHint => ({
    motif,
    text,
    detail: detail ?? MOTIF_DETAIL[motif as keyof typeof MOTIF_DETAIL] ?? '',
    reveal,
  });

  if (line.score.type === 'mate' && line.score.value > 0) {
    const n = line.score.value;
    return make('mate', n === 1 ? 'Tek hamlede mat var!' : `${n} hamlede mat var!`, 'Şah çeken bütün hamleleri tek tek dene; rakip şahın kaçabileceği kareleri say.');
  }

  // Kendi hamlelerim: devamın 1. ve 3. yarım hamlesi (iki hamlelik kombinasyonları da yakalamak için)
  const board = new Chess(fen);
  for (let k = 0; k < Math.min(line.pv.length, 3); k++) {
    const u = line.pv[k];
    const before = new Chess(board.fen());
    let m: Move;
    try {
      m = board.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    } catch {
      break;
    }
    if (k === 1) continue; // rakibin cevabı
    const pre = k === 2 ? 'İki hamlelik bir kombinasyonla ' : '';
    const say = (s: string) => (pre ? pre + s.charAt(0).toLocaleLowerCase('tr-TR') + s.slice(1) : s);
    const fork = detectFork(board, m.to as Square);
    if (fork) {
      const key = fork.targets.find((t) => t.type === 'k') ?? fork.targets[0];
      return make('fork', say(`${cap(regionOf(key.square))} bir çatal fırsatı var, taşların dizilimine dikkat et.`));
    }
    const disc = detectDiscovered(before, board, m.to as Square);
    if (disc) return make('discovered', say(`${cap(regionOf(disc.target.square))} bir açarak saldırı fırsatı var.`));
    const lt = detectLineTactic(board, m.to as Square);
    if (lt)
      return make(
        lt.kind,
        say(`${cap(regionOf(lt.front.square))} bir ${lt.kind === 'pin' ? 'açmaz' : 'şiş'} fırsatı var; aynı çizgideki rakip taşlara bak.`),
      );
  }

  const first = moveOf(fen, line.pv[0]);
  if (!first) return null;
  const m0 = first.move;
  const gain = lineMaterialSwing(fen, line.pv, me, 6).swing;
  const start = new Chess(fen);
  if (m0.captured && start.attackers(m0.to as Square, opposite(me)).length === 0)
    return make('freePiece', `${cap(regionOf(m0.to))} korumasız bir rakip taş var.`);
  if (hangingPieces(start, me).some((h) => h.square === m0.from))
    return make('defend', `${cap(regionOf(m0.from))} saldırı altında bir taşın var; önce onu düşün.`);
  if (gain >= 2) return make('material', 'Malzeme kazandıran zorlayıcı bir hamle var.');
  if (m0.san.includes('+')) return make('check', 'Şah çekmek işe yarayabilir.');
  const moveNo = Number(fen.split(' ')[5] ?? 1);
  const detail =
    m0.isKingsideCastle() || m0.isQueensideCastle()
      ? 'Şahını güvenceye almayı düşün.'
      : moveNo <= 12 && (m0.piece === 'n' || m0.piece === 'b') && m0.from[1] === (me === 'w' ? '1' : '8')
        ? 'Henüz oyuna girmemiş bir taşın var; onu geliştirmeyi düşün.'
        : 'En az çalışan taşını daha iyi bir kareye taşımayı düşün.';
  return make('quiet', 'Şu an belirgin bir taktik yok.', detail);
}