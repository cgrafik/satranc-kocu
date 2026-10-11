// Eğitmenle maç: motora karşı oyna, her hamlende koçtan geri bildirim al.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import Board, { type Mark } from '../components/Board';
import EvalBar from '../components/EvalBar';
import EvalGraph from '../components/EvalGraph';
import MoveList from '../components/MoveList';
import CoachCard from '../components/CoachCard';
import { buildHint, CLASS_INFO, explainThreat, reviewMove, type Hint, type MoveClass, type MoveReview, type ThreatInfo } from '../lib/coach';
import { botSearchOptions, getLevel, LEVELS, pickBotMove, type LevelId } from '../lib/bot';
import { gameResult, tryMove, type GameResult } from '../lib/game';
import { passTurnFen, toTurkishSan } from '../lib/tactics';
import { scoreFor } from '../lib/evaluation';
import type { Score } from '../lib/uci';
import { AFTER_OPTS, COACH_OPTS, useEngine } from '../lib/useEngine';
import { loadLocal, saveLocal, usePersistent } from '../lib/usePersistent';
import { setSoundEnabled, soundForSan } from '../lib/sound';

const START = new Chess().fen();

interface PlayedMove {
  uci: string;
  san: string;
  trSan: string;
  fen: string;
  from: string;
  to: string;
  by: 'me' | 'bot';
  review?: MoveReview;
}

interface Setup {
  color: 'w' | 'b' | 'random';
  level: LevelId;
  guard: boolean;
  showEval: boolean;
  sound: boolean;
}

interface SavedGame {
  myColor: 'w' | 'b';
  level: LevelId;
  moves: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fenOf = (list: PlayedMove[]) => (list.length ? list[list.length - 1].fen : START);

function accuracyOf(losses: number[]): number | null {
  if (losses.length === 0) return null;
  // Lichess'in hamle doğruluğu formülü (kazanma yüzdesi kaybından)
  const acc = losses.map((l) => Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * l) - 3.1669)));
  return Math.round(acc.reduce((a, b) => a + b, 0) / acc.length);
}

