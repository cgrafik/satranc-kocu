import { CLASS_INFO, type MoveReview } from '../lib/coach';

/** Bir hamlenin koç değerlendirmesi: sınıf, alternatif, neden, rakibin cevabı, öncesi/sonrası karşılaştırma. */
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
  const showRefutation = review.refutation && (review.cls === 'mistake' || review.cls === 'blunder' || review.cls === 'inaccuracy');
  return (
    <section className={`card coach tone-${info.tone}`} aria-live="polite">
      <header className="coach-head">
        <span className={`badge tone-${info.tone}`}>
          {info.short} {info.label}
        </span>
        <span className="muted small">{review.evalText}</span>
      </header>

      <dl className="coach-grid">
        <dt>{mine ? 'Senin hamlen' : 'Oynanan hamle'}</dt>
        <dd className="san">{review.trSan}</dd>
        {review.best && !review.isBest && review.cls !== 'best' && (
          <>
            <dt>Daha iyi alternatif</dt>
            <dd className="san good">{review.best.trSan}</dd>
          </>
        )}
      </dl>

      <div className="coach-why">
        <strong>Neden?</strong>
        <ul>
          {review.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </div>

      {showRefutation && (
        <div className="coach-refute">
          <strong>Hata yaparsan ne olur?</strong>
          <p>
            Rakibin en güçlü cevabı: <span className="san bad">{review.refutation!.line[0]}</span>
            {review.refutation!.line.length > 1 && (
              <>
                {' '}
                → <span className="line">{review.refutation!.line.join(' ')}</span>
              </>
            )}
          </p>
        </div>
      )}

      <div className="seg" role="group" aria-label="Tahtada göster">
        <span className="muted small">Tahtada göster:</span>
        <button className={compare === 'before' ? 'on' : ''} onClick={() => onCompare(compare === 'before' ? null : 'before')}>
          Hamle öncesi{review.best && !review.isBest ? ' + daha iyisi' : ''}
        </button>
        <button className={compare === 'after' ? 'on' : ''} onClick={() => onCompare(compare === 'after' ? null : 'after')}>
          Hamle sonrası{bad && review.refutation ? ' + rakibin cevabı' : ''}
        </button>
      </div>
    </section>
  );
}
