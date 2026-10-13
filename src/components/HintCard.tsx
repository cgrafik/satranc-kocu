import type { TacticalHint } from '../lib/coach';

/** Sadece ipucu: hamleyi söylemez; istenirse gerçek cevap açılır. */
export default function HintCard({ hint, onReveal, onClose }: { hint: TacticalHint; onReveal?: () => void; onClose?: () => void }) {
  return (
    <section className="card hint" aria-live="polite">
      <h3>💡 İpucu</h3>
      <p className="advice-main">{hint.text}</p>
      {hint.detail && <p className="small">{hint.detail}</p>}
      <div className="row">
        {onReveal && hint.reveal && (
          <button className="secondary" onClick={onReveal}>
            Bulamadım, hamleyi göster
          </button>
        )}
        {onClose && (
          <button className="secondary" onClick={onClose}>
            Kapat
          </button>
        )}
      </div>
    </section>
  );
}
