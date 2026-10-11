import { useState } from 'react';
import PlayMode from './modes/PlayMode';
import AnalysisMode from './modes/AnalysisMode';
import { loadLocal, saveLocal } from './lib/usePersistent';

type Mode = 'play' | 'analysis';

const MODES: { id: Mode; label: string; desc: string }[] = [
  { id: 'play', label: 'Eğitmenle Maç', desc: 'Motora karşı oyna, her hamlende koçtan geri bildirim al.' },
  { id: 'analysis', label: 'Serbest Analiz', desc: 'Konumu incele, motorun en iyi devamlarını gör.' },
];

export default function App() {
  const [mode, setMode] = useState<Mode>(() => loadLocal('sk.app', { mode: 'play' as Mode }).mode);
  const choose = (m: Mode) => {
    setMode(m);
    saveLocal('sk.app', { mode: m });
  };
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
      <main>{mode === 'play' ? <PlayMode /> : <AnalysisMode />}</main>
      <footer className="foot muted small">
        Analiz: <a href="https://stockfishchess.org" target="_blank" rel="noreferrer">Stockfish 19</a> (GPL-3.0,{' '}
        <a href={`${import.meta.env.BASE_URL}engine/STOCKFISH-LICENSE-GPL3.txt`} target="_blank" rel="noreferrer">
          lisans
        </a>
        ) · Kurallar: chess.js (BSD-2) · Taş görselleri: react-chessboard (MIT). Motor tarayıcında çalışır; oyunların ve ayarların
        yalnızca bu cihazda saklanır, hiçbir yere gönderilmez.
      </footer>
    </div>
  );
}
