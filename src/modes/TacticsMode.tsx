// Taktik antrenmanı: Lichess'in gerçek oyunlardan çıkardığı bulmacalar, tema tema.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import Board, { type Mark } from '../components/Board';
import type { BoardArrow } from '../lib/coach';
import { reviewMove } from '../lib/coach';
import { tryMove } from '../lib/game';
import {
  EMPTY_PROGRESS,
  THEMES,
  THEME_BY_ID,
  checkPuzzleMove,
  explainSolution,
  loadPuzzles,
  pickPuzzle,
  puzzleStart,
  recordResult,
  weakestThemes,
  type Puzzle,
  type ThemeId,
  type TacticsProgress,
} from '../lib/puzzles';
import { describeMove, describeMoveObj, sentence } from '../lib/describe';
import { AFTER_OPTS, COACH_OPTS, useEngine } from '../lib/useEngine';
import { usePersistent } from '../lib/usePersistent';
import { soundForSan, playMoveSound } from '../lib/sound';

type Status = 'loading' | 'opp' | 'solve' | 'checking' | 'wrong' | 'solved' | 'shown';
type Choice = ThemeId | 'mixed' | 'review';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function TacticsMode() {
  const { engine } = useEngine();
  const [prog, setProg] = usePersistent<TacticsProgress>('sk.tactics', EMPTY_PROGRESS);
  const [choice, setChoice] = usePersistent<{ c: Choice }>('sk.tactics.choice', { c: 'hangingPiece' });
  const [all, setAll] = useState<Puzzle[] | null>(null);
  const [meta, setMeta] = useState<{ sourceLastModified: string } | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [fen, setFen] = useState(new Chess().fen());
  const [orientation, setOrientation] = useState<'w' | 'b'>('w');
  const [ply, setPly] = useState(1);
  const [status, setStatus] = useState<Status>('loading');
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [arrows, setArrows] = useState<BoardArrow[]>([]);
  const [feedback, setFeedback] = useState<{ tone: 'good' | 'bad' | 'info'; title: string; lines: string[]; steps?: string[] } | null>(null);
  const [hintLevel, setHintLevel] = useState(0);
  const [rollback, setRollback] = useState<{ fen: string; lastMove: { from: string; to: string } | null } | null>(null);
  const [delta, setDelta] = useState<number | null>(null);
  const recorded = useRef(false);
  const progRef = useRef(prog);
  useEffect(() => {
    progRef.current = prog;
  }, [prog]);
  const token = useRef(0);

  useEffect(() => {
    loadPuzzles()
      .then(({ puzzles, meta }) => {
        setAll(puzzles);
        setMeta(meta);
      })
      .catch((e: Error) => setLoadErr(`Bulmacalar yüklenemedi: ${e.message}`));
  }, []);

  const record = (p: Puzzle, result: 'solved' | 'failed' | 'assisted') => {
    if (recorded.current) return;
    recorded.current = true;
    const old = progRef.current;
    const next = recordResult(old, p, result);
    progRef.current = next;
    setProg(next);
    setDelta(next.rating - old.rating);
  };

  const start = useCallback(
    async (c: Choice = choice.c) => {
      if (!all) return;
      const t = ++token.current;
      const failed = new Set(prog.failedIds);
      const p =
        c === 'review'
          ? pickPuzzle(all, { theme: null, rating: prog.rating, onlyIds: failed })
          : pickPuzzle(all, { theme: c === 'mixed' ? null : c, rating: prog.rating, exclude: new Set(prog.seenIds) });
      if (!p) {
        setFeedback({ tone: 'info', title: 'Tekrar edilecek bulmaca kalmadı.', lines: ['Hatalı çözdüğün tüm bulmacaları düzelttin!'] });
        setStatus('solved');
        return;
      }
      const s = puzzleStart(p);
      recorded.current = false;
      setPuzzle(p);
      setFen(p.fen);
      setOrientation(s.solver);
      setLastMove(null);
      setMarks({});
      setArrows([]);
      setFeedback(null);
      setHintLevel(0);
      setRollback(null);
      setDelta(null);
      setStatus('opp');
      await sleep(650);
      if (t !== token.current) return;
      setFen(s.fen);
      setLastMove(s.oppMove);
      playMoveSound('move');
      setPly(1);
      setStatus('solve');
    },
    [all, choice.c, prog.failedIds, prog.rating, prog.seenIds],
  );

  // İlk yüklemede bir bulmaca aç
  useEffect(() => {
    if (all && !puzzle) void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all]);

  const playOpponent = async (p: Puzzle, fenNow: string, nextPly: number, t: number) => {
    setStatus('opp');
    await sleep(450);
    if (t !== token.current) return;
    const u = p.moves[nextPly];
    const c = new Chess(fenNow);
    const m = tryMove(c, u.slice(0, 2), u.slice(2, 4), u[4]);
    if (!m) return;
    setFen(c.fen());
    setLastMove({ from: m.from, to: m.to });
    setMarks({});
    soundForSan(m.san, false);
    setPly(nextPly + 1);
    setStatus('solve');
  };

  const onMove = (from: string, to: string, promotion?: string) => {
    if (status !== 'solve' || !puzzle) return false;
    const c = new Chess(fen);
    const m = tryMove(c, from, to, promotion);
    if (!m) return false;
    const uci = m.from + m.to + (m.promotion ?? '');
    const fenBefore = fen;
    const lastBefore = lastMove;
    const res = checkPuzzleMove(puzzle, fenBefore, ply, uci);
    setFen(c.fen());
    setLastMove({ from: m.from, to: m.to });
    setArrows([]);
    soundForSan(m.san, c.isGameOver());
    const t = token.current;

    if (res === 'correct') {
      setMarks({ [m.to]: 'good' });
      setFeedback({ tone: 'good', title: '✓ Doğru! Devam et.', lines: [sentence(describeMoveObj(m, 'pastMine'))] });
      void playOpponent(puzzle, c.fen(), ply + 1, t);
      return true;
    }
    if (res === 'complete') {
      setMarks({ [m.to]: 'good' });
      setStatus('solved');
      record(puzzle, hintLevel > 0 ? 'assisted' : 'solved');
      const ex = explainSolution(puzzle);
      setFeedback({
        tone: 'good',
        title: hintLevel > 0 ? 'Çözüldü (ipucuyla).' : 'Harika, çözdün!',
        lines: ex.points,
        steps: ex.line,
      });
      playMoveSound('end');
      return true;
    }

    // Yanlış görünüyor: önce motorla kontrol et — eşit derecede iyi bir alternatif olabilir.
    setMarks({ [m.to]: 'danger' });
    setStatus('checking');
    setFeedback({ tone: 'info', title: 'Kontrol ediliyor…', lines: [] });
    void (async () => {
      let lines: string[] = [];
      let refuteArrow: BoardArrow | null = null;
      let goodAlternative = false;
      try {
        const before = await engine.analyze(fenBefore, COACH_OPTS);
        const after = c.isGameOver() ? null : await engine.analyze(c.fen(), AFTER_OPTS);
        if (t !== token.current) return;
        const rv = reviewMove(fenBefore, { from: m.from, to: m.to, promotion: m.promotion }, before, after);
        // Çözümle aynı kalitede (kazancı kaçırmayan) hamle → ceza yok, tekrar denesin.
        goodAlternative = (rv.cls === 'best' || rv.cls === 'excellent') && !(before.lines[0]?.score.type === 'mate');
        lines = rv.reasons.filter((r) => !/^(Bunun yerine|Daha iyisi|Mat vardı|Mat fırsatı|Motorun tercihi)/.test(r));
        if (rv.refutation) {
          refuteArrow = { from: rv.refutation.uci.slice(0, 2), to: rv.refutation.uci.slice(2, 4), color: 'red' };
          if (!lines.some((l) => l.includes(rv.refutation!.text))) lines.push(`Rakibin cevabı: ${rv.refutation.text}.`);
        }
      } catch {
        /* motor yoksa sade "yanlış" mesajı */
      }
      if (t !== token.current) return;
      if (goodAlternative) {
        setFen(fenBefore);
        setLastMove(lastBefore);
        setMarks({});
        setStatus('solve');
        setFeedback({
          tone: 'info',
          title: 'Fena değil, ama bulmacanın aradığı daha güçlü bir hamle var.',
          lines: ['Tekrar dene: zorlayıcı hamlelere (şah, alma, tehdit) bak.'],
        });
        return;
      }
      record(puzzle, 'failed');
      setStatus('wrong');
      setArrows(refuteArrow ? [refuteArrow] : []);
      setRollback({ fen: fenBefore, lastMove: lastBefore });
      setFeedback({
        tone: 'bad',
        title: '✗ Bu hamle doğru değil.',
        lines: [sentence(`Senin hamlen: ${describeMoveObj(m, 'pastMine')}`), ...(lines.length ? lines : ['Bu hamle bulmacadaki fırsatı kaçırıyor.'])],
      });
    })();
    return true;
  };

  const retry = () => {
    if (!rollback) return;
    setFen(rollback.fen);
    setLastMove(rollback.lastMove);
    setMarks({});
    setArrows([]);
    setFeedback(null);
    setStatus('solve');
  };

  const showSolution = async () => {
    if (!puzzle) return;
    const t = ++token.current;
    record(puzzle, 'failed');
    let cur = rollback?.fen ?? fen;
    if (status === 'wrong' && rollback) {
      setFen(rollback.fen);
      setLastMove(rollback.lastMove);
    }
    setStatus('shown');
    setMarks({});
    for (let i = ply; i < puzzle.moves.length; i++) {
      const u = puzzle.moves[i];
      setArrows([{ from: u.slice(0, 2), to: u.slice(2, 4), color: i % 2 === 1 ? 'blue' : 'red' }]);
      await sleep(700);
      if (t !== token.current) return;
      const c = new Chess(cur);
      const m = tryMove(c, u.slice(0, 2), u.slice(2, 4), u[4]);
      if (!m) break;
      cur = c.fen();
      setFen(cur);
      setLastMove({ from: m.from, to: m.to });
      soundForSan(m.san, c.isGameOver());
      await sleep(350);
    }
    setArrows([]);
    const ex = explainSolution(puzzle);
    setFeedback({ tone: 'info', title: 'Çözüm', lines: ex.points, steps: ex.line });
  };

  const hint = () => {
    if (!puzzle || status !== 'solve') return;
    setHintLevel(1);
    const u = puzzle.moves[ply];
    setArrows([{ from: u.slice(0, 2), to: u.slice(2, 4), color: 'green' }]);
    setMarks({});
    setFeedback({ tone: 'info', title: `👉 ${sentence(describeMove(fen, u, 'imp'))}`, lines: ['Yeşil ok hamleyi gösteriyor. Şimdi tahtada oyna.'] });
  };
  const select = (c: Choice) => {
    setChoice({ c });
    void start(c);
  };

  const weak = weakestThemes(prog);
  const solverName = orientation === 'w' ? 'Beyaz' : 'Siyah';
  const themeOfChoice = choice.c !== 'mixed' && choice.c !== 'review' ? THEME_BY_ID[choice.c] : null;

  return (
    <div className="layout">
      <div className="board-col" data-puzzle-id={puzzle?.id} data-status={status}>
        <div className="player-tag">
          <span className={`pc ${orientation}`} />
          <strong>
            {status === 'loading' ? 'Bulmacalar yükleniyor…' : status === 'opp' ? 'Rakip oynuyor…' : `${solverName} oynuyor: en iyi hamleyi bul`}
          </strong>
        </div>
        <Board
          fen={fen}
          orientation={orientation}
          movable={status === 'solve' ? orientation : 'none'}
          onMove={onMove}
          lastMove={lastMove}
          arrows={arrows}
          marks={marks}
        />
        <div className="toolbar">
          <button onClick={hint} disabled={status !== 'solve' || hintLevel > 0}>
            👉 Ne oynamalıyım?
          </button>
          {status === 'wrong' && (
            <button className="on" onClick={retry}>
              ↶ Tekrar dene
            </button>
          )}
          {(status === 'wrong' || status === 'solve') && puzzle && (
            <button onClick={showSolution}>Çözümü göster</button>
          )}
          {(status === 'solved' || status === 'shown' || status === 'wrong') && (
            <button className="primary small-primary" onClick={() => start()}>
              Sonraki bulmaca ▶
            </button>
          )}
        </div>
      </div>

      <aside className="side">
        {loadErr && <div className="alert">{loadErr}</div>}

        <section className="card tactics-stats">
          <div>
            <strong>{prog.rating}</strong>
            <small>taktik puanın</small>
            {delta !== null && delta !== 0 && <em className={delta > 0 ? 'up' : 'down'}>{delta > 0 ? `+${delta}` : delta}</em>}
          </div>
          <div>
            <strong>{prog.streak}</strong>
            <small>seri (en iyi {prog.bestStreak})</small>
          </div>
          <div>
            <strong>{prog.attempts}</strong>
            <small>bulmaca</small>
          </div>
        </section>

        {feedback && (
          <section className={`card feedback tone-${feedback.tone}`} aria-live="polite">
            <h3>{feedback.title}</h3>
            {feedback.lines.length > 0 && (
              <ul>
                {feedback.lines.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            )}
            {feedback.steps && feedback.steps.length > 0 && (
              <>
                <strong className="small">Çözüm adım adım:</strong>
                <ol className="small">
                  {feedback.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </>
            )}
            {puzzle && (status === 'solved' || status === 'shown' || status === 'wrong') && (
              <p className="muted small">
                Bulmaca puanı {puzzle.rating} ·{' '}
                <a href={puzzle.url} target="_blank" rel="noreferrer">
                  gerçek oyunu Lichess'te gör
                </a>
              </p>
            )}
          </section>
        )}

        {themeOfChoice && (
          <section className="card theme-info">
            <h3>{themeOfChoice.name}</h3>
            <p>{themeOfChoice.what}</p>
            <p className="muted small">
              <strong>Nasıl fark edilir?</strong> {themeOfChoice.spot}
            </p>
          </section>
        )}

        <section className="card">
          <h3>Tema seç</h3>
          <div className="theme-grid">
            <button className={choice.c === 'mixed' ? 'on' : ''} onClick={() => select('mixed')}>
              🎲 Karışık
            </button>
            {prog.failedIds.length > 0 && (
              <button className={`${choice.c === 'review' ? 'on' : ''} review`} onClick={() => select('review')}>
                ↻ Hatalarım ({prog.failedIds.length})
              </button>
            )}
            {THEMES.map((t) => {
              const s = prog.perTheme[t.id];
              const total = s ? s.ok + s.fail : 0;
              return (
                <button key={t.id} className={choice.c === t.id ? 'on' : ''} onClick={() => select(t.id)} title={t.what}>
                  <span>
                    {t.priority === 1 && <span className="star">★ </span>}
                    {t.name}
                  </span>
                  {total > 0 && <small>%{Math.round(((s?.ok ?? 0) / total) * 100)} · {total}</small>}
                </button>
              );
            })}
          </div>
          <p className="muted small">★ 400–900 seviyesinde en çok puan kazandıran temalar. Önce bunlarda ustalaş.</p>
        </section>

        {weak.length > 0 && (
          <section className="card">
            <h3>Çalışman gerekenler</h3>
            <ul>
              {weak.map((w) => (
                <li key={w.id}>
                  <button className="link" onClick={() => select(w.id)}>
                    {THEME_BY_ID[w.id].name}
                  </button>{' '}
                  — başarı %{Math.round(w.rate * 100)} ({w.total} bulmaca)
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="muted small">
          Bulmacalar Lichess bulmaca veritabanından (CC0) alınmış gerçek oyun pozisyonlarıdır
          {meta ? ` (veri: ${new Date(meta.sourceLastModified).toLocaleDateString('tr-TR')})` : ''}. İlerlemen yalnızca bu cihazda saklanır.
        </p>
      </aside>
    </div>
  );
}
