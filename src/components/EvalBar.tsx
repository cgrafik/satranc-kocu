import type { Score } from '../lib/uci';
import { formatScore, winPercent } from '../lib/evaluation';

/** Dikey değerlendirme çubuğu. Skor BEYAZ bakışındandır. */
export default function EvalBar({ score, orientation, hidden }: { score: Score | null; orientation: 'w' | 'b'; hidden?: boolean }) {
  const white = hidden || !score ? 50 : winPercent(score);
  const label = hidden || !score ? '' : formatScore(score).replace('+', '');
  const whiteAhead = (score && (score.type === 'mate' ? score.value > 0 : score.value >= 0)) ?? true;
  return (
    <div
      className={`evalbar ${orientation === 'b' ? 'flipped' : ''}`}
      title={hidden ? 'Değerlendirme gizli' : 'Motor değerlendirmesi (beyaz bakışından)'}
      aria-label={label ? `Değerlendirme ${label}` : 'Değerlendirme gizli'}
    >
      <div className="evalbar-white" style={{ height: `${white}%` }} />
      {label && <span className={`evalbar-label ${whiteAhead ? 'at-white' : 'at-black'}`}>{label}</span>}
    </div>
  );
}