export default function PlayMode() {
  const { engine, status, error } = useEngine();
  const [setup, setSetup] = usePersistent<Setup>('sk.play.setup', {
    color: 'w',
    level: 'kolay',
    guard: true,
    showEval: false,
    sound: true,
  });
  const setupRef = useRef(setup);
  useEffect(() => {
    setupRef.current = setup;
    setSoundEnabled(setup.sound);
  }, [setup]);

  const [phase, setPhase] = useState<'setup' | 'playing' | 'over'>('setup');
  const [myColor, setMyColor] = useState<'w' | 'b'>('w');
  const [orientation, setOrientation] = useState<'w' | 'b'>('w');
  const [moves, setMoves] = useState<PlayedMove[]>([]);
  const movesRef = useRef<PlayedMove[]>([]);
  const commit = (list: PlayedMove[]) => {
    movesRef.current = list;
    setMoves(list);
  };
  const [view, setView] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [compare, setCompare] = useState<'before' | 'after' | null>(null);
  const [busy, setBusy] = useState<null | 'review' | 'bot' | 'threat' | 'hint'>(null);
  const [guardIdx, setGuardIdx] = useState<number | null>(null);
  const [threat, setThreat] = useState<ThreatInfo | null>(null);
  const [hint, setHint] = useState<Hint | null>(null);
  const [result, setResult] = useState<(GameResult & { text: string }) | null>(null);
  const [liveScore, setLiveScore] = useState<Score | null>(null);
  const [engineErr, setEngineErr] = useState<string | null>(null);
  const [undos, setUndos] = useState(0);
  const gameId = useRef(0);
  const myColorRef = useRef<'w' | 'b'>('w');

  const liveFen = fenOf(moves);
  const saved = useMemo(() => loadLocal<SavedGame | { moves: [] }>('sk.play.game', { moves: [] }), []);

  // Devam eden oyunu sakla (yalnızca bu tarayıcıda)
  useEffect(() => {
    if (phase === 'playing') saveLocal('sk.play.game', { myColor, level: setup.level, moves: moves.map((m) => m.uci) });
    else if (phase === 'over') saveLocal('sk.play.game', null);
  }, [phase, moves, myColor, setup.level]);

  const clearAids = () => {
    setThreat(null);
    setHint(null);
    setCompare(null);
  };

  const finish = useCallback((res: GameResult, resigned = false) => {
    const me = myColorRef.current;
    let text: string;
    if (resigned) text = 'Teslim oldun.';
    else if (res.winner === me) text = `Kazandın! (${res.reason})`;
    else if (res.winner) text = `Kaybettin. (${res.reason})`;
    else text = `Berabere. (${res.reason})`;
    setResult({ ...res, text });
    setPhase('over');
    setBusy(null);
  }, []);

  const pushMove = (list: PlayedMove[], fen: string, from: string, to: string, promotion: string | undefined, by: 'me' | 'bot') => {
    const c = new Chess(fen);
    const m = tryMove(c, from, to, promotion);
    if (!m) return null;
    const pm: PlayedMove = {
      uci: m.from + m.to + (m.promotion ?? ''),
      san: m.san,
      trSan: toTurkishSan(m.san),
      fen: c.fen(),
      from: m.from,
      to: m.to,
      by,
    };
    const next = [...list, pm];
    commit(next);
    soundForSan(m.san, c.isGameOver());
    return { pm, chess: c, list: next };
  };

  const prefetch = (fen: string) => {
    engine
      .analyze(fen, COACH_OPTS)
      .then((a) => {
        if (fenOf(movesRef.current) === fen && a.lines[0]) setLiveScore(scoreFor(a.lines[0].score, new Chess(fen).turn(), 'w'));
      })
      .catch(() => {});
  };

  const botMove = async (fen: string, gid: number) => {
    setBusy('bot');
    const level = getLevel(setupRef.current.level);
    const t0 = performance.now();
    let analysis = null;
    try {
      analysis = await engine.analyze(fen, botSearchOptions(level));
    } catch (e) {
      if (gid === gameId.current) setEngineErr(`${(e as Error).message} Rakip şimdilik rastgele oynayacak.`);
    }
    await sleep(Math.max(0, 420 - (performance.now() - t0)));
    if (gid !== gameId.current || fenOf(movesRef.current) !== fen) return;
    const u = pickBotMove(fen, level, analysis);
    if (!u) {
      setBusy(null);
      return;
    }
    const r = pushMove(movesRef.current, fen, u.slice(0, 2), u.slice(2, 4), u[4], 'bot');
    setBusy(null);
    if (!r) return;
    const res = gameResult(r.chess);
    if (res.over) finish(res);
    else prefetch(r.pm.fen);
  };

  const afterUserMove = async (gid: number, fenBefore: string, pm: PlayedMove, chess: Chess, idx: number) => {
    setBusy('review');
    let review: MoveReview | null = null;
    try {
      const before = await engine.analyze(fenBefore, COACH_OPTS);
      const after = chess.isGameOver() ? null : await engine.analyze(pm.fen, AFTER_OPTS);
      if (gid !== gameId.current) return;
      review = reviewMove(fenBefore, { from: pm.from, to: pm.to, promotion: pm.uci[4] }, before, after, idx);
      const rv = review;
      commit(movesRef.current.map((m, i) => (i === idx && m.uci === pm.uci ? { ...m, review: rv } : m)));
      setSelected(idx);
      setLiveScore(rv.whiteScoreAfter);
      setEngineErr(null);
    } catch (e) {
      if (gid !== gameId.current) return;
      if ((e as Error).message !== 'İptal edildi') setEngineErr(`Koç analizi yapılamadı: ${(e as Error).message}`);
    }
    if (gid !== gameId.current) return;
    setBusy(null);
    const res = gameResult(chess);
    if (res.over) return finish(res);
    if (setupRef.current.guard && review?.cls === 'blunder') {
      setGuardIdx(idx);
      return;
    }
    void botMove(pm.fen, gid);
  };

  const onUserMove = (from: string, to: string, promotion?: string) => {
    if (phase !== 'playing' || busy === 'review' || busy === 'bot' || guardIdx !== null || view !== null) return false;
    const list = movesRef.current;
    const fen = fenOf(list);
    if (new Chess(fen).turn() !== myColor) return false;
    const r = pushMove(list, fen, from, to, promotion, 'me');
    if (!r) return false;
    clearAids();
    void afterUserMove(gameId.current, fen, r.pm, r.chess, r.list.length - 1);
    return true;
  };

  const startGame = (restore?: SavedGame) => {
    gameId.current++;
    engine.interrupt();
    const color = restore?.myColor ?? (setup.color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : setup.color);
    if (restore) setSetup((s) => ({ ...s, level: restore.level }));
    myColorRef.current = color;
    setMyColor(color);
    setOrientation(color);
    let list: PlayedMove[] = [];
    if (restore) {
      const c = new Chess();
      for (const u of restore.moves) {
        const m = tryMove(c, u.slice(0, 2), u.slice(2, 4), u[4]);
        if (!m) break;
        list.push({ uci: u, san: m.san, trSan: toTurkishSan(m.san), fen: c.fen(), from: m.from, to: m.to, by: m.color === color ? 'me' : 'bot' });
      }
    }
    commit(list);
    setView(null);
    setSelected(null);
    setGuardIdx(null);
    setResult(null);
    setUndos(0);
    setLiveScore(null);
    setEngineErr(null);
    clearAids();
    setPhase('playing');
    const fen = fenOf(list);
    const res = gameResult(new Chess(fen));
    if (res.over) {
      list = [];
      commit(list);
    }
    if (new Chess(fenOf(list)).turn() !== color) void botMove(fenOf(list), gameId.current);
    else prefetch(fenOf(list));
  };

  const undo = () => {
    gameId.current++;
    engine.interrupt();
    const list = movesRef.current.slice();
    while (list.length && list[list.length - 1].by === 'bot') list.pop();
    if (list.length && list[list.length - 1].by === 'me') list.pop();
    commit(list);
    setGuardIdx(null);
    setBusy(null);
    setView(null);
    clearAids();
    setUndos((u) => u + 1);
    const lastMine = [...list.keys()].reverse().find((i) => list[i].by === 'me' && list[i].review);
    setSelected(lastMine ?? null);
    if (phase === 'over') {
      setPhase('playing');
      setResult(null);
    }
    const fen = fenOf(list);
    if (new Chess(fen).turn() !== myColor) void botMove(fen, gameId.current);
    else prefetch(fen);
  };

  const continueAfterGuard = () => {
    setGuardIdx(null);
    void botMove(liveFen, gameId.current);
  };

  const showThreat = async () => {
    if (threat) return setThreat(null);
    setHint(null);
    setCompare(null);
    setView(null);
    const fen = liveFen;
    const passed = passTurnFen(fen);
    setBusy('threat');
    try {
      const [p, cur] = await Promise.all([
        passed ? engine.analyze(passed, { depth: 12, movetime: 2500, timeoutMs: 6000 }) : Promise.resolve(null),
        engine.analyze(fen, COACH_OPTS),
      ]);
      if (fenOf(movesRef.current) === fen) setThreat(explainThreat(fen, p, cur));
    } catch (e) {
      setEngineErr((e as Error).message);
    } finally {
      setBusy((b) => (b === 'threat' ? null : b));
    }
  };

  const nextHint = async () => {
    setThreat(null);
    setCompare(null);
    setView(null);
    const fen = liveFen;
    const level = Math.min(3, (hint?.level ?? 0) + 1) as 1 | 2 | 3;
    setBusy('hint');
    try {
      const a = await engine.analyze(fen, COACH_OPTS);
      if (fenOf(movesRef.current) === fen) setHint(buildHint(fen, a, level));
    } catch (e) {
      setEngineErr((e as Error).message);
    } finally {
      setBusy((b) => (b === 'hint' ? null : b));
    }
  };

  // Klavye: ← → ile hamleler arasında gezin
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const n = movesRef.current.length;
      if (e.key === 'ArrowLeft') {
        setCompare(null);
        setView((v) => Math.max(-1, (v ?? n - 1) - 1));
      } else if (e.key === 'ArrowRight') {
        setCompare(null);
        setView((v) => (v === null || v + 1 >= n - 1 ? null : v + 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // --- Tahtada ne gösterilecek? ---
  const review = selected !== null ? moves[selected]?.review : undefined;
  let boardFen = liveFen;
  let lastMove: { from: string; to: string } | null = moves.length ? moves[moves.length - 1] : null;
  let arrows = threat?.arrows ?? hint?.arrows ?? [];
  let marks: Record<string, Mark> = {};
  if (threat) for (const s of threat.dangerSquares) marks[s] = 'danger';
  if (hint) marks = { ...marks, ...hint.marks };
  let interactive = phase === 'playing' && !busy && guardIdx === null;

  if (compare && review) {
    const i = review.ply;
    boardFen = compare === 'before' ? review.fenBefore : review.fenAfter;
    lastMove = compare === 'before' ? (i > 0 ? moves[i - 1] : null) : moves[i];
    arrows = compare === 'before' ? review.beforeArrows : review.afterArrows;
    marks = {};
    if (compare === 'after') for (const s of review.dangerSquares) marks[s] = 'danger';
    interactive = false;
  } else if (view !== null) {
    boardFen = view < 0 ? START : moves[view].fen;
    lastMove = view < 0 ? null : moves[view];
    arrows = [];
    marks = {};
    interactive = false;
  }
  if (busy === 'threat' || busy === 'hint') interactive = phase === 'playing' && guardIdx === null && view === null && !compare;

  const myReviews = moves.filter((m) => m.by === 'me' && m.review).map((m) => m.review!);
  const counts = myReviews.reduce<Partial<Record<MoveClass, number>>>((acc, r) => ({ ...acc, [r.cls]: (acc[r.cls] ?? 0) + 1 }), {});
  const accuracy = accuracyOf(myReviews.map((r) => r.loss));
  const graphPoints = moves.map((m) => ({ score: m.review?.whiteScoreAfter ?? null, cls: m.review?.cls }));
  // Botun hamleleri için grafikte bir önceki değeri tekrar kullan
  for (let i = 0; i < graphPoints.length; i++) if (!graphPoints[i].score) graphPoints[i].score = i > 0 ? graphPoints[i - 1].score : { type: 'cp', value: 0 };

  const level = getLevel(setup.level);
  const isMyTurn = new Chess(liveFen).turn() === myColor;
  const statusText =
    phase !== 'playing'
      ? ''
      : busy === 'review'
        ? 'Koç hamleni inceliyor…'
        : busy === 'bot'
          ? 'Rakip düşünüyor…'
          : guardIdx !== null
            ? 'Karar ver: geri al ya da devam et.'
            : isMyTurn
              ? 'Sıra sende.'
              : '';

  return (
    <div className="layout">
      <div className="board-col">
        <div className="player-tag">
          <span className={`pc ${myColor === 'w' ? 'b' : 'w'}`} />
          <strong>Eğitmen</strong>
          <span className="muted">
            {level.name} ({level.approx})
          </span>
          {busy === 'bot' && <span className="thinking" aria-label="düşünüyor" />}
        </div>
        <div className="board-wrap">
          {setup.showEval && <EvalBar score={liveScore} orientation={orientation} />}
          <Board
            fen={boardFen}
            orientation={orientation}
            movable={interactive ? myColor : 'none'}
            onMove={onUserMove}
            lastMove={lastMove}
            arrows={arrows}
            marks={marks}
          />
        </div>
        <div className="player-tag">
          <span className={`pc ${myColor}`} />
          <strong>Sen</strong>
          <span className="muted">{statusText}</span>
        </div>
        {(compare || view !== null) && (
          <div className="viewing">
            {compare === 'before' && 'Hamle öncesi konum gösteriliyor (yeşil ok: daha iyi hamle).'}
            {compare === 'after' && 'Hamle sonrası konum gösteriliyor (kırmızı ok: rakibin en güçlü cevabı).'}
            {!compare && view !== null && 'Geçmiş bir konuma bakıyorsun.'}
            <button
              className="link"
              onClick={() => {
                setCompare(null);
                setView(null);
              }}
            >
              Canlı konuma dön
            </button>
          </div>
        )}
        <div className="toolbar">
          <button onClick={() => setOrientation((o) => (o === 'w' ? 'b' : 'w'))} title="Tahtayı çevir">
            ⇅ Çevir
          </button>
          <button onClick={() => setView((v) => Math.max(-1, (v ?? moves.length - 1) - 1))} disabled={moves.length === 0} title="Önceki hamle (←)">
            ◀
          </button>
          <button onClick={() => setView((v) => (v === null || v + 1 >= moves.length - 1 ? null : v + 1))} disabled={view === null} title="Sonraki hamle (→)">
            ▶
          </button>
          {phase !== 'setup' && (
            <button onClick={undo} disabled={moves.every((m) => m.by !== 'me')}>
              ↶ Geri al
            </button>
          )}
        </div>
      </div>

      <aside className="side">
        {status === 'error' && <div className="alert">Motor kullanılamıyor: {error}. Analiz ve güçlü rakip devre dışı.</div>}
        {status === 'loading' && <div className="info">Satranç motoru yükleniyor…</div>}
        {engineErr && status !== 'error' && <div className="alert">{engineErr}</div>}

        {phase === 'setup' && (
          <section className="card">
            <h2>Eğitmenle maç</h2>
            <div className="field" role="group" aria-label="Renk">
              <span>Renk</span>
              <div className="seg">
                {(['w', 'b', 'random'] as const).map((c) => (
                  <button key={c} className={setup.color === c ? 'on' : ''} onClick={() => setSetup({ ...setup, color: c })}>
                    {{ w: 'Beyaz', b: 'Siyah', random: 'Rastgele' }[c]}
                  </button>
                ))}
              </div>
            </div>
            <div className="field" role="group" aria-label="Rakip seviyesi">
              <span>Rakip seviyesi</span>
              <div className="levels">
                {LEVELS.map((l) => (
                  <button key={l.id} className={setup.level === l.id ? 'on' : ''} onClick={() => setSetup({ ...setup, level: l.id })}>
                    <strong>{l.name}</strong>
                    <small>{l.approx}</small>
                  </button>
                ))}
              </div>
            </div>
            <label className="check">
              <input type="checkbox" checked={setup.guard} onChange={(e) => setSetup({ ...setup, guard: e.target.checked })} />
              <span>
                <strong>Hata koruması:</strong> Büyük hata yaparsam dur, geri almama izin ver.
              </span>
            </label>
            <label className="check">
              <input type="checkbox" checked={setup.showEval} onChange={(e) => setSetup({ ...setup, showEval: e.target.checked })} />
              <span>Oyun sırasında değerlendirme çubuğunu göster</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={setup.sound} onChange={(e) => setSetup({ ...setup, sound: e.target.checked })} />
              <span>Hamle sesleri</span>
            </label>
            <button className="primary" onClick={() => startGame()} disabled={status === 'loading'}>
              Oyuna başla
            </button>
            {'myColor' in saved && saved.moves.length > 0 && (
              <button className="secondary" onClick={() => startGame(saved as SavedGame)}>
                Kaldığın oyuna devam et ({Math.ceil(saved.moves.length / 2)}. hamle)
              </button>
            )}
            <p className="muted small">
              Seviyelerdeki puanlar yaklaşık tahmindir. Seviyeler birbirine karşı oynatılarak sıralandı; chess.com puanıyla birebir eşleşmez.
            </p>
          </section>
        )}

        {phase !== 'setup' && (
          <>
            <div className="actions">
              <button onClick={showThreat} className={threat ? 'on' : ''} disabled={phase !== 'playing' || busy === 'bot' || busy === 'review'}>
                ⚠ Rakibim ne tehdit ediyor?
              </button>
              <button onClick={nextHint} disabled={phase !== 'playing' || !isMyTurn || busy === 'bot' || busy === 'review' || hint?.level === 3}>
                💡 {hint ? `Daha fazla ipucu (${hint.level}/3)` : 'İpucu'}
              </button>
            </div>

            {guardIdx !== null && moves[guardIdx]?.review && (
              <section className="card guard">
                <h3>Dur! Bu hamle büyük bir hata.</h3>
                <p>{moves[guardIdx].review!.reasons[0]}</p>
                <div className="row">
                  <button className="primary" onClick={undo}>
                    ↶ Geri al ve tekrar dene
                  </button>
                  <button className="secondary" onClick={continueAfterGuard}>
                    Yine de devam et
                  </button>
                </div>
              </section>
            )}

            {threat && (
              <section className="card threat">
                <h3>⚠ {threat.message}</h3>
                {threat.details.length > 0 && (
                  <ul>
                    {threat.details.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                )}
                <p className="muted small">Turuncu ok: rakibin sıradaki tehdidi. Kırmızı kare: saldırı altındaki savunmasız taşın.</p>
              </section>
            )}

            {hint && (
              <section className="card hint">
                <h3>💡 İpucu {hint.level}/3</h3>
                <p>{hint.text}</p>
              </section>
            )}

            {result && (
              <section className="card result">
                <h3>{result.text}</h3>
                <div className="stats">
                  {accuracy !== null && (
                    <div>
                      <strong>%{accuracy}</strong>
                      <small>yaklaşık doğruluk</small>
                    </div>
                  )}
                  {(['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder', 'missed'] as MoveClass[]).map((c) =>
                    counts[c] ? (
                      <div key={c}>
                        <strong className={`tone-${CLASS_INFO[c].tone}`}>{counts[c]}</strong>
                        <small>{CLASS_INFO[c].label}</small>
                      </div>
                    ) : null,
                  )}
                  {undos > 0 && (
                    <div>
                      <strong>{undos}</strong>
                      <small>geri alma</small>
                    </div>
                  )}
                </div>
                <p className="muted small">Hamle listesinde kırmızı işaretli hamlelerine tıklayarak hatalarını tekrar inceleyebilirsin.</p>
                <div className="row">
                  <button className="primary" onClick={() => startGame()}>
                    Yeni oyun
                  </button>
                  <button className="secondary" onClick={() => setPhase('setup')}>
                    Ayarlar
                  </button>
                </div>
              </section>
            )}

            {review && (
              <CoachCard
                review={review}
                compare={compare}
                onCompare={(v) => {
                  setView(null);
                  setCompare(v);
                }}
              />
            )}

            <section className="card">
              <MoveList
                moves={moves.map((m) => ({ trSan: m.trSan, cls: m.by === 'me' ? m.review?.cls : undefined }))}
                current={view ?? (moves.length ? moves.length - 1 : null)}
                onSelect={(i) => {
                  setCompare(null);
                  setView(i === moves.length - 1 ? null : i);
                  if (moves[i].review) setSelected(i);
                }}
              />
              {moves.some((m) => m.review) && (
                <EvalGraph
                  points={graphPoints}
                  current={view ?? moves.length - 1}
                  onSelect={(i) => {
                    setCompare(null);
                    setView(i === moves.length - 1 ? null : i);
                    if (moves[i]?.review) setSelected(i);
                  }}
                />
              )}
            </section>

            {phase === 'playing' && (
              <div className="row">
                <label className="check inline">
                  <input type="checkbox" checked={setup.guard} onChange={(e) => setSetup({ ...setup, guard: e.target.checked })} />
                  <span>Hata koruması</span>
                </label>
                <label className="check inline">
                  <input type="checkbox" checked={setup.showEval} onChange={(e) => setSetup({ ...setup, showEval: e.target.checked })} />
                  <span>Değerlendirme</span>
                </label>
                <button
                  className="danger"
                  onClick={() => {
                    if (confirm('Teslim olmak istediğine emin misin?')) {
                      gameId.current++;
                      engine.interrupt();
                      finish({ over: true, winner: myColor === 'w' ? 'b' : 'w', reason: 'Teslim' }, true);
                    }
                  }}
                >
                  Teslim ol
                </button>
              </div>
            )}

            <section className="card checklist">
              <h3>Her hamleden önce 3 soru</h3>
              <ol>
                <li>
                  <strong>Şah:</strong> Rakip bana şah çekebilir mi? Ben şah çekebilir miyim?
                </li>
                <li>
                  <strong>Alma:</strong> Taşlarımdan biri savunmasız mı? Rakibin bedava taşı var mı?
                </li>
                <li>
                  <strong>Tehdit:</strong> Rakibin son hamlesi neye saldırıyor? Benim hamlemden sonra ne alabilir?
                </li>
              </ol>
            </section>
          </>
        )}
      </aside>
    </div>
  );
}
