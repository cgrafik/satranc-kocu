import { useState, type ReactNode } from 'react';
import PlayMode from './modes/PlayMode';
import AnalysisMode from './modes/AnalysisMode';
import TacticsMode from './modes/TacticsMode';
import CounterMode from './modes/CounterMode';
import GamesMode from './modes/GamesMode';
import { loadLocal, saveLocal } from './lib/usePersistent';

type Mode = 'play' | 'tactics' | 'counter' | 'games' | 'analysis';

const MODES: { id: Mode; label: string; desc: string }[] = [
  { id: 'play', label: 'Maç', desc: 'Motora karşı oyna, her hamlende koçtan geri bildirim al.' },
  { id: 'tactics', label: 'Taktik', desc: 'Gerçek oyunlardan bulmacalarla çatal, açmaz, mat... çalış.' },
  { id: 'counter', label: 'Karşı Hamle', desc: 'Rakip şunu yaparsa ben ne yapmalıyım?' },
  { id: 'games', label: 'Oyunlarım', desc: 'chess.com oyunlarını analiz et, hatalarını tekrar çöz.' },
  { id: 'analysis', label: 'Analiz', desc: 'Konumu incele, motorun en iyi devamlarını gör.' },
];

export default function App() {
  const [mode, setMode] = useState<Mode>(() => {
    const m = loadLocal('sk.app', { mode: 'play' as Mode }).mode;
    return MODES.some((x) => x.id === m) ? m : 'play';
  });
  // Bir sekme ilk açıldığında yüklenir, sonra açık kalır: sekme değiştirince oyun/ilerleme sıfırlanmaz.
  const [tacticsRequest, setTacticsRequest] = useState<{ theme: string; n: number } | null>(null);
  const [visited, setVisited] = useState<Set<Mode>>(() => new Set([mode]));
  const choose = (m: Mode) => {
    setMode(m);
    setVisited((v) => (v.has(m) ? v : new Set(v).add(m)));
    saveLocal('sk.app', { mode: m });
    window.scrollTo({ top: 0 });
  };
  const pane = (id: Mode, el: ReactNode) =>
    visited.has(id) ? (
      <div hidden={mode !== id} key={id}>
        {el}
      </div>
    ) : null;

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          <span className="logo" aria-hidden>
            ♞
          </span>{' '}
          Satranç Koçu
        </h1>
        <nav className="tabs" aria-label="Modlar">
          {MODES.map((m) => (
            <button key={m.id} className={mode === m.id ? 'on' : ''} onClick={() => choose(m.id)} title={m.desc}>
              {m.label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {pane('play', <PlayMode active={mode === 'play'} />)}
        {pane('tactics', <TacticsMode request={tacticsRequest} />)}
        {pane('counter', <CounterMode active={mode === 'counter'} />)}
        {pane(
          'games',
          <GamesMode
            onPracticeTheme={(theme) => {
              setTacticsRequest((r) => ({ theme, n: (r?.n ?? 0) + 1 }));
              choose('tactics');
            }}
          />,
        )}
        {pane('analysis', <AnalysisMode active={mode === 'analysis'} />)}
      </main>
      <footer className="foot muted small">
        Analiz: <a href="https://stockfishchess.org" target="_blank" rel="noreferrer">Stockfish 19</a> (GPL-3.0,{' '}
        <a href={`${import.meta.env.BASE_URL}engine/STOCKFISH-LICENSE-GPL3.txt`} target="_blank" rel="noreferrer">
          lisans
        </a>
        , <a href="https://github.com/cgrafik/satranc-kocu" target="_blank" rel="noreferrer">kaynak kod</a>) · Kurallar: chess.js (BSD-2) ·
        Bulmacalar: Lichess (CC0) · Taş görselleri: react-chessboard (MIT). Motor tarayıcında çalışır; oyunların ve ayarların yalnızca bu
        cihazda saklanır, hiçbir yere gönderilmez.
      </footer>
    </div>
  );
}
