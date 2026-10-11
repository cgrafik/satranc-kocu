// Oyunlarım: chess.com'daki BİTMİŞ oyunları getir, analiz et, en kritik hataları tekrar çöz.
import { useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import Board, { type Mark } from '../components/Board';
import CoachCard from '../components/CoachCard';
import MoveList from '../components/MoveList';
import { CLASS_INFO, TAG_INFO, reviewMove, type BoardArrow, type MistakeTag, type MoveClass, type MoveReview } from '../lib/coach';
import { describeMoveObj, sentence } from '../lib/describe';
import { analyzeGame, GAME_ANALYSIS_OPTS, topTags, type GameReport } from '../lib/gameReview';
import { fetchRecentGames, ImportError, parsePgn, TIME_CLASS_TR, type GameMeta, type ParsedGame } from '../lib/importer';
import { tryMove } from '../lib/game';
import { AFTER_OPTS, COACH_OPTS, useEngine } from '../lib/useEngine';
import { loadLocal, saveLocal, usePersistent } from '../lib/usePersistent';

const REPORTS_KEY = 'sk.games.reports';
const SOLVED_KEY = 'sk.games.solved';
const MAX_REPORTS = 12;

interface Selected {
  id: string;
  title: string;
  myColor: 'w' | 'b';
  parsed: ParsedGame;
  report: GameReport | null;
}

interface Practice {
  ply: number;
  status: 'solve' | 'checking' | 'right' | 'wrong' | 'shown';
  fen: string;
  lastMove: { from: string; to: string } | null;
  lines: string[];
  title: string;
  arrows: BoardArrow[];
}

export default function GamesMode({ onPracticeTheme }: { onPracticeTheme?: (theme: string) => void }) {
  const { engine, status } = useEngine();
  const [user, setUser] = usePersistent('sk.games.user', { name: '' });
  const [input, setInput] = useState(user.name);
  const [games, setGames] = useState<GameMeta[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, GameReport>>(() => loadLocal<{ r: Record<string, GameReport> }>(REPORTS_KEY, { r: {} }).r);
  const [solved, setSolved] = useState<string[]>(() => loadLocal<{ s: string[] }>(SOLVED_KEY, { s: [] }).s);
  const [sel, setSel] = useState<Selected | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [cursor, setCursor] = useState<number | null>(null); // görüntülenen hamle (ply)
  const [compare, setCompare] = useState<'before' | 'after' | null>(null);
  const [practice, setPractice] = useState<Practice | null>(null);
  const [pgnText, setPgnText] = useState('');
  const [pgnColor, setPgnColor] = useState<'w' | 'b'>('w');
  const token = useRef(0);

  const persistReports = (r: Record<string, GameReport>) => {
    // En yeni MAX_REPORTS raporu sakla
    const entries = Object.entries(r).sort((a, b) => b[1].analyzedAt.localeCompare(a[1].analyzedAt)).slice(0, MAX_REPORTS);
    const trimmed = Object.fromEntries(entries);
    setReports(trimmed);
    saveLocal(REPORTS_KEY, { r: trimmed });
  };

  const loadGames = async (name = input) => {
    setErr(null);
    setLoading(true);
    try {
      const list = await fetchRecentGames(name, 20);
      setGames(list);
      setUser({ name: name.trim() });
      if (list.length === 0) setErr('Son 3 ayda standart satranç oyunu bulunamadı.');
    } catch (e) {
      setErr(e instanceof ImportError ? e.message : `Oyunlar alınamadı: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  // Kullanıcı adı kayıtlıysa listeyi otomatik getir
  useEffect(() => {
    if (user.name && !games) void loadGames(user.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = async (id: string, title: string, pgn: string, myColor: 'w' | 'b') => {
    let parsed: ParsedGame;
    try {
      parsed = parsePgn(pgn);
    } catch (e) {
      setErr((e as Error).message);
      return;
    }
    setErr(null);
    setPractice(null);
    setCompare(null);
    setCursor(null);
    const existing = reports[id] ?? null;
    setSel({ id, title, myColor, parsed, report: existing });
    window.scrollTo({ top: 0 });
    if (existing) return;
    const t = ++token.current;
    setProgress({ done: 0, total: 1 });
    try {
      const report = await analyzeGame(parsed, myColor, (fen) => engine.analyze(fen, GAME_ANALYSIS_OPTS), {
        id,
        onProgress: (done, total) => t === token.current && setProgress({ done, total }),
        isCancelled: () => t !== token.current,
      });
      if (!report || t !== token.current) return;
      setSel((s) => (s && s.id === id ? { ...s, report } : s));
      persistReports({ ...reports, [id]: report });
    } catch (e) {
      if (t === token.current) setErr(`Analiz yapılamadı: ${(e as Error).message}`);
    } finally {
      if (t === token.current) setProgress(null);
    }
  };

  const cancel = () => {
    token.current++;
    setProgress(null);
    setSel(null);
  };

  const reviewAt = (ply: number): MoveReview | undefined => sel?.report?.reviews.find((r) => r.ply === ply);

  const startPractice = (ply: number) => {
    const r = reviewAt(ply);
    if (!r || !sel) return;
    setCompare(null);
    setCursor(null);
    setPractice({
      ply,
      status: 'solve',
      fen: r.fenBefore,
      lastMove: ply > 0 ? { from: sel.parsed.moves[ply - 1].from, to: sel.parsed.moves[ply - 1].to } : null,
      title: 'Bu konumda daha iyi bir hamle bul.',
      lines: [`Oyunda şunu yapmıştın: ${sentence(r.playedText)}`],
      arrows: [],
    });
  };

  const onPracticeMove = (from: string, to: string, promotion?: string) => {
    if (!practice || practice.status !== 'solve' || !sel) return false;
    const c = new Chess(practice.fen);
    const m = tryMove(c, from, to, promotion);
    if (!m) return false;
    const fenBefore = practice.fen;
    setPractice({ ...practice, status: 'checking', fen: c.fen(), lastMove: { from: m.from, to: m.to }, title: 'Kontrol ediliyor…', lines: [] });
    void (async () => {
      try {
        const before = await engine.analyze(fenBefore, COACH_OPTS);
        const after = c.isGameOver() ? null : await engine.analyze(c.fen(), AFTER_OPTS);
        const r = reviewMove(fenBefore, { from: m.from, to: m.to, promotion: m.promotion }, before, after);
        const good = r.cls === 'best' || r.cls === 'excellent' || r.cls === 'good';
        if (good) {
          const key = `${sel.id}#${practice.ply}`;
          if (!solved.includes(key)) {
            const s = [...solved, key];
            setSolved(s);
            saveLocal(SOLVED_KEY, { s });
          }
          setPractice((p) => p && { ...p, status: 'right', title: '✓ Doğru! Bu sefer buldun.', lines: [sentence(describeMoveObj(m, 'pastMine')), ...r.reasons], arrows: [] });
        } else {
          setPractice(
            (p) =>
              p && {
                ...p,
                status: 'wrong',
                title: '✗ Bu da zayıf kalıyor.',
                lines: r.reasons.filter((x) => !/^(Bunun yerine|Daha iyisi|Motorun tercihi)/.test(x)),
                arrows: r.refutation ? [{ from: r.refutation.uci.slice(0, 2), to: r.refutation.uci.slice(2, 4), color: 'red' }] : [],
              },
          );
        }
      } catch (e) {
        setPractice((p) => p && { ...p, status: 'wrong', title: 'Motor kontrol edemedi.', lines: [(e as Error).message] });
      }
    })();
    return true;
  };

  const retryPractice = () => {
    if (!practice) return;
    const r = reviewAt(practice.ply)!;
    setPractice({ ...practice, status: 'solve', fen: r.fenBefore, lastMove: practice.ply > 0 && sel ? sel.parsed.moves[practice.ply - 1] : null, title: 'Tekrar dene.', lines: [], arrows: [] });
  };

  const showPracticeSolution = () => {
    if (!practice) return;
    const r = reviewAt(practice.ply)!;
    setPractice({
      ...practice,
      status: 'shown',
      fen: r.fenBefore,
      lastMove: practice.ply > 0 && sel ? sel.parsed.moves[practice.ply - 1] : null,
      title: r.best ? `Doğrusu: ${sentence(r.best.text)}` : 'Çözüm',
      lines: r.reasons,
      arrows: r.beforeArrows,
    });
  };

  // Tüm raporlardaki çözülmemiş kritik anlar
  const pending = Object.values(reports).flatMap((rep) => rep.critical.filter((ply) => !solved.includes(`${rep.id}#${ply}`)).map((ply) => ({ rep, ply })));
  const worst = topTags(Object.values(reports));

  // --- Tahta ---
  let boardFen = new Chess().fen();
  let lastMove: { from: string; to: string } | null = null;
  let arrows: BoardArrow[] = [];
  const marks: Record<string, Mark> = {};
  let movable: 'w' | 'b' | 'none' = 'none';
  if (sel) {
    const fens = [sel.parsed.startFen, ...sel.parsed.moves.map((m) => m.fenAfter)];
    const ply = cursor ?? sel.parsed.moves.length - 1;
    boardFen = fens[ply + 1];
    lastMove = sel.parsed.moves[ply] ?? null;
    const r = reviewAt(ply);
    if (compare && r) {
      boardFen = compare === 'before' ? r.fenBefore : r.fenAfter;
      arrows = compare === 'before' ? r.beforeArrows : r.afterArrows;
      lastMove = compare === 'before' ? (sel.parsed.moves[ply - 1] ?? null) : sel.parsed.moves[ply];
      if (compare === 'after') for (const s of r.dangerSquares) marks[s] = 'danger';
    }
  }
  if (practice) {
    boardFen = practice.fen;
    lastMove = practice.lastMove;
    arrows = practice.arrows;
    movable = practice.status === 'solve' && sel ? sel.myColor : 'none';
  }

  const rep = sel?.report;
  const selectedReview = cursor !== null ? reviewAt(cursor) : undefined;

  return (
    <div className="layout">
      <div className="board-col">
        {sel && <p className="counter-prompt mine">{sel.title}</p>}
        <Board
          fen={boardFen}
          orientation={sel?.myColor ?? 'w'}
          movable={movable}
          onMove={onPracticeMove}
          lastMove={lastMove}
          arrows={arrows}
          marks={marks}
        />
        {sel && !practice && (
          <div className="toolbar">
            <button onClick={() => { setCompare(null); setCursor((c) => Math.max(-1, (c ?? sel.parsed.moves.length - 1) - 1)); }}>◀</button>
            <button onClick={() => { setCompare(null); setCursor((c) => (c === null || c + 1 >= sel.parsed.moves.length - 1 ? null : c + 1)); }}>▶</button>
            <button onClick={() => { setSel(null); setPractice(null); }}>← Oyun listesi</button>
          </div>
        )}
        {practice && (
          <div className="toolbar">
            {practice.status === 'wrong' && (
              <button className="on" onClick={retryPractice}>
                ↶ Tekrar dene
              </button>
            )}
            {(practice.status === 'solve' || practice.status === 'wrong') && <button onClick={showPracticeSolution}>Çözümü göster</button>}
            <button onClick={() => setPractice(null)}>← Rapora dön</button>
          </div>
        )}
      </div>

      <aside className="side">
        {status === 'error' && <div className="alert">Motor kullanılamıyor; oyunlar analiz edilemez.</div>}
        {err && <div className="alert">{err}</div>}

        {practice && (
          <section className={`card feedback tone-${practice.status === 'right' ? 'good' : practice.status === 'wrong' ? 'bad' : 'info'}`} aria-live="polite">
            <h3>{practice.title}</h3>
            {practice.lines.length > 0 && (
              <ul>
                {practice.lines.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            )}
            {(practice.status === 'right' || practice.status === 'shown') && rep && (
              <div className="row">
                {rep.critical.filter((p) => p !== practice.ply && !solved.includes(`${rep.id}#${p}`)).slice(0, 1).map((p) => (
                  <button key={p} className="primary small-primary" onClick={() => startPractice(p)}>
                    Sıradaki hatam ▶
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {!sel && (
          <>
            <section className="card">
              <h2>Oyunlarım</h2>
              <p className="small">
                chess.com kullanıcı adını yaz; <strong>bitmiş</strong> oyunların gelsin. Koç her oyunda en kritik hatalarını bulur, sonra o konumları
                sana tekrar çözdürür.
              </p>
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void loadGames();
                }}
              >
                <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="chess.com kullanıcı adın" aria-label="chess.com kullanıcı adı" autoCapitalize="none" autoCorrect="off" />
                <button type="submit" className="on" disabled={loading || !input.trim()}>
                  {loading ? 'Getiriliyor…' : 'Oyunlarımı getir'}
                </button>
              </form>
              <details className="small">
                <summary>Ya da PGN yapıştır (lichess vb.)</summary>
                <textarea value={pgnText} onChange={(e) => setPgnText(e.target.value)} rows={5} placeholder="[Event ...] 1. e4 e5 ..." aria-label="PGN" />
                <div className="row">
                  <span>Ben:</span>
                  <div className="seg">
                    {(['w', 'b'] as const).map((c) => (
                      <button key={c} className={pgnColor === c ? 'on' : ''} onClick={() => setPgnColor(c)} type="button">
                        {c === 'w' ? 'Beyaz' : 'Siyah'}
                      </button>
                    ))}
                  </div>
                  <button
                    disabled={!pgnText.trim()}
                    onClick={() => open(`pgn-${hash(pgnText)}`, 'Yapıştırılan oyun', pgnText, pgnColor)}
                  >
                    Analiz et
                  </button>
                </div>
              </details>
              <p className="muted small">Analiz bu cihazda yapılır. Yalnızca chess.com'un herkese açık oyun arşivi okunur; hiçbir şey gönderilmez.</p>
            </section>

            {worst.length > 0 && (
              <section className="card">
                <h3>📊 Son {Object.keys(reports).length} oyununda en sık hataların</h3>
                <ul className="tag-list">
                  {worst.map((w) => (
                    <li key={w.tag}>
                      <strong>
                        {TAG_INFO[w.tag].label} ({w.count})
                      </strong>
                      <br />
                      <span className="small">{TAG_INFO[w.tag].tip}</span>
                      {onPracticeTheme && (
                        <>
                          {' '}
                          <button className="link" onClick={() => onPracticeTheme(TAG_INFO[w.tag].theme)}>
                            Bu konuda bulmaca çöz →
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                {pending.length > 0 && (
                  <button
                    className="primary small-primary"
                    onClick={async () => {
                      const { rep: r, ply } = pending[0];
                      await openReport(r.id);
                      startPracticeFor(r, ply);
                    }}
                  >
                    Hatalarımı tekrar çöz ({pending.length})
                  </button>
                )}
              </section>
            )}

            {games && (
              <section className="card">
                <h3>Son oyunların</h3>
                <ul className="game-list">
                  {games.map((g) => {
                    const r = reports[g.url];
                    return (
                      <li key={g.url}>
                        <span className={`res res-${g.myResult}`} aria-label={{ win: 'Kazandın', loss: 'Kaybettin', draw: 'Berabere' }[g.myResult]}>
                          {{ win: 'G', loss: 'M', draw: '½' }[g.myResult]}
                        </span>
                        <div className="game-info">
                          <strong>
                            {g.opponent.username} ({g.opponent.rating})
                          </strong>
                          <small className="muted">
                            {g.myColor === 'w' ? 'Beyaz' : 'Siyah'} · {TIME_CLASS_TR[g.timeClass] ?? g.timeClass} ·{' '}
                            {new Date(g.endTime * 1000).toLocaleDateString('tr-TR')}
                            {r && r.accuracy !== null ? ` · doğruluk %${r.accuracy}` : ''}
                          </small>
                        </div>
                        <button
                          className={r ? '' : 'on'}
                          onClick={() => open(g.url, `${g.myColor === 'w' ? 'Beyaz' : 'Siyah'} · ${g.opponent.username} (${g.opponent.rating}) · ${{ win: 'Kazandın', loss: 'Kaybettin', draw: 'Berabere' }[g.myResult]}`, g.pgn, g.myColor)}
                        >
                          {r ? 'Rapor' : 'Analiz et'}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </>
        )}

        {sel && progress && (
          <section className="card">
            <h3>Oyunun analiz ediliyor…</h3>
            <div className="progress">
              <span style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
            </div>
            <p className="muted small">
              {progress.done}/{progress.total} konum · telefonda 20–60 saniye sürebilir.
            </p>
            <button onClick={cancel}>Vazgeç</button>
          </section>
        )}

        {sel && rep && !practice && (
          <>
            <section className="card result">
              <h3>Oyun raporu</h3>
              <div className="stats">
                {rep.accuracy !== null && (
                  <div>
                    <strong>%{rep.accuracy}</strong>
                    <small>doğruluk</small>
                  </div>
                )}
                {(['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder', 'missed'] as MoveClass[]).map((c) =>
                  rep.counts[c] ? (
                    <div key={c}>
                      <strong className={`tone-${CLASS_INFO[c].tone}`}>{rep.counts[c]}</strong>
                      <small>{CLASS_INFO[c].label}</small>
                    </div>
                  ) : null,
                )}
              </div>
              {Object.keys(rep.tags).length > 0 && (
                <ul className="small">
                  {(Object.entries(rep.tags) as [MistakeTag, number][]).map(([t, n]) => (
                    <li key={t}>
                      {TAG_INFO[t].label}: {n} kez
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {rep.critical.length > 0 ? (
              <section className="card">
                <h3>🔥 En kritik anların</h3>
                <ol className="critical-list">
                  {rep.critical.map((ply) => {
                    const r = reviewAt(ply)!;
                    const done = solved.includes(`${rep.id}#${ply}`);
                    return (
                      <li key={ply}>
                        <div>
                          <strong>{Math.floor(ply / 2) + 1}. hamle</strong> <span className={`badge tone-${CLASS_INFO[r.cls].tone}`}>{CLASS_INFO[r.cls].label}</span>
                          {done && <span className="muted small"> ✓ çözüldü</span>}
                        </div>
                        <div className="small">
                          <span className="muted">Oynadığın:</span> {sentence(r.playedText)}
                        </div>
                        {r.reasons[0] && <div className="small">{r.reasons[0]}</div>}
                        <div className="row">
                          <button className="on" onClick={() => startPractice(ply)}>
                            🎯 Bu konumu çöz
                          </button>
                          <button onClick={() => { setCursor(ply); setCompare('before'); }}>Tahtada gör</button>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ) : (
              <section className="card">
                <h3>Bu oyunda büyük hata yok 👏</h3>
                <p className="small">Koç ciddi bir hata ya da kaçan fırsat bulmadı.</p>
              </section>
            )}

            {selectedReview && (
              <CoachCard review={selectedReview} compare={compare} onCompare={setCompare} />
            )}

            <section className="card">
              <MoveList
                moves={sel.parsed.moves.map((m, i) => ({ san: m.san, title: describeMoveObj(new Chess(m.fenBefore).move({ from: m.from, to: m.to, promotion: m.uci[4] }), m.color === sel.myColor ? 'pastMine' : 'oppPast'), cls: reviewAt(i)?.cls }))}
                startsWithBlack={sel.parsed.moves[0]?.color === 'b'}
                current={cursor ?? sel.parsed.moves.length - 1}
                onSelect={(i) => {
                  setCompare(null);
                  setCursor(i);
                }}
              />
            </section>
          </>
        )}
      </aside>
    </div>
  );

  // Raporu açar (liste görünümünden "hatalarımı tekrar çöz" için)
  async function openReport(id: string) {
    const g = games?.find((x) => x.url === id);
    if (g) await open(g.url, `${g.myColor === 'w' ? 'Beyaz' : 'Siyah'} · ${g.opponent.username}`, g.pgn, g.myColor);
  }

  function startPracticeFor(r: GameReport, ply: number) {
    const rv = r.reviews.find((x) => x.ply === ply);
    if (!rv) return;
    setSel((s) => s ?? { id: r.id, title: 'Hatalarını tekrar çöz', myColor: r.myColor, parsed: pseudoParsed(r), report: r });
    setPractice({
      ply,
      status: 'solve',
      fen: rv.fenBefore,
      lastMove: null,
      title: 'Bu konumda daha iyi bir hamle bul.',
      lines: [`Oyunda şunu yapmıştın: ${sentence(rv.playedText)}`],
      arrows: [],
    });
  }
}

/** Oyun listesi yüklü değilken rapordan gezinilebilir bir oyun iskeleti kurar. */
function pseudoParsed(r: GameReport): ParsedGame {
  const moves = r.sans.map((san, i) => {
    const c = new Chess(r.fens[i]);
    const m = c.move(san);
    return { uci: m.from + m.to + (m.promotion ?? ''), san, from: m.from, to: m.to, fenBefore: r.fens[i], fenAfter: c.fen(), color: m.color };
  });
  return { headers: {}, startFen: r.fens[0], moves };
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
