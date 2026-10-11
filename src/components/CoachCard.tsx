import { CLASS_INFO, type MoveReview } from '../lib/coach';

/** Bir hamlenin koç değerlendirmesi — notasyon yok, düz cümleler. */
export default function CoachCard({
  review,
  compare,
  onCompare,
  mine = true,
}: {
  review: MoveReview;
  compare: 'before' | 'after' | null;
  onCompare: (v: 'before' | 'after' | null) => void;
  mine?: boolean;
}) {
  const info = CLASS_INFO[review.cls];
  const bad = info.tone === 'bad' || info.tone === 'warn';
  const showBetter = review.best && !review.isBest && review.cls !== 'best' && review.cls !== 'excellent';
  const showRefutation = review.refutation && (review.cls === 'mistake' || review.cls === 'blunder' || review.cls === 'inaccuracy');
  return (
    <section className={`card coach tone-${info.tone}`} aria-live="polite">
      <header className="coach-head">
        <span className={`badge tone-${info.tone}`}>
          {info.short} {info.label}
        </span>
      </header>

      <p className="coach-played">
        <span className="muted">{mine ? 'Senin hamlen:' : 'Oynanan hamle:'}</span> {mine ? review.playedText : review.playedText.replace(/n$/, '')}
      </p>

      {showBetter && (
        <p className="coach-better">
          <span className="muted">Bunun yerine:</span> <strong>{review.best!.text}</strong>
        </p>
      )}

      <div className="coach-why">
        <strong>Neden?</strong>
        <ul>
          {review.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </div>

      {showRefutation && review.refutation!.steps.length > 1 && (
        <details className="coach-refute">
          <summary>Sonra ne olur? (adım adım)</summary>
          <ol>
            {review.refutation!.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </details>
      )}

      <div className="seg" role="group" aria-label="Tahtada göster">
        <button className={compare === 'before' ? 'on' : ''} onClick={() => onCompare(compare === 'before' ? null : 'before')}>
          {showBetter ? '🟩 Doğrusunu tahtada göster' : 'Hamleden önceki konum'}
        </button>
        <button className={compare === 'after' ? 'on' : ''} onClick={() => onCompare(compare === 'after' ? null : 'after')}>
          {bad && review.refutation ? '🟥 Rakibin cevabını göster' : 'Hamleden sonraki konum'}
        </button>
      </div>
      <p className="muted small">{review.evalText}</p>
    </section>
  );
}
