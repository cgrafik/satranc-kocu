import { useState } from 'react';
import type { Quiz, QuizOption } from '../lib/coach';
import { sentence } from '../lib/describe';
import { saveLocal } from '../lib/usePersistent';
import { getQuizStats, QUIZ_STATS_KEY } from '../lib/quiz';

const SWATCH: Record<QuizOption['color'], string> = { blue: '#2a6edc', orange: '#e68f00', purple: '#9646c8' };

/** Üç seçenekli tahmin sorusu. Seçince doğrusu ve nedeni gösterilir. */
export default function QuizCard({
  quiz,
  context,
  explain,
  onReveal,
  onPlay,
  onClose,
}: {
  quiz: Quiz;
  /** Üstte gösterilecek bağlam, ör. "Rakip atını f3'e getirirse:" */
  context?: string;
  /** Seçilen hamlenin neden zayıf olduğunu açıklar (motorla). */
  explain: (uci: string) => Promise<string[]>;
  /** Seçim yapılınca (tahtadaki okları güncellemek için). */
  onReveal: (picked: QuizOption) => void;
  onPlay?: (uci: string) => void;
  onClose?: () => void;
}) {
  const [picked, setPicked] = useState<QuizOption | null>(null);
  const [why, setWhy] = useState<string[] | null>(null);
  const [stats, setStats] = useState(getQuizStats);
  const best = quiz.options.find((o) => o.uci === quiz.bestUci) ?? quiz.options.find((o) => o.correct)!;

  const pick = (o: QuizOption) => {
    if (picked) return;
    setPicked(o);
    onReveal(o);
    const next = { right: stats.right + (o.correct ? 1 : 0), total: stats.total + 1 };
    setStats(next);
    saveLocal(QUIZ_STATS_KEY, next);
    explain(o.uci)
      .then(setWhy)
      .catch(() => setWhy([]));
  };

  return (
    <section className={`card quiz ${picked ? (picked.correct ? 'tone-good' : 'tone-bad') : ''}`} aria-live="polite">
      {context && <p className="advice-context">{context}</p>}
      <h3>🤔 Sence hangisi en iyi hamle?</h3>
      {!picked && <p className="muted small">Tahtadaki renkli oklar seçenekleri gösteriyor. Düşün, sonra seç.</p>}
      <div className="quiz-options">
        {quiz.options.map((o) => {
          const state = !picked ? '' : o.correct ? 'right' : o === picked ? 'wrong' : 'dim';
          return (
            <button key={o.uci} className={`quiz-opt ${state}`} onClick={() => pick(o)} disabled={Boolean(picked)}>
              <span className="quiz-letter" style={{ background: SWATCH[o.color] }}>
                {o.letter}
              </span>
              <span className="quiz-text">
                {o.text}
                {picked && <small className="quiz-quality">{o.quality}</small>}
              </span>
            </button>
          );
        })}
      </div>

      {picked && (
        <div className="quiz-result">
          <h3>{picked.correct ? '✓ Doğru! İyi gördün.' : `✗ En iyisi ${best.letter} seçeneğiydi.`}</h3>
          {!picked.correct && (
            <p>
              <span className="muted">Doğrusu:</span> <strong>{sentence(best.text)}</strong>
            </p>
          )}
          {why === null ? (
            <p className="muted small">Açıklama hazırlanıyor…</p>
          ) : (
            why.length > 0 && (
              <ul>
                {why.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )
          )}
          <div className="row">
            {onPlay && (
              <button className="primary small-primary" onClick={() => onPlay(best.uci)}>
                En iyi hamleyi oyna
              </button>
            )}
            {onClose && (
              <button className="secondary" onClick={onClose}>
                Kapat
              </button>
            )}
          </div>
        </div>
      )}
      <p className="muted small">
        Tahmin skorun: {stats.right}/{stats.total}
        {stats.total > 0 ? ` (%${Math.round((stats.right / stats.total) * 100)})` : ''}
      </p>
    </section>
  );
}
