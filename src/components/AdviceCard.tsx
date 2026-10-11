import type { Advice } from '../lib/coach';
import { sentence } from '../lib/describe';

/** "Ne oynamalıyım?" cevabı: tek, net cümle + neden + rakibin muhtemel cevabı. */
export default function AdviceCard({
  advice,
  title = 'Önerim',
  context,
  onPlay,
  onClose,
}: {
  advice: Advice;
  title?: string;
  /** Üstte gösterilecek bağlam, ör. "Rakip atını f3'e getirdi." */
  context?: string;
  onPlay?: (uci: string) => void;
  onClose?: () => void;
}) {
  return (
    <section className="card advice" aria-live="polite">
      {context && <p className="advice-context">{context}</p>}
      <h3>{title}:</h3>
      <p className="advice-main">👉 {advice.text}</p>
      <div className="coach-why">
        <strong>Neden?</strong>
        <ul>
          {advice.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </div>
      {advice.reply && (
        <p className="small">
          <span className="muted">Rakibin muhtemel cevabı:</span> {sentence(advice.reply)}
        </p>
      )}
      {advice.alternatives.length > 0 && (
        <details className="small">
          <summary>Başka seçenekler</summary>
          <ul>
            {advice.alternatives.map((a) => (
              <li key={a.uci}>
                {a.text} <span className="muted">({a.quality})</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="row">
        {onPlay && (
          <button className="primary small-primary" onClick={() => onPlay(advice.uci)}>
            Bu hamleyi oyna
          </button>
        )}
        {onClose && (
          <button className="secondary" onClick={onClose}>
            Kapat
          </button>
        )}
      </div>
      <p className="muted small">Yeşil ok tahtada önerilen hamleyi gösteriyor.</p>
    </section>
  );
}
