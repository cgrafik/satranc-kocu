import type { Score } from '../lib/uci';
import { winPercent } from '../lib/evaluation';
import { CLASS_INFO, type MoveClass } from '../lib/coach';

export interface GraphPoint {
  score: Score | null;
  cls?: MoveClass;
}

/** Hamle hamle beyazın kazanma yüzdesi grafiği. Kırmızı noktalar hata/büyük hata. */
export default function EvalGraph({
  points,
  current,
  onSelect,
}: {
  points: GraphPoint[];
  current: number | null;
  onSelect?: (index: number) => void;
}) {
  const W = 300;
  const H = 70;
  if (points.length === 0) return null;
  const n = Math.max(points.length, 2);
  const xs = (i: number) => (i / (n - 1)) * W;
  const ys = (p: GraphPoint) => H - ((p.score ? winPercent(p.score) : 50) / 100) * H;
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xs(i).toFixed(1)},${ys(p).toFixed(1)}`).join(' ');
  const area = `${path} L${xs(points.length - 1)},${H} L0,${H} Z`;
  return (
    <svg className="evalgraph" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Değerlendirme grafiği">
      <rect x="0" y="0" width={W} height={H} className="eg-bg" />
      <path d={area} className="eg-area" />
      <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="eg-mid" />
      <path d={path} className="eg-line" fill="none" />
      {points.map((p, i) => {
        const tone = p.cls ? CLASS_INFO[p.cls].tone : null;
        if (tone !== 'bad' && i !== current) return null;
        return (
          <circle
            key={i}
            cx={xs(i)}
            cy={ys(p)}
            r={i === current ? 4 : 3}
            className={i === current ? 'eg-cur' : 'eg-bad'}
            onClick={() => onSelect?.(i)}
          />
        );
      })}
      {onSelect &&
        points.map((_, i) => (
          <rect
            key={`h${i}`}
            x={xs(i) - W / n / 2}
            y={0}
            width={W / n}
            height={H}
            fill="transparent"
            onClick={() => onSelect(i)}
            style={{ cursor: 'pointer' }}
          />
        ))}
    </svg>
  );
}
