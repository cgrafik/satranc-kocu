import { useEffect, useRef } from 'react';
import { CLASS_INFO, type MoveClass } from '../lib/coach';

export interface ListMove {
  trSan: string;
  cls?: MoveClass;
}

/** Hamle listesi: "1. e4 e5". index = hamle sırası (0 tabanlı yarım hamle). */
export default function MoveList({
  moves,
  startsWithBlack = false,
  firstMoveNumber = 1,
  current,
  onSelect,
}: {
  moves: ListMove[];
  startsWithBlack?: boolean;
  firstMoveNumber?: number;
  current: number | null;
  onSelect: (index: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('.mv.current')?.scrollIntoView({ block: 'nearest' });
  }, [current, moves.length]);

  const rows: { no: number; w?: number; b?: number }[] = [];
  const offset = startsWithBlack ? 1 : 0;
  for (let i = 0; i < moves.length + offset; i += 2) {
    const wi = i - offset;
    const bi = i + 1 - offset;
    rows.push({ no: firstMoveNumber + i / 2, w: wi >= 0 ? wi : undefined, b: bi < moves.length ? bi : undefined });
  }
  const cell = (i?: number) => {
    if (i === undefined) return <span className="mv empty">…</span>;
    const m = moves[i];
    const info = m.cls ? CLASS_INFO[m.cls] : null;
    return (
      <button className={`mv ${current === i ? 'current' : ''}`} onClick={() => onSelect(i)}>
        {m.trSan}
        {info && <span className={`cls-dot tone-${info.tone}`} title={info.label}>{info.short}</span>}
      </button>
    );
  };
  return (
    <div className="movelist" ref={ref}>
      {rows.length === 0 && <div className="muted small">Henüz hamle yok.</div>}
      {rows.map((r) => (
        <div className="mvrow" key={r.no}>
          <span className="mvno">{r.no}.</span>
          {cell(r.w)}
          {cell(r.b)}
        </div>
      ))}
    </div>
  );
}
