// Hamle değerlendirme: motor analizini (hamle öncesi + sonrası) sade Türkçe geri bildirime çevirir.
import { Chess, type Color, type Square } from 'chess.js';
import type { Analysis } from './engine';
import { scoreFor, winPercent, formatScore, describeScore, scoreToNumber } from './evaluation';
import type { Score } from './uci';
import {
  detectFork,
  describeFork,
  hangingPieces,
  lineMaterialSwing,
  opposite,
  pieceName,
  pieceForm,
  squareLoc,
  squareAt,
  toTurkishSan,
} from './tactics';

export type MoveClass = 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder' | 'missed';

export const CLASS_INFO: Record<MoveClass, { label: string; short: string; tone: 'good' | 'ok' | 'warn' | 'bad' }> = {
  best: { label: 'En iyi hamle', short: '★', tone: 'good' },
  excellent: { label: 'Çok iyi hamle', short: '!', tone: 'good' },
  good: { label: 'İyi hamle', short: '✓', tone: 'ok' },
  inaccuracy: { label: 'Doğal fakat daha zayıf', short: '?!', tone: 'warn' },
  mistake: { label: 'Hata', short: '?', tone: 'bad' },
  blunder: { label: 'Büyük hata', short: '??', tone: 'bad' },
  missed: { label: 'Kritik fırsat kaçtı', short: '✗', tone: 'warn' },
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
  color: 'green' | 'red' | 'orange' | 'blue';
}

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
  best?: { uci: string; san: string; trSan: string; line: string[] };
  /** Rakibin en güçlü cevabı ve devamı (Türkçe notasyon). */
  refutation?: { line: string[]; uci: string };
  /** "Neden?" maddeleri. */
  reasons: string[];
  /** Hamle öncesi konumda gösterilecek oklar (daha iyi alternatif). */
  beforeArrows: BoardArrow[];
  /** Hamle sonrası konumda gösterilecek oklar (rakibin cevabı). */
  afterArrows: BoardArrow[];
  /** Hamle sonrası vurgulanacak kareler (savunmasız taşlar). */
  dangerSquares: string[];
  /** Hamle sonrası değerlendirme metni. */
  evalText: string;
}

function uciOf(m: { from: string; to: string; promotion?: string }) {
  return m.from + m.to + (m.promotion ?? '');
}

