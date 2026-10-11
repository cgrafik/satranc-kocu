// Serbest analiz: iki tarafı da oynat, motoru aç/kapat, en iyi 3 devamı ve kazanma ihtimalini gör.
import { useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import Board from '../components/Board';
import EvalBar from '../components/EvalBar';
import EvalGraph from '../components/EvalGraph';
import MoveList from '../components/MoveList';
import CoachCard from '../components/CoachCard';
import { reviewMove, type BoardArrow, type MoveReview } from '../lib/coach';
import type { Analysis } from '../lib/engine';
import { describeScore, formatScore, scoreFor } from '../lib/evaluation';
import { tryMove, gameResult } from '../lib/game';
import { toTurkishSan } from '../lib/tactics';
import { AFTER_OPTS, COACH_OPTS, useEngine } from '../lib/useEngine';
import { usePersistent } from '../lib/usePersistent';

const START = new Chess().fen();

interface AMove {
  uci: string;
  trSan: string;
  fen: string;
  from: string;
  to: string;
  review?: MoveReview;
}

function lineSans(fen: string, pv: string[], max = 8) {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const u of pv.slice(0, max)) {
    try {
      const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      out.push(toTurkishSan(m.san));
    } catch {
      break;
    }
  }
  return out;
}

export default function AnalysisMode() {
  const { engine, status, error } = useEngine();
  const [opts, setOpts] = usePersistent('sk.analysis', { engineOn: true, hideLines: false, coach: true });
  const [startFen, setStartFen] = useState(START);
  const [moves, setMoves] = useState<AMove[]>([]);
  const [cursor, setCursor] = useState(-1);
  const [orientation, setOrientation] = useState<'w' | 'b'>('w');
  const [rawAnalysis, setAnalysis] = useState<Analysis | null>(null);
  // İpucu modunda hangi konum için cevabın açıldığı
  const [revealedFen, setRevealedFen] = useState<string | null>(null);
  const [compare, setCompare] = useState<'before' | 'after' | null>(null);
  const [fenInput, setFenInput] = useState('');
  const [fenError, setFenError] = useState<string | null>(null);
  const [engineErr, setEngineErr] = useState<string | null>(null);
  const movesRef = useRef(moves);
  useEffect(() => {
    movesRef.current = moves;
  }, [moves]);

  const fen = cursor < 0 ? startFen : moves[cursor].fen;
  const turn = new Chess(fen).turn();
  // Analiz yalnızca ait olduğu konumda gösterilir
  const analysis = opts.engineOn && rawAnalysis?.fen === fen ? rawAnalysis : null;
  const revealed = revealedFen === fen;

  // Konum değişince analiz et
  useEffect(() => {
    if (!opts.engineOn || gameResult(new Chess(fen)).over) return;
    let alive = true;
    engine
      .analyze(fen, { depth: 16, multipv: 3, movetime: 3000, timeoutMs: 8000, tag: 'live' })
      .then((a) => {
        if (alive) {
          setAnalysis(a);
          setEngineErr(null);
        }
      })
      .catch((e: Error) => {
        if (alive && e.message !== 'İptal edildi') setEngineErr(e.message);
      });
    return () => {
      alive = false;
    };
  }, [fen, opts.engineOn, engine]);

  const reviewInBackground = async (idx: number, fenBefore: string, m: AMove) => {
    try {
      const before = await engine.analyze(fenBefore, COACH_OPTS);
      const c = new Chess(m.fen);
      const after = c.isGameOver() ? null : await engine.analyze(m.fen, AFTER_OPTS);
      const rv = reviewMove(fenBefore, { from: m.from, to: m.to, promotion: m.uci[4] }, before, after, idx);
      setMoves((ms) => ms.map((x, i) => (i === idx && x.uci === m.uci && x.fen === m.fen ? { ...x, review: rv } : x)));
    } catch {
      /* iptal edildi ya da motor yok */
    }
  };

  const onMove = (from: string, to: string, promotion?: string) => {
    const c = new Chess(fen);
    const m = tryMove(c, from, to, promotion);
    if (!m) return false;
    const am: AMove = { uci: m.from + m.to + (m.promotion ?? ''), trSan: toTurkishSan(m.san), fen: c.fen(), from: m.from, to: m.to };
    // Aynı hamle zaten sıradaysa sadece ilerle
    if (moves[cursor + 1]?.uci === am.uci) {
      setCursor(cursor + 1);
      return true;
    }
    const next = [...moves.slice(0, cursor + 1), am];
    setMoves(next);
    setCursor(next.length - 1);
    setCompare(null);
    if (opts.engineOn && opts.coach) void reviewInBackground(next.length - 1, fen, am);
    return true;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') setCursor((c) => Math.max(-1, c - 1));
      if (e.key === 'ArrowRight') setCursor((c) => Math.min(movesRef.current.length - 1, c + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const loadFen = () => {
    const f = fenInput.trim();
    try {
      new Chess(f);
      setStartFen(f);
      setMoves([]);
      setCursor(-1);
      setFenError(null);
      setOrientation(new Chess(f).turn());
    } catch (e) {
      setFenError(`Geçersiz FEN: ${(e as Error).message}`);
    }
  };

  const best = analysis?.lines[0];
  const whiteScore = best ? scoreFor(best.score, turn, 'w') : null;
  const showLines = opts.engineOn && (!opts.hideLines || revealed);
  const review = cursor >= 0 ? moves[cursor].review : undefined;

  let boardFen = fen;
  let arrows: BoardArrow[] = showLines && best ? [{ from: best.pv[0].slice(0, 2), to: best.pv[0].slice(2, 4), color: 'blue' }] : [];
  let lastMove = cursor >= 0 ? moves[cursor] : null;
  const marks: Record<string, 'danger'> = {};
  if (compare && review) {
    boardFen = compare === 'before' ? review.fenBefore : review.fenAfter;
    arrows = compare === 'before' ? review.beforeArrows : review.afterArrows;
    lastMove = compare === 'before' ? (cursor > 0 ? moves[cursor - 1] : null) : moves[cursor];
    if (compare === 'after') for (const s of review.dangerSquares) marks[s] = 'danger';
  }
  const res = gameResult(new Chess(fen));

  // WDL: hamle sırasındaki taraf bakışından → beyaz bakışına
  const wdl = best?.wdl ? (turn === 'w' ? best.wdl : [best.wdl[2], best.wdl[1], best.wdl[0]]) : null;

  return (
    <div className="layout">
      <div className="board-col">
        <div className="board-wrap">
          {opts.engineOn && <EvalBar score={whiteScore} orientation={orientation} hidden={!showLines} />}
          <Board
            fen={boardFen}
            orientation={orientation}
            movable={compare ? 'none' : 'both'}
            onMove={onMove}
            lastMove={lastMove}
            arrows={arrows}
            marks={marks}
          />
        </div>
        {compare && (
          <div className="viewing">
            {compare === 'before' ? 'Hamle öncesi (yeşil ok: daha iyi hamle).' : 'Hamle sonrası (kırmızı ok: en güçlü cevap).'}
            <button className="link" onClick={() => setCompare(null)}>
              Kapat
            </button>
          </div>
        )}
        <div className="toolbar">
          <button onClick={() => setOrientation((o) => (o === 'w' ? 'b' : 'w'))}>⇅ Çevir</button>
          <button onClick={() => setCursor(-1)} disabled={cursor < 0} title="Başa">
            ⏮
          </button>
          <button onClick={() => setCursor((c) => Math.max(-1, c - 1))} disabled={cursor < 0} title="Geri (←)">
            ◀
          </button>
          <button onClick={() => setCursor((c) => Math.min(moves.length - 1, c + 1))} disabled={cursor >= moves.length - 1} title="İleri (→)">
            ▶
          </button>
          <button onClick={() => setCursor(moves.length - 1)} disabled={cursor >= moves.length - 1} title="Sona">
            ⏭
          </button>
          <button
            onClick={() => {
              setStartFen(START);
              setMoves([]);
              setCursor(-1);
              setCompare(null);
            }}
          >
            ⟲ Sıfırla
          </button>
        </div>
      </div>

      <aside className="side">
        {status === 'error' && <div className="alert">Motor kullanılamıyor: {error}</div>}
        {engineErr && <div className="alert">{engineErr}</div>}

        <section className="card">
          <div className="row">
            <label className="check inline">
              <input type="checkbox" checked={opts.engineOn} onChange={(e) => setOpts({ ...opts, engineOn: e.target.checked })} />
              <span>Motor analizi</span>
            </label>
            <label className="check inline">
              <input type="checkbox" checked={opts.hideLines} onChange={(e) => setOpts({ ...opts, hideLines: e.target.checked })} />
              <span>İpucu modu (cevabı hemen gösterme)</span>
            </label>
            <label className="check inline">
              <input type="checkbox" checked={opts.coach} onChange={(e) => setOpts({ ...opts, coach: e.target.checked })} />
              <span>Hamleleri değerlendir</span>
            </label>
          </div>

          {res.over && <p className="info">Oyun bitti: {res.reason}</p>}

          {opts.engineOn && !res.over && (
            <>
              {!analysis && <p className="muted">Analiz ediliyor…</p>}
              {analysis && opts.hideLines && !revealed && (
                <button className="secondary" onClick={() => setRevealedFen(fen)}>
                  Motorun önerisini göster
                </button>
              )}
              {analysis && showLines && (
                <>
                  <p>
                    <strong>{whiteScore && formatScore(whiteScore)}</strong> — {whiteScore && describeScore(whiteScore)}{' '}
                    <span className="muted small">(derinlik {analysis.depth})</span>
                  </p>
                  {wdl && (
                    <div className="wdl" title="Motorun tahmini; insan oyununda kesin sonuç değildir">
                      <div className="wdl-bar">
                        <span className="w" style={{ width: `${wdl[0] / 10}%` }} />
                        <span className="d" style={{ width: `${wdl[1] / 10}%` }} />
                        <span className="l" style={{ width: `${wdl[2] / 10}%` }} />
                      </div>
                      <small>
                        Beyaz kazanır %{Math.round(wdl[0] / 10)} · Berabere %{Math.round(wdl[1] / 10)} · Siyah kazanır %
                        {Math.round(wdl[2] / 10)}
                      </small>
                      <small className="muted">
                        Bu yüzdeler motorun kendi oyununa göre tahmindir; insan oyununda rakibin seviyesi, süre ve hata payı sonucu çok
                        değiştirir.
                      </small>
                    </div>
                  )}
                  <ol className="pvlines">
                    {analysis.lines.map((l) => {
                      const ws = scoreFor(l.score, turn, 'w');
                      return (
                        <li key={l.multipv}>
                          <span className="pv-score">{formatScore(ws)}</span>
                          <span className="line">{lineSans(fen, l.pv).join(' ')}</span>
                        </li>
                      );
                    })}
                  </ol>
                </>
              )}
            </>
          )}
        </section>

        {review && (
          <CoachCard
            review={review}
            compare={compare}
            onCompare={setCompare}
            mine={false}
          />
        )}

        <section className="card">
          <MoveList
            moves={moves.map((m) => ({ trSan: m.trSan, cls: m.review?.cls }))}
            startsWithBlack={new Chess(startFen).turn() === 'b'}
            firstMoveNumber={Number(startFen.split(' ')[5] ?? 1)}
            current={cursor >= 0 ? cursor : null}
            onSelect={(i) => {
              setCompare(null);
              setCursor(i);
            }}
          />
          {moves.some((m) => m.review) && (
            <EvalGraph
              points={moves.map((m) => ({ score: m.review?.whiteScoreAfter ?? null, cls: m.review?.cls }))}
              current={cursor >= 0 ? cursor : null}
              onSelect={setCursor}
            />
          )}
        </section>

        <section className="card">
          <div className="field">
            <label htmlFor="fen-input">FEN ile konum yükle</label>
            <div className="row">
              <input id="fen-input" value={fenInput} onChange={(e) => setFenInput(e.target.value)} placeholder="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" />
              <button onClick={loadFen}>Yükle</button>
            </div>
          </div>
          {fenError && <p className="alert">{fenError}</p>}
          <p className="muted small">Mevcut FEN: <code className="fen">{fen}</code></p>
        </section>
      </aside>
    </div>
  );
}
