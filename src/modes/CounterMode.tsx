// "Rakip şunu yaparsa ben ne yapmalıyım?" — Karşı hamle modu.
// Kullanıcı rakibin olası hamlesini tahtada oynar, koç en iyi cevabı düz Türkçe ile söyler.
import { useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import Board from '../components/Board';
import AdviceCard from '../components/AdviceCard';
import HintCard from '../components/HintCard';
import QuizCard from '../components/QuizCard';
import { getQuizMode, getSimple, shouldQuiz } from '../lib/quiz';
import CoachCard from '../components/CoachCard';
import MoveList from '../components/MoveList';
import {
  advise,
  buildQuiz,
  explainQuizChoice,
  QUIZ_OPTS,
  reviewMove,
  simplifyAnalysis,
  tacticalHint,
  type Advice,
  type BoardArrow,
  type MoveReview,
  type Quiz,
  type QuizOption,
  type TacticalHint,
} from '../lib/coach';
import type { Analysis } from '../lib/engine';
import { describeMoveObj, sentence } from '../lib/describe';
import { gameResult, tryMove } from '../lib/game';
import { AFTER_OPTS, COACH_OPTS, useEngine } from '../lib/useEngine';
import { loadLocal, saveLocal } from '../lib/usePersistent';
import { soundForSan } from '../lib/sound';
import { CURRENT_KEY, type GameSnapshot } from './PlayMode';

const START = new Chess().fen();

interface CMove {
  uci: string;
  san: string;
  text: string;
  fen: string;
  from: string;
  to: string;
  mine: boolean;
}

interface CounterState {
  myColor: 'w' | 'b';
  startFen: string;
  moves: CMove[];
}

const KEY = 'sk.counter';

export default function CounterMode({ active = true }: { active?: boolean }) {
  const { engine, status } = useEngine();
  const [st, setSt] = useState<CounterState>(() => loadLocal<CounterState>(KEY, { myColor: 'w', startFen: START, moves: [] }));
  const [advice, setAdvice] = useState<{ advice: Advice; context?: string; fen: string } | null>(null);
  const [quiz, setQuiz] = useState<{ quiz: Quiz; analysis: Analysis; context?: string; picked: QuizOption | null } | null>(null);
  const [hint, setHint] = useState<{ hint: TacticalHint; fen: string; context?: string } | null>(null);
  const [oppBest, setOppBest] = useState<{ text: string; uci: string; fen: string } | null>(null);
  const [review, setReview] = useState<MoveReview | null>(null);
  const [compare, setCompare] = useState<'before' | 'after' | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const token = useRef(0);

  useEffect(() => saveLocal(KEY, st), [st]);

  const fen = st.moves.length ? st.moves[st.moves.length - 1].fen : st.startFen;
  const turn = new Chess(fen).turn();
  const myTurn = turn === st.myColor;
  const over = gameResult(new Chess(fen)).over;

  const reset = (next: Partial<CounterState>) => {
    token.current++;
    setSt((s) => ({ ...s, moves: [], ...next }));
    setAdvice(null);
    setQuiz(null);
    setHint(null);
    setOppBest(null);
    setReview(null);
    setCompare(null);
  };

  /** Sıra bendeyken en iyi cevabı hesapla. context: rakibin son hamlesi. */
  const computeAdvice = async (f: string, context?: string) => {
    const t = ++token.current;
    setBusy(true);
    setErr(null);
    try {
      const simple = getSimple();
      if (getQuizMode() === 'hint') {
        const ha = await engine.analyze(f, simple ? QUIZ_OPTS : COACH_OPTS);
        if (t !== token.current) return;
        const h = tacticalHint(f, ha, { simple });
        if (h) {
          setHint({ hint: h, fen: f, context });
          return;
        }
      }
      if (shouldQuiz(getQuizMode())) {
        const qa = await engine.analyze(f, QUIZ_OPTS);
        if (t !== token.current) return;
        const q = buildQuiz(f, qa, undefined, { simple });
        if (q) {
          setQuiz({ quiz: q, analysis: simple ? simplifyAnalysis(f, qa).analysis : qa, context, picked: null });
          return;
        }
      }
      const a = await engine.analyze(f, simple ? QUIZ_OPTS : COACH_OPTS);
      if (t !== token.current) return;
      const adv = advise(f, a, { simple });
      setAdvice(adv ? { advice: adv, context, fen: f } : null);
    } catch (e) {
      if (t === token.current) setErr((e as Error).message);
    } finally {
      if (t === token.current) setBusy(false);
    }
  };

  const onMove = (from: string, to: string, promotion?: string) => {
    if (compare) return false;
    const c = new Chess(fen);
    const m = tryMove(c, from, to, promotion);
    if (!m) return false;
    const mine = m.color === st.myColor;
    const cm: CMove = {
      uci: m.from + m.to + (m.promotion ?? ''),
      san: m.san,
      text: describeMoveObj(m, mine ? 'pastMine' : 'oppPast'),
      fen: c.fen(),
      from: m.from,
      to: m.to,
      mine,
    };
    setSt((s) => ({ ...s, moves: [...s.moves, cm] }));
    soundForSan(m.san, c.isGameOver());
    setOppBest(null);
    setCompare(null);
    setAdvice(null);
    setQuiz(null);
    setHint(null);
    const fenBefore = fen;
    if (!mine) {
      // Rakip (kullanıcının oynadığı) hamleden sonra: en iyi cevabı söyle
      setReview(null);
      if (!c.isGameOver()) void computeAdvice(c.fen(), `${describeMoveObj(m, 'oppIf')}:`);
    } else {
      // Kendi hamlemi değerlendir
      const t = ++token.current;
      setBusy(true);
      void (async () => {
        try {
          const simple = getSimple();
          const rawBefore = await engine.analyze(fenBefore, simple ? QUIZ_OPTS : COACH_OPTS);
          const before = simple ? simplifyAnalysis(fenBefore, rawBefore).analysis : rawBefore;
          const after = c.isGameOver() ? null : await engine.analyze(c.fen(), AFTER_OPTS);
          if (t !== token.current) return;
          setReview(reviewMove(fenBefore, { from: m.from, to: m.to, promotion: m.promotion }, before, after));
        } catch (e) {
          if (t === token.current) setErr((e as Error).message);
        } finally {
          if (t === token.current) setBusy(false);
        }
      })();
    }
    return true;
  };

  const showOppBest = async () => {
    const t = ++token.current;
    setBusy(true);
    try {
      const a = await engine.analyze(fen, COACH_OPTS);
      if (t !== token.current || !a.lines[0]) return;
      const u = a.lines[0].pv[0];
      const c = new Chess(fen);
      const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      setOppBest({ text: describeMoveObj(m, 'oppFuture'), uci: u, fen });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      if (t === token.current) setBusy(false);
    }
  };

  const undo = () => {
    token.current++;
    setBusy(false);
    setSt((s) => ({ ...s, moves: s.moves.slice(0, -1) }));
    setAdvice(null);
    setQuiz(null);
    setHint(null);
    setOppBest(null);
    setReview(null);
    setCompare(null);
  };

  const fromGame = () => {
    const g = loadLocal<{ game: GameSnapshot | null }>(CURRENT_KEY, { game: null }).game;
    if (!g || g.moves.length === 0) {
      setErr('Eğitmenle Maç sekmesinde devam eden bir oyun yok.');
      return;
    }
    const last = g.moves[g.moves.length - 1];
    reset({ myColor: g.myColor, startFen: last.fen });
    const c = new Chess(last.fen);
    if (c.turn() === g.myColor && !c.isGameOver())
      void computeAdvice(last.fen, last.by === 'bot' ? sentence(`Maçta son olarak: ${last.text}`) : undefined);
  };

  // Tahtada gösterilecekler
  let boardFen = fen;
  let arrows: BoardArrow[] = [];
  let lastMove = st.moves.length ? st.moves[st.moves.length - 1] : null;
  const marks: Record<string, 'danger'> = {};
  if (advice && advice.fen === fen) arrows = advice.advice.arrows;
  if (quiz && quiz.quiz.fen === fen)
    arrows = quiz.picked
      ? [
          ...(quiz.picked.correct ? [] : [{ from: quiz.picked.uci.slice(0, 2), to: quiz.picked.uci.slice(2, 4), color: 'red' as const }]),
          { from: quiz.quiz.bestUci.slice(0, 2), to: quiz.quiz.bestUci.slice(2, 4), color: 'green' as const },
        ]
      : quiz.quiz.options.map((o) => ({ from: o.uci.slice(0, 2), to: o.uci.slice(2, 4), color: o.color }));
  if (oppBest && oppBest.fen === fen) arrows = [{ from: oppBest.uci.slice(0, 2), to: oppBest.uci.slice(2, 4), color: 'orange' }];
  if (compare && review) {
    boardFen = compare === 'before' ? review.fenBefore : review.fenAfter;
    arrows = compare === 'before' ? review.beforeArrows : review.afterArrows;
    lastMove = compare === 'before' ? (st.moves.length > 1 ? st.moves[st.moves.length - 2] : null) : lastMove;
    if (compare === 'after') for (const s of review.dangerSquares) marks[s] = 'danger';
  }

  // Klavye: geri al (yalnızca sekme açıkken)
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && (e.target as HTMLElement)?.tagName !== 'INPUT') undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <div className="layout">
      <div className="board-col">
        <p className={`counter-prompt ${myTurn ? 'mine' : 'opp'}`}>
          {over
            ? 'Oyun bitti.'
            : myTurn
              ? '🟢 Sıra sende: önerilen hamleyi oynayabilir ya da kendi hamleni deneyebilirsin.'
              : '🟠 Rakip adına oyna: rakibin yapabileceği bir hamleyi tahtada yap, sana cevabını söyleyeyim.'}
        </p>
        <Board
          fen={boardFen}
          orientation={st.myColor}
          movable={compare ? 'none' : 'both'}
          onMove={onMove}
          lastMove={lastMove}
          arrows={arrows}
          marks={marks}
        />
        <div className="toolbar">
          <button onClick={undo} disabled={st.moves.length === 0}>
            ↶ Geri al
          </button>
          <button onClick={() => reset({ startFen: START })}>⟲ Baştan</button>
          <button onClick={fromGame}>♟ Maçtaki konumu al</button>
        </div>
      </div>

      <aside className="side">
        {status === 'error' && <div className="alert">Motor kullanılamıyor; öneri verilemiyor.</div>}
        {err && <div className="alert">{err}</div>}

        <section className="card">
          <h2>Rakip bunu yaparsa?</h2>
          <p className="small">
            Rakibin yapabileceği hamleyi tahtada sen oyna (onun taşlarını da oynatabilirsin). Koç sana <strong>en iyi cevabını</strong> düz
            cümleyle söyler ve yeşil okla gösterir.
          </p>
          <div className="field" role="group" aria-label="Benim rengim">
            <span>Ben hangi renkteyim?</span>
            <div className="seg">
              {(['w', 'b'] as const).map((c) => (
                <button key={c} className={st.myColor === c ? 'on' : ''} onClick={() => reset({ myColor: c, startFen: START })}>
                  {c === 'w' ? 'Beyaz' : 'Siyah'}
                </button>
              ))}
            </div>
          </div>
          <div className="actions">
            <button
              onClick={() => (advice || quiz || hint ? (setAdvice(null), setQuiz(null), setHint(null)) : computeAdvice(fen))}
              disabled={!myTurn || over || busy}
            >
              👉 Ne oynamalıyım?
            </button>
            <button onClick={() => (oppBest ? setOppBest(null) : showOppBest())} disabled={myTurn || over || busy}>
              💪 Rakibin en güçlü hamlesi ne?
            </button>
          </div>
          {busy && <p className="muted small">Koç düşünüyor…</p>}
        </section>

        {oppBest && oppBest.fen === fen && (
          <section className="card threat">
            <h3>Rakibin en güçlü hamlesi:</h3>
            <p className="advice-main">💪 {sentence(oppBest.text)}</p>
            <p className="muted small">Turuncu ok tahtada gösteriyor. Bu hamleyi rakip adına oynarsan sana nasıl cevap vereceğini söylerim.</p>
            <button
              className="primary small-primary"
              onClick={() => onMove(oppBest.uci.slice(0, 2), oppBest.uci.slice(2, 4), oppBest.uci[4])}
            >
              Rakip adına bunu oyna
            </button>
          </section>
        )}

        {hint && hint.fen === fen && (
          <>
            {hint.context && <p className="advice-context">{hint.context}</p>}
            <HintCard
              hint={hint.hint}
              onReveal={() => {
                if (hint.hint.reveal) setAdvice({ advice: hint.hint.reveal, context: hint.context, fen: hint.fen });
                setHint(null);
              }}
            />
          </>
        )}

        {quiz && quiz.quiz.fen === fen && (
          <QuizCard
            key={quiz.quiz.fen}
            quiz={quiz.quiz}
            context={quiz.context}
            onReveal={(o) => setQuiz((q) => (q ? { ...q, picked: o } : q))}
            explain={async (uci) => {
              const c = new Chess(quiz.quiz.fen);
              c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
              const after = c.isGameOver() ? null : await engine.analyze(c.fen(), AFTER_OPTS);
              return explainQuizChoice(quiz.quiz.fen, quiz.analysis, uci, after);
            }}
            onPlay={(u) => onMove(u.slice(0, 2), u.slice(2, 4), u[4])}
          />
        )}

        {advice && advice.fen === fen && (
          <AdviceCard
            advice={advice.advice}
            title="Senin en iyi cevabın"
            context={advice.context}
            onPlay={(u) => onMove(u.slice(0, 2), u.slice(2, 4), u[4])}
          />
        )}

        {review && <CoachCard review={review} compare={compare} onCompare={setCompare} />}

        <section className="card">
          <MoveList
            moves={st.moves.map((m) => ({ san: m.san, title: m.text }))}
            startsWithBlack={new Chess(st.startFen).turn() === 'b'}
            firstMoveNumber={Number(st.startFen.split(' ')[5] ?? 1)}
            current={st.moves.length ? st.moves.length - 1 : null}
            onSelect={() => {}}
          />
          {st.moves.length > 0 && (
            <ol className="plain-moves small">
              {st.moves.slice(-6).map((m, i) => (
                <li key={i} className={m.mine ? 'mine' : 'opp'}>
                  {sentence(m.text)}
                </li>
              ))}
            </ol>
          )}
        </section>
      </aside>
    </div>
  );
}