function sansOf(fen: string, uciLine: string[], max = 6): string[] {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const u of uciLine.slice(0, max)) {
    try {
      out.push(toTurkishSan(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san));
    } catch {
      break;
    }
  }
  return out;
}

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

  // Oynanan hamlenin skoru (hamle yapan bakışından)
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
  // Mat skorları arasında daha uzun mata gitmek kayıp sayılmaz.
  const loss = Math.max(0, winBest - winPlayed);
  let cls = classify(loss, isBest);

  const reasons: string[] = [];
  const beforeArrows: BoardArrow[] = [];
  const afterArrows: BoardArrow[] = [];
  const dangerSquares: string[] = [];

  // --- En iyi hamle bilgisi ---
  let best: MoveReview['best'];
  if (!isBest && bestLine) {
    const line = sansOf(fenBefore, bestLine.pv, 6);
    best = { uci: bestUci, san: line[0] ?? bestUci, trSan: line[0] ?? bestUci, line };
    beforeArrows.push({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), color: 'green' });
  }

  // --- Rakibin en iyi cevabı ---
  let refutation: MoveReview['refutation'];
  const reply = after?.lines[0];
  if (reply && reply.pv.length > 0) {
    refutation = { line: sansOf(fenAfter, reply.pv, 6), uci: reply.pv[0] };
    if (cls !== 'best' && cls !== 'excellent' && cls !== 'good') {
      afterArrows.push({ from: reply.pv[0].slice(0, 2), to: reply.pv[0].slice(2, 4), color: 'red' });
    }
  }

  // --- Açıklamalar ---
  if (board.isCheckmate()) {
    reasons.push('Mat! Rakibin şahının kaçacak karesi yok.');
  } else if (board.isStalemate()) {
    reasons.push(
      winBest > 70
        ? 'Dikkat: Pat oldu, oyun berabere bitti. Kazanıyordun! Rakibin şahına hamle bırakmayı unutma.'
        : 'Pat: rakibin yasal hamlesi yok ama şah altında değil, oyun berabere.',
    );
  } else {
    // 1) Rakip mat ediyor mu?
    const replyScoreMover = reply ? scoreFor(reply.score, opp, mover) : null;
    if (replyScoreMover?.type === 'mate' && replyScoreMover.value < 0 && !(bestScore.type === 'mate' && bestScore.value < 0)) {
      const n = Math.abs(replyScoreMover.value);
      reasons.push(`Bu hamleden sonra rakip ${n} hamlede mat edebilir: ${refutation?.line.join(' ')}`);
      if (cls !== 'blunder') cls = 'blunder';
    }

    // 2) Mat fırsatı kaçtı mı?
    if (bestScore.type === 'mate' && bestScore.value > 0 && !(playedScore.type === 'mate' && playedScore.value > 0)) {
      reasons.push(`Mat fırsatı vardı! ${best?.line.join(' ')} ile ${bestScore.value} hamlede mat ediyordun.`);
    }

    // 3) Taş kaybı: rakibin en iyi cevabıyla malzeme ne oluyor?
    if (reply && cls !== 'best' && cls !== 'excellent') {
      const { swing } = lineMaterialSwing(fenAfter, reply.pv, mover, 6);
      if (swing <= -2) {
        const r = new Chess(fenAfter);
        const first = r.move({ from: reply.pv[0].slice(0, 2), to: reply.pv[0].slice(2, 4), promotion: reply.pv[0][4] });
        if (first.captured) {
          const capSq = first.to as Square;
          const wasHangingBefore = hangingBefore.some((h) => h.square === capSq);
          const isMovedPiece = capSq === played.to;
          if (isMovedPiece) {
            reasons.push(
              `${cap(pieceForm(played.piece, 'myAcc'))} savunmasız bir kareye götürdün: rakip ${toTurkishSan(first.san)} ile ${squareLoc(capSq)} ${pieceForm(first.captured, 'myAcc')} alıyor.`,
            );
          } else if (wasHangingBefore) {
            reasons.push(
              `Rakibin tehdidini kaçırdın: ${squareLoc(capSq)} ${pieceForm(first.captured, 'myNom')} zaten saldırı altındaydı. Rakip ${toTurkishSan(first.san)} ile alıyor.`,
            );
          } else {
            reasons.push(`Rakip ${toTurkishSan(first.san)} ile ${squareLoc(capSq)} ${pieceForm(first.captured, 'myAcc')} alıyor.`);
          }
          dangerSquares.push(capSq);
        } else {
          const fork = detectFork(r, first.to as Square);
          if (fork) reasons.push(`Rakip ${toTurkishSan(first.san)} ile çatal yapıyor. ${describeFork(fork)}`);
          else reasons.push(`Rakibin ${toTurkishSan(first.san)} cevabından sonra taş kaybediyorsun.`);
        }
        reasons.push(`Rakibin en iyi devamı: ${refutation?.line.join(' ')} (yaklaşık ${Math.abs(swing)} puanlık malzeme kaybı).`);
      }
    }

    // 4) Kaçırılan kazanç: en iyi hamle malzeme kazanıyor muydu?
    if (!isBest && bestLine && best) {
      const gainBest = lineMaterialSwing(fenBefore, bestLine.pv, mover, 6).swing;
      const c = new Chess(fenBefore);
      const bm = c.move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), promotion: bestUci[4] });
      const fork = detectFork(c, bm.to as Square);
      if (gainBest >= 2) {
        if (bm.captured) {
          const undefended = new Chess(fenBefore).attackers(bm.to as Square, opp).length === 0;
          reasons.push(
            undefended
              ? `Daha iyisi ${best.trSan}: ${squareLoc(bm.to)} ${pieceName(bm.captured)} savunmasızdı, bedava alabilirdin.`
              : `Daha iyisi ${best.trSan}: ${squareLoc(bm.to)} ${pieceForm(bm.captured, 'acc')} alıp malzeme kazanıyordun.`,
          );
        } else if (fork) {
          reasons.push(`Daha iyisi ${best.trSan}! ${describeFork(fork)}`);
        } else {
          reasons.push(`Daha iyisi ${best.trSan}: bu hamleyle yaklaşık ${gainBest} puanlık malzeme kazanıyordun (${best.line.join(' ')}).`);
        }
        // Büyük fırsat kaçtı ama konum çökmediyse "kritik fırsat kaçtı".
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
        if (gain >= 2) reasons.push(`Rakibin ${pieceForm(played.captured, 'theirAcc')} aldın ve malzeme kazandın.`);
        else reasons.push(`${cap(pieceName(played.captured))} aldın.`);
      }
      if (fork) reasons.push(describeFork(fork));
      if (board.inCheck() && !fork) reasons.push('Şah çektin; rakip önce şahını kurtarmak zorunda.');
      if (reasons.length === 0) reasons.push(isBest ? 'Motorun da en iyi bulduğu hamle.' : 'Sağlam bir hamle; konumunu korudun.');
      if (!isBest && best && loss > THRESHOLDS.best) reasons.push(`Motorun tercihi: ${best.trSan}.`);
    }

    // 6) Genel durum (taş kaybı yok ama değerlendirme düştü)
    if (reasons.length === 0) {
      if (best) reasons.push(`Daha iyisi ${best.trSan} idi. Devamı: ${best.line.join(' ')}`);
      if (cls === 'inaccuracy') reasons.push('Taş kaybetmedin ama rakibe daha rahat bir oyun verdin.');
      else if (cls === 'mistake' || cls === 'blunder') reasons.push(`Rakibin en iyi cevabı ${refutation?.line[0] ?? '-'}; konumun belirgin şekilde kötüleşti.`);
    }
  }

  // Hamle sonrasında hâlâ savunmasız duran kendi taşların
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
    best,
    refutation,
    reasons,
    beforeArrows,
    afterArrows,
    dangerSquares,
    evalText: `${formatScore(whiteScoreAfter)} — ${describeScore(whiteScoreAfter)}`,
  };
}

