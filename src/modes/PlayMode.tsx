// Eğitmenle maç: motora karşı oyna, her hamlende koçtan düz Türkçe geri bildirim al.
// Oyun otomatik kaydedilir; "Hafızaya al" ile kalıcı kayıt listesine eklenir.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import Board, { type Mark } from '../components/Board';
import EvalBar from '../components/EvalBar';
import EvalGraph from '../components/EvalGraph';
import MoveList from '../components/MoveList';
import CoachCard from '../components/CoachCard';
import AdviceCard from '../components/AdviceCard';
import HintCard from '../components/HintCard';
import QuizCard from '../components/QuizCard';
import { QUIZ_MODE_KEY, SIMPLE_KEY, shouldQuiz, type QuizMode } from '../lib/quiz';
import {
  advise,
  buildQuiz,
  CLASS_INFO,
  explainQuizChoice,
  explainThreat,
  QUIZ_OPTS,
  reviewMove,
  simplifyAnalysis,
  tacticalHint,
  type Advice,
  type BoardArrow,
  type MoveClass,
  type MoveReview,
  type Quiz,
  type QuizOption,
  type TacticalHint,
  type ThreatInfo,
} from '../lib/coach';
import type { Analysis } from '../lib/engine';
import { botSearchOptions, getLevel, LEVELS, pickBotMove, type LevelId } from '../lib/bot';
import { gameResult, tryMove, type GameResult } from '../lib/game';
import { passTurnFen, toTurkishSan } from '../lib/tactics';
import { describeMoveObj, sentence } from '../lib/describe';
import { scoreFor } from '../lib/evaluation';
import type { Score } from '../lib/uci';
import { AFTER_OPTS, COACH_OPTS, useEngine } from '../lib/useEngine';
import { loadLocal, saveLocal, usePersistent } from '../lib/usePersistent';
import { setSoundEnabled, soundForSan } from '../lib/sound';

const START = new Chess().fen();

export interface PlayedMove {
  uci: string;
  san: string;
  trSan: string;
  /** Düz açıklama: "Atını f3'e götürdün" / "Rakip atını f3'e getirdi" */
  text: string;
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

export interface GameSnapshot {
  id: string;
  savedAt: string;
  myColor: 'w' | 'b';
  level: LevelId;
  moves: PlayedMove[];
  over: boolean;
  resultText: string | null;
  undos: number;
}

export const CURRENT_KEY = 'sk.play.current';
const SAVED_KEY = 'sk.play.saved';
const MAX_SAVED = 20;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fenOf = (list: PlayedMove[]) => (list.length ? list[list.length - 1].fen : START);

function accuracyOf(losses: number[]): number | null {
  if (losses.length === 0) return null;
  // Lichess'in hamle doğruluğu formülü (kazanma yüzdesi kaybından)
  const acc = losses.map((l) => Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * l) - 3.1669)));
  return Math.round(acc.reduce((a, b) => a + b, 0) / acc.length);
}

function loadSaved(): GameSnapshot[] {
  return loadLocal<{ list: GameSnapshot[] }>(SAVED_KEY, { list: [] }).list;
}