function cap(s: string) {
  return s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1);
}

/** "Rakibim ne tehdit ediyor?" — sırayı rakibe verip motorun en iyi hamlesini yorumlar. */
export interface ThreatInfo {
  ok: boolean;
  message: string;
  details: string[];
  arrows: BoardArrow[];
  dangerSquares: string[];
}

export function explainThreat(
  fen: string,
  passed: Analysis | null,
  current: Analysis | null,
): ThreatInfo {
  const chess = new Chess(fen);
  const me = chess.turn();
  const opp = opposite(me);
  const hanging = hangingPieces(chess, me);
  const dangerSquares = hanging.map((h) => h.square as string);
  const hangText = hanging.map((h) =>
    h.reason === 'undefended'
      ? `${squareAt(h.square)} duran ${pieceForm(h.type, 'myNom')} saldırı altında ve savunan yok.`
      : `${squareAt(h.square)} duran ${pieceForm(h.type, 'myDat')} daha değersiz bir taş saldırıyor.`,
  );

  if (chess.inCheck()) {
    return { ok: true, message: 'Şah altındasın! Önce şahını kurtarmalısın.', details: hangText, arrows: [], dangerSquares };
  }
  if (!passed || !passed.lines[0]) {
    return {
      ok: hanging.length > 0,
      message: hanging.length ? 'Dikkat: savunmasız taşların var.' : 'Belirgin bir tehdit görünmüyor.',
      details: hangText,
      arrows: [],
      dangerSquares,
    };
  }
  const line = passed.lines[0];
  const passedFen = passed.fen;
  const threatUci = line.pv[0];
  const c = new Chess(passedFen);
  const tm = c.move({ from: threatUci.slice(0, 2), to: threatUci.slice(2, 4), promotion: threatUci[4] });
  const trLine = sansOf(passedFen, line.pv, 5);
  const arrows: BoardArrow[] = [{ from: tm.from, to: tm.to, color: 'orange' }];

  // Rakip için skor kazancı: "pas" sonrası rakip skoru - şu anki rakip skoru
  const oppNow = current?.lines[0] ? scoreFor(current.lines[0].score, me, opp) : { type: 'cp', value: 0 } as Score;
  const oppIfPass = line.score; // sıra rakipte
  const gain = scoreToNumber(oppIfPass) - scoreToNumber(oppNow);

  const details = [...hangText];
  let message: string;
  if (oppIfPass.type === 'mate' && oppIfPass.value > 0) {
    message = `Mat tehdidi! Rakip ${oppIfPass.value} hamlede mat etmek istiyor: ${trLine.join(' ')}`;
  } else if (gain > 150) {
    const swing = lineMaterialSwing(passedFen, line.pv, opp, 6).swing;
    if (tm.captured) message = `Rakip ${toTurkishSan(tm.san)} ile ${squareLoc(tm.to)} ${pieceForm(tm.captured, 'myAcc')} almak istiyor.`;
    else {
      const fork = detectFork(c, tm.to as Square);
      message = fork
        ? `Rakip ${toTurkishSan(tm.san)} ile çatal yapmak istiyor. ${describeFork(fork)}`
        : `Rakibin tehdidi: ${toTurkishSan(tm.san)}${swing >= 2 ? ` (yaklaşık ${swing} puan malzeme kazanır)` : ''}.`;
    }
    details.push(`Rakibin planı: ${trLine.join(' ')}`);
  } else {
    message = 'Ciddi bir tehdit yok.';
    details.push(`Rakibin sıradaki mantıklı hamlesi ${toTurkishSan(tm.san)} olabilir.`);
  }
  return { ok: true, message, details, arrows, dangerSquares };
}

/** Kademeli ipucu: 1 = yön gösterir, 2 = oynanacak taşı gösterir, 3 = hamleyi ve devamını gösterir. */
export interface Hint {
  level: 1 | 2 | 3;
  text: string;
  arrows: BoardArrow[];
  marks: Record<string, 'hint' | 'danger'>;
}

export function buildHint(fen: string, analysis: Analysis, level: 1 | 2 | 3): Hint | null {
  const line = analysis.lines[0];
  if (!line || line.pv.length === 0) return null;
  const chess = new Chess(fen);
  const me = chess.turn();
  const u = line.pv[0];
  const c = new Chess(fen);
  const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });

  if (level === 3) {
    const trLine = sansOf(fen, line.pv, 6);
    return {
      level,
      text: `En iyi hamle: ${trLine[0]}. Devamı: ${trLine.join(' ')}`,
      arrows: [{ from: m.from, to: m.to, color: 'blue' }],
      marks: {},
    };
  }
  if (level === 2) {
    return {
      level,
      text: `Bu taşla oyna: ${squareAt(m.from)} duran ${pieceName(m.piece)}.`,
      arrows: [],
      marks: { [m.from]: 'hint' },
    };
  }

  const hanging = hangingPieces(chess, me);
  const gain = lineMaterialSwing(fen, line.pv, me, 6).swing;
  const fork = detectFork(c, m.to as Square);
  let text: string;
  if (line.score.type === 'mate' && line.score.value > 0) text = 'Mat var! Şah çeken hamlelere bak; rakip şahın kaçış karelerini say.';
  else if (gain >= 2 && m.captured) text = 'Rakibin savunmasız ya da yeterince korunmayan bir taşı var. Alabileceğin taşlara bak.';
  else if (gain >= 2 && fork) text = 'Bir taşınla aynı anda iki rakip taşa saldırabilir misin? Çatal ara.';
  else if (hanging.length > 0 && hanging.some((h) => h.square === m.from || gain >= -1))
    text = 'Saldırı altındaki bir taşın var. Önce onu güvene al ya da savun.';
  else if (gain >= 2) text = 'Malzeme kazandıran bir hamle var. Şah çekişlere, almalara ve tehditlere sırayla bak.';
  else if (m.san.includes('+')) text = 'Şah çeken hamleleri düşün.';
  else text = 'Belirgin bir taktik yok. En az çalışan taşını oyuna sok, merkezi kontrol et ya da rok yap.';
  return { level, text, arrows: [], marks: {} };
}