export default function PlayMode({ active = true }: { active?: boolean }) {
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

  // Kaldığı yerden devam: sayfa açılınca son oyun geri yüklenir.
  const [initial] = useState(() => {
    const cur = loadLocal<{ game: GameSnapshot | null }>(CURRENT_KEY, { game: null }).game;
    return cur && Array.isArray(cur.moves) ? cur : null;
  });

  const [gameId, setGameId] = useState(initial?.id ?? String(Date.now()));
  const [phase, setPhase] = useState<'setup' | 'playing' | 'over'>(initial ? (initial.over ? 'over' : 'playing') : 'setup');
  const [myColor, setMyColor] = useState<'w' | 'b'>(initial?.myColor ?? 'w');
  const [orientation, setOrientation] = useState<'w' | 'b'>(initial?.myColor ?? 'w');
  const [moves, setMoves] = useState<PlayedMove[]>(initial?.moves ?? []);
  const movesRef = useRef<PlayedMove[]>(initial?.moves ?? []);
  const commit = (list: PlayedMove[]) => {
    movesRef.current = list;
    setMoves(list);
  };
  const [view, setView] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(() => {
    if (!initial) return null;
    const i = [...initial.moves.keys()].reverse().find((k) => initial.moves[k].by === 'me' && initial.moves[k].review);
    return i ?? null;
  });
  const [compare, setCompare] = useState<'before' | 'after' | null>(null);
  const [busy, setBusy] = useState<null | 'review' | 'bot' | 'threat' | 'advice'>(null);
  const [guardIdx, setGuardIdx] = useState<number | null>(null);
  const [threat, setThreat] = useState<ThreatInfo | null>(null);
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [quiz, setQuiz] = useState<{ quiz: Quiz; analysis: Analysis; picked: QuizOption | null } | null>(null);
  const [hint, setHint] = useState<TacticalHint | null>(null);
  const [simple, setSimple] = usePersistent<{ on: boolean }>(SIMPLE_KEY, { on: true });
  const simpleRef = useRef(simple.on);
  useEffect(() => {
    simpleRef.current = simple.on;
  }, [simple.on]);
  const [quizMode, setQuizMode] = usePersistent<{ mode: QuizMode }>(QUIZ_MODE_KEY, { mode: 'sometimes' });
  const [resultText, setResultText] = useState<string | null>(initial?.resultText ?? null);
  const [liveScore, setLiveScore] = useState<Score | null>(null);
  const [engineErr, setEngineErr] = useState<string | null>(null);
  const [undos, setUndos] = useState(initial?.undos ?? 0);
  const [saved, setSaved] = useState<GameSnapshot[]>(loadSaved);
  const [toast, setToast] = useState<string | null>(null);
  const token = useRef(0);
  const myColorRef = useRef<'w' | 'b'>(initial?.myColor ?? 'w');

  const liveFen = fenOf(moves);

  const snapshot = useCallback(
    (): GameSnapshot => ({
      id: gameId,
      savedAt: new Date().toISOString(),
      myColor,
      level: setup.level,
      moves: movesRef.current,
      over: phase === 'over',
      resultText,
      undos,
    }),
    [gameId, myColor, setup.level, phase, resultText, undos],
  );

  // Devam eden oyunu her değişiklikte otomatik sakla (yalnızca bu tarayıcıda)
  useEffect(() => {
    if (phase === 'setup') return;
    saveLocal(CURRENT_KEY, { game: snapshot() });
  }, [phase, moves, snapshot]);

  // Açılışta: sıra bottaysa (ör. bot düşünürken sayfa kapandıysa) devam ettir
  useEffect(() => {
    if (initial && !initial.over && new Chess(fenOf(initial.moves)).turn() !== initial.myColor) void botMove(fenOf(initial.moves), token.current);
    else if (initial && !initial.over) prefetch(fenOf(initial.moves));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showToast = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(null), 2500);
  };

  const clearAids = () => {
    setThreat(null);
    setAdvice(null);
    setQuiz(null);
    setHint(null);
    setCompare(null);
  };

  const finish = (res: GameResult, resigned = false) => {
    const me = myColorRef.current;
    let text: string;
    if (resigned) text = 'Teslim oldun.';
    else if (res.winner === me) text = `Kazandın! (${res.reason})`;
    else if (res.winner) text = `Kaybettin. (${res.reason})`;
    else text = `Berabere. (${res.reason})`;
    setResultText(text);
    setPhase('over');
    setBusy(null);
  };

  const pushMove = (list: PlayedMove[], fen: string, from: string, to: string, promotion: string | undefined, by: 'me' | 'bot') => {
    const c = new Chess(fen);
    const m = tryMove(c, from, to, promotion);
    if (!m) return null;
    const pm: PlayedMove = {
      uci: m.from + m.to + (m.promotion ?? ''),
      san: m.san,
      trSan: toTurkishSan(m.san),
      text: describeMoveObj(m, by === 'me' ? 'pastMine' : 'oppPast'),
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

  function prefetch(fen: string) {
    engine
      .analyze(fen, COACH_OPTS)
      .then((a) => {
        if (fenOf(movesRef.current) === fen && a.lines[0]) setLiveScore(scoreFor(a.lines[0].score, new Chess(fen).turn(), 'w'));
      })
      .catch(() => {});
  }

  async function botMove(fen: string, t: number) {
    setBusy('bot');
    const level = getLevel(setupRef.current.level);
    const t0 = Date.now();
    let analysis = null;
    try {
      analysis = await engine.analyze(fen, botSearchOptions(level));
    } catch (e) {
      if (t === token.current) setEngineErr(`${(e as Error).message} Rakip şimdilik rastgele oynayacak.`);
    }
    await sleep(Math.max(0, 420 - (Date.now() - t0)));
    if (t !== token.current || fenOf(movesRef.current) !== fen) return;
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
  }

  const afterUserMove = async (t: number, fenBefore: string, pm: PlayedMove, chess: Chess, idx: number) => {
    setBusy('review');
    let review: MoveReview | null = null;
    try {
      // Basit modda değerlendirme de seviyeye uygun basit hamleyi ölçü alır (çelişkili öneri olmasın)
      const rawBefore = await engine.analyze(fenBefore, simpleRef.current ? QUIZ_OPTS : COACH_OPTS);
      const before = simpleRef.current ? simplifyAnalysis(fenBefore, rawBefore).analysis : rawBefore;
      const after = chess.isGameOver() ? null : await engine.analyze(pm.fen, AFTER_OPTS);
      if (t !== token.current) return;
      review = reviewMove(fenBefore, { from: pm.from, to: pm.to, promotion: pm.uci[4] }, before, after, idx);
      const rv = review;
      commit(movesRef.current.map((m, i) => (i === idx && m.uci === pm.uci ? { ...m, review: rv } : m)));
      setSelected(idx);
      setLiveScore(rv.whiteScoreAfter);
      setEngineErr(null);
    } catch (e) {
      if (t !== token.current) return;
      if ((e as Error).message !== 'İptal edildi') setEngineErr(`Koç analizi yapılamadı: ${(e as Error).message}`);
    }
    if (t !== token.current) return;
    setBusy(null);
    const res = gameResult(chess);
    if (res.over) return finish(res);
    if (setupRef.current.guard && review?.cls === 'blunder') {
      setGuardIdx(idx);
      return;
    }
    void botMove(pm.fen, t);
  };

  const onUserMove = (from: string, to: string, promotion?: string) => {
    if (phase !== 'playing' || busy === 'review' || busy === 'bot' || guardIdx !== null || view !== null) return false;
    const list = movesRef.current;
    const fen = fenOf(list);
    if (new Chess(fen).turn() !== myColor) return false;
    const r = pushMove(list, fen, from, to, promotion, 'me');
    if (!r) return false;
    clearAids();
    void afterUserMove(token.current, fen, r.pm, r.chess, r.list.length - 1);
    return true;
  };

  const loadGame = (g: GameSnapshot) => {
    token.current++;
    engine.interrupt();
    myColorRef.current = g.myColor;
    setGameId(g.id);
    setMyColor(g.myColor);
    setOrientation(g.myColor);
    setSetup((s) => ({ ...s, level: g.level }));
    commit(g.moves);
    setView(null);
    const lastMine = [...g.moves.keys()].reverse().find((i) => g.moves[i].by === 'me' && g.moves[i].review);
    setSelected(lastMine ?? null);
    setGuardIdx(null);
    setBusy(null);
    setResultText(g.resultText);
    setUndos(g.undos ?? 0);
    setLiveScore(null);
    setEngineErr(null);
    clearAids();
    setPhase(g.over ? 'over' : 'playing');
    if (!g.over) {
      const fen = fenOf(g.moves);
      if (new Chess(fen).turn() !== g.myColor) void botMove(fen, token.current);
      else prefetch(fen);
    }
  };

  const startGame = () => {
    const color = setup.color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : setup.color;
    loadGame({ id: String(Date.now()), savedAt: '', myColor: color, level: setup.level, moves: [], over: false, resultText: null, undos: 0 });
  };

  const saveToMemory = () => {
    const snap = snapshot();
    const list = [snap, ...saved.filter((g) => g.id !== snap.id)].slice(0, MAX_SAVED);
    saveLocal(SAVED_KEY, { list });
    setSaved(list);
    showToast('Oyun hafızaya alındı ✓');
  };

  const deleteSaved = (id: string) => {
    const list = saved.filter((g) => g.id !== id);
    saveLocal(SAVED_KEY, { list });
    setSaved(list);
  };

  const undo = () => {
    token.current++;
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
      setResultText(null);
    }
    const fen = fenOf(list);
    if (new Chess(fen).turn() !== myColor) void botMove(fen, token.current);
    else prefetch(fen);
  };

  const continueAfterGuard = () => {
    setGuardIdx(null);
    void botMove(liveFen, token.current);
  };

  const showThreat = async () => {
    if (threat) return setThreat(null);
    setAdvice(null);
    setCompare(null);
    setView(null);
    const fen = liveFen;
    const passed = passTurnFen(fen);
    setBusy('threat');
    try {
      const [p, cur] = await Promise.all([
        passed ? engine.analyze(passed, { depth: 12, movetime: 2500, timeoutMs: 6000 }) : Promise.resolve(null),
        engine.analyze(fen, simple.on ? QUIZ_OPTS : COACH_OPTS),
      ]);
      if (fenOf(movesRef.current) === fen) setThreat(explainThreat(fen, p, simple.on ? simplifyAnalysis(fen, cur).analysis : cur));
    } catch (e) {
      setEngineErr((e as Error).message);
    } finally {
      setBusy((b) => (b === 'threat' ? null : b));
    }
  };

  const showAdvice = async () => {
    if (advice || quiz || hint) {
      setAdvice(null);
      setQuiz(null);
      setHint(null);
      return;
    }
    setThreat(null);
    setCompare(null);
    setView(null);
    const fen = liveFen;
    setBusy('advice');
    try {
      // Sadece ipucu: hamleyi söylemeden en iyi hamledeki taktik temayı anlatır
      if (quizMode.mode === 'hint') {
        const a = await engine.analyze(fen, simple.on ? QUIZ_OPTS : COACH_OPTS);
        if (fenOf(movesRef.current) === fen) setHint(tacticalHint(fen, a, { simple: simple.on }));
        return;
      }
      // Bazen direkt söylemek yerine 3 seçenek sorar: kullanıcı en iyisini tahmin eder.
      if (shouldQuiz(quizMode.mode)) {
        const a = await engine.analyze(fen, QUIZ_OPTS);
        if (fenOf(movesRef.current) !== fen) return;
        const q = buildQuiz(fen, a, undefined, { simple: simple.on });
        if (q) setQuiz({ quiz: q, analysis: simple.on ? simplifyAnalysis(fen, a).analysis : a, picked: null });
        else setAdvice(advise(fen, a, { simple: simple.on }));
        return;
      }
      const a = await engine.analyze(fen, simple.on ? QUIZ_OPTS : COACH_OPTS);
      if (fenOf(movesRef.current) === fen) setAdvice(advise(fen, a, { simple: simple.on }));
    } catch (e) {
      setEngineErr((e as Error).message);
    } finally {
      setBusy((b) => (b === 'advice' ? null : b));
    }
  };

  // Klavye: ← → ile hamleler arasında gezin (yalnızca bu sekme açıkken)
  useEffect(() => {
    if (!active) return;
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
  }, [active]);

  // --- Tahtada ne gösterilecek? ---
  const review = selected !== null ? moves[selected]?.review : undefined;
  let boardFen = liveFen;
  let lastMove: { from: string; to: string } | null = moves.length ? moves[moves.length - 1] : null;
  const quizArrows: BoardArrow[] | null = quiz
    ? quiz.picked
      ? [
          ...(quiz.picked.correct ? [] : [{ from: quiz.picked.uci.slice(0, 2), to: quiz.picked.uci.slice(2, 4), color: 'red' as const }]),
          { from: quiz.quiz.bestUci.slice(0, 2), to: quiz.quiz.bestUci.slice(2, 4), color: 'green' as const },
        ]
      : quiz.quiz.options.map((o) => ({ from: o.uci.slice(0, 2), to: o.uci.slice(2, 4), color: o.color }))
    : null;
  let arrows = threat?.arrows ?? quizArrows ?? advice?.arrows ?? [];
  let marks: Record<string, Mark> = {};
  if (threat) for (const s of threat.dangerSquares) marks[s] = 'danger';
  let interactive = phase === 'playing' && (!busy || busy === 'threat' || busy === 'advice') && guardIdx === null;

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

  const myReviews = moves.filter((m) => m.by === 'me' && m.review).map((m) => m.review!);
  const counts = myReviews.reduce<Partial<Record<MoveClass, number>>>((acc, r) => ({ ...acc, [r.cls]: (acc[r.cls] ?? 0) + 1 }), {});
  const accuracy = accuracyOf(myReviews.map((r) => r.loss));
  const graphPoints = moves.map((m) => ({ score: m.review?.whiteScoreAfter ?? null, cls: m.review?.cls }));
  for (let i = 0; i < graphPoints.length; i++) if (!graphPoints[i].score) graphPoints[i].score = i > 0 ? graphPoints[i - 1].score : { type: 'cp', value: 0 };

  const level = getLevel(setup.level);
  const isMyTurn = new Chess(liveFen).turn() === myColor;
  const lastBot = moves.length && moves[moves.length - 1].by === 'bot' ? moves[moves.length - 1] : null;
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
  const isSaved = saved.some((g) => g.id === gameId);

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
        {phase === 'playing' && lastBot && !compare && view === null && <p className="last-opp">↪ {sentence(lastBot.text)}</p>}
        <div className="board-wrap">
          {setup.showEval && <EvalBar score={liveScore} orientation={orientation} />}
          <Board
            fen={boardFen}
            orientation={orientation}
            movable={interactive && view === null && !compare ? myColor : 'none'}
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
            {compare === 'before' && 'Hamleden önceki konum (yeşil ok: doğrusu).'}
            {compare === 'after' && 'Hamleden sonraki konum (kırmızı ok: rakibin en güçlü cevabı).'}
            {!compare && view !== null && 'Geçmiş bir konuma bakıyorsun.'}
            <button
              className="link"
              onClick={() => {
                setCompare(null);
                setView(null);
              }}
            >
              Oyuna dön
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
          {phase !== 'setup' && (
            <button onClick={saveToMemory} className={isSaved ? 'saved' : ''}>
              💾 {isSaved ? 'Kaydı güncelle' : 'Hafızaya al'}
            </button>
          )}
        </div>
        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
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
              <input type="checkbox" checked={simple.on} onChange={(e) => setSimple({ on: e.target.checked })} />
              <span>
                <strong>Önerileri seviyeme göre basitleştir:</strong> Koç anlaşılır ve sağlam hamleler önersin, uzun kombinasyonlar değil (yeni
                başlayanlar için).
              </span>
            </label>
            <label className="check">
              <input type="checkbox" checked={setup.showEval} onChange={(e) => setSetup({ ...setup, showEval: e.target.checked })} />
              <span>Oyun sırasında değerlendirme çubuğunu göster</span>
            </label>
            <div className="field" role="group" aria-label="Tahmin soruları">
              <span>Ne oynamalıyım butonuna basınca</span>
              <div className="seg">
                {(
                  [
                    ['off', 'Hep cevabı söyle'],
                    ['sometimes', 'Bazen 3 şık sor'],
                    ['always', 'Hep 3 şık sor'],
                    ['hint', 'Sadece ipucu ver'],
                  ] as const
                ).map(([m, label]) => (
                  <button key={m} className={quizMode.mode === m ? 'on' : ''} onClick={() => setQuizMode({ mode: m })}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <label className="check">
              <input type="checkbox" checked={setup.sound} onChange={(e) => setSetup({ ...setup, sound: e.target.checked })} />
              <span>Hamle sesleri</span>
            </label>
            <button className="primary" onClick={startGame} disabled={status === 'loading'}>
              Oyuna başla
            </button>
            <p className="muted small">
              Seviyelerdeki puanlar yaklaşık tahmindir. Seviyeler birbirine karşı oynatılarak sıralandı; chess.com puanıyla birebir eşleşmez.
            </p>
          </section>
        )}

        {phase === 'setup' && saved.length > 0 && (
          <section className="card">
            <h3>💾 Hafızadaki oyunların</h3>
            <ul className="saved-list">
              {saved.map((g) => (
                <li key={g.id}>
                  <div>
                    <strong>{g.myColor === 'w' ? 'Beyaz' : 'Siyah'}</strong> · {getLevel(g.level).name} · {Math.ceil(g.moves.length / 2)}. hamle
                    <br />
                    <small className="muted">
                      {new Date(g.savedAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}
                      {g.resultText ? ` · ${g.resultText}` : ' · devam ediyor'}
                    </small>
                  </div>
                  <div className="row">
                    <button onClick={() => loadGame(g)}>{g.over ? 'İncele' : 'Devam et'}</button>
                    <button className="danger" onClick={() => confirm('Bu kaydı silmek istiyor musun?') && deleteSaved(g.id)} aria-label="Sil">
                      🗑
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {phase !== 'setup' && (
          <>
            <div className="actions">
              <button onClick={showAdvice} className={advice || quiz || hint ? 'on' : ''} disabled={phase !== 'playing' || !isMyTurn || busy === 'bot' || busy === 'review'}>
                👉 Ne oynamalıyım?
              </button>
              <button onClick={showThreat} className={threat ? 'on' : ''} disabled={phase !== 'playing' || busy === 'bot' || busy === 'review'}>
                ⚠ Rakibim ne tehdit ediyor?
              </button>
            </div>
            {(busy === 'advice' || busy === 'threat') && <p className="muted small">Koç düşünüyor…</p>}

            {guardIdx !== null && moves[guardIdx]?.review && (
              <section className="card guard">
                <h3>Dur! Bu hamle büyük bir hata.</h3>
                <p>{moves[guardIdx].review!.reasons[0]}</p>
                {moves[guardIdx].review!.best && (
                  <p>
                    <span className="muted">Doğrusu:</span> <strong>{moves[guardIdx].review!.best!.text}</strong>
                  </p>
                )}
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

            {hint && (
              <HintCard
                hint={hint}
                onReveal={() => {
                  setAdvice(hint.reveal);
                  setHint(null);
                }}
                onClose={() => setHint(null)}
              />
            )}

            {quiz && (
              <QuizCard
                key={quiz.quiz.fen}
                quiz={quiz.quiz}
                onReveal={(o) => setQuiz((q) => (q ? { ...q, picked: o } : q))}
                explain={async (uci) => {
                  const c = new Chess(quiz.quiz.fen);
                  c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
                  const after = c.isGameOver() ? null : await engine.analyze(c.fen(), AFTER_OPTS);
                  return explainQuizChoice(quiz.quiz.fen, quiz.analysis, uci, after);
                }}
                onPlay={(u) => onUserMove(u.slice(0, 2), u.slice(2, 4), u[4])}
                onClose={() => setQuiz(null)}
              />
            )}

            {advice && <AdviceCard advice={advice} onPlay={(u) => onUserMove(u.slice(0, 2), u.slice(2, 4), u[4])} onClose={() => setAdvice(null)} />}

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
                {threat.advice && (
                  <p className="advice-main">
                    👉 Ne yapmalısın: <strong>{threat.advice}</strong>
                  </p>
                )}
                <p className="muted small">Turuncu ok: rakibin tehdidi. Yeşil ok: senin en iyi hamlen. Kırmızı kare: korumasız taşın.</p>
              </section>
            )}

            {resultText && phase === 'over' && (
              <section className="card result">
                <h3>{resultText}</h3>
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
                  <button className="primary" onClick={startGame}>
                    Yeni oyun
                  </button>
                  <button className="secondary" onClick={() => setPhase('setup')}>
                    Ayarlar ve kayıtlar
                  </button>
                </div>
              </section>
            )}

            {review && !advice && !threat && !quiz && !hint && (
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
                moves={moves.map((m) => ({ san: m.san, title: m.text, cls: m.by === 'me' ? m.review?.cls : undefined }))}
                current={view ?? (moves.length ? moves.length - 1 : null)}
                onSelect={(i) => {
                  setCompare(null);
                  setAdvice(null);
                  setThreat(null);
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
                <label className="check inline">
                  <input type="checkbox" checked={simple.on} onChange={(e) => setSimple({ on: e.target.checked })} />
                  <span>Basit öneriler</span>
                </label>
                <select
                  aria-label="Tahmin soruları"
                  value={quizMode.mode}
                  onChange={(e) => setQuizMode({ mode: e.target.value as QuizMode })}
                >
                  <option value="off">Hep cevabı söyle</option>
                  <option value="sometimes">Bazen 3 şık sor</option>
                  <option value="always">Hep 3 şık sor</option>
                  <option value="hint">Sadece ipucu ver</option>
                </select>
                <button
                  onClick={() => {
                    if (moves.length === 0 || isSaved || confirm('Yeni oyuna geçilsin mi? Bu oyunu saklamak istersen önce "Hafızaya al"a bas.')) {
                      token.current++;
                      engine.interrupt();
                      setBusy(null);
                      setPhase('setup');
                    }
                  }}
                >
                  Yeni oyun
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    if (confirm('Teslim olmak istediğine emin misin?')) {
                      token.current++;
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
                  <strong>Alma:</strong> Taşlarımdan biri korumasız mı? Rakibin bedava taşı var mı?
                </li>
                <li>
                  <strong>Tehdit:</strong> Rakibin son hamlesi neye saldırıyor? Benim hamlemden sonra ne alabilir?
                </li>
              </ol>
              <p className="muted small">Kareler tahtanın kenarındaki harf ve rakamla okunur: “e4” = e sütunu, 4. sıra.</p>
            </section>
          </>
        )}
      </aside>
    </div>
  );
}
