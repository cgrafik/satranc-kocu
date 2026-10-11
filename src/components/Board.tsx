// chess.com tarzı etkileşimli tahta:
// - Taşa tıkla/bas → gidebileceği kareler nokta, alabileceği taşlar halka ile gösterilir
// - Tıkla-tıkla veya sürükle-bırak ile oyna (fare + dokunmatik)
// - Son hamle ve şah vurgusu, sağ tıkla ok/daire çizme, terfi seçici, kayan taş animasyonu
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Chess, type Square } from 'chess.js';
import { defaultPieces } from 'react-chessboard';
import type { BoardArrow } from '../lib/coach';
import { isPromotionMove } from '../lib/game';
import './Board.css';

export type Mark = 'danger' | 'hint' | 'good' | 'threat';

export interface BoardProps {
  fen: string;
  orientation: 'w' | 'b';
  /** Hangi renk oynatılabilir. */
  movable: 'w' | 'b' | 'both' | 'none';
  onMove?: (from: string, to: string, promotion?: string) => boolean | void;
  lastMove?: { from: string; to: string } | null;
  arrows?: BoardArrow[];
  marks?: Record<string, Mark>;
  showCoords?: boolean;
}

const FILES = 'abcdefgh';
type Code = string; // 'wP', 'bK' ...

interface Tracked {
  id: number;
  sq: string;
  code: Code;
}

function parsePlacement(fen: string): Map<string, Code> {
  const map = new Map<string, Code>();
  const rows = fen.split(' ')[0].split('/');
  rows.forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += Number(ch);
      else {
        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        map.set(`${FILES[f]}${8 - r}`, color + ch.toUpperCase());
        f++;
      }
    }
  });
  return map;
}

function dist(a: string, b: string) {
  return Math.abs(a.charCodeAt(0) - b.charCodeAt(0)) + Math.abs(Number(a[1]) - Number(b[1]));
}

/** Taşlara kalıcı kimlik verir; böylece hamlede taş kayarak hareket eder. */
function trackPieces(prev: Tracked[], fen: string): Tracked[] {
  const now = parsePlacement(fen);
  let nextId = prev.reduce((m, p) => Math.max(m, p.id), 0) + 1;
  const out: Tracked[] = [];
  const unmatchedPrev: Tracked[] = [];
  for (const t of prev) {
    if (now.get(t.sq) === t.code) {
      out.push(t);
      now.delete(t.sq);
    } else unmatchedPrev.push(t);
  }
  for (const [sq, code] of now) {
    let bestIdx = -1;
    let bestD = 99;
    unmatchedPrev.forEach((t, i) => {
      if (t.code === code && dist(t.sq, sq) < bestD) {
        bestD = dist(t.sq, sq);
        bestIdx = i;
      }
    });
    if (bestIdx >= 0) {
      out.push({ ...unmatchedPrev[bestIdx], sq });
      unmatchedPrev.splice(bestIdx, 1);
    } else out.push({ id: nextId++, sq, code });
  }
  return out;
}

const ARROW_COLORS: Record<BoardArrow['color'] | 'user', string> = {
  green: 'rgba(21, 120, 27, 0.85)',
  red: 'rgba(204, 40, 40, 0.85)',
  orange: 'rgba(230, 143, 0, 0.9)',
  blue: 'rgba(40, 110, 220, 0.85)',
  purple: 'rgba(150, 70, 200, 0.85)',
  user: 'rgba(255, 170, 0, 0.8)',
};

export default function Board({
  fen,
  orientation,
  movable,
  onMove,
  lastMove,
  arrows = [],
  marks = {},
  showCoords = true,
}: BoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const chess = useMemo(() => {
    try {
      return new Chess(fen);
    } catch {
      return new Chess();
    }
  }, [fen]);

  // --- Seçim, sürükleme ---
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ from: string; code: Code; x: number; y: number; active: boolean } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<{ from: string; to: string; color: 'w' | 'b' } | null>(null);
  const [userArrows, setUserArrows] = useState<{ from: string; to: string }[]>([]);
  const [userCircles, setUserCircles] = useState<string[]>([]);
  const pressRef = useRef<{ sq: string; x: number; y: number; wasSelected: boolean } | null>(null);
  const rightRef = useRef<string | null>(null);

  // --- Taş takibi (animasyon için) ---
  const [pieces, setPieces] = useState<Tracked[]>(() => trackPieces([], fen));
  const [animate, setAnimate] = useState(true);
  // Sürükle-bırak ile yapılan hamlede taş zaten hedefte; kaydırma animasyonu yapma.
  const [skipAnim, setSkipAnim] = useState(false);
  const [prevFen, setPrevFen] = useState(fen);
  if (prevFen !== fen) {
    // Render sırasında türetilmiş durum güncellemesi (React'in önerdiği kalıp)
    setPrevFen(fen);
    setPieces(trackPieces(pieces, fen));
    setAnimate(!skipAnim);
    setSkipAnim(false);
    setSelected(null);
    setPromotion(null);
    setUserArrows([]);
    setUserCircles([]);
  }

  const canMoveColor = (c: 'w' | 'b') => movable === 'both' || movable === c;

  const targets = useMemo(() => {
    if (!selected) return new Map<string, boolean>();
    const m = new Map<string, boolean>();
    for (const mv of chess.moves({ square: selected as Square, verbose: true })) m.set(mv.to, Boolean(mv.captured));
    return m;
  }, [selected, chess]);

  const squareAtPoint = (x: number, y: number): string | null => {
    const el = boardRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const fx = Math.floor(((x - r.left) / r.width) * 8);
    const fy = Math.floor(((y - r.top) / r.height) * 8);
    if (fx < 0 || fx > 7 || fy < 0 || fy > 7) return null;
    return orientation === 'w' ? `${FILES[fx]}${8 - fy}` : `${FILES[7 - fx]}${fy + 1}`;
  };

  const pos = (sq: string) => {
    const f = FILES.indexOf(sq[0]);
    const r = Number(sq[1]) - 1;
    return orientation === 'w' ? { x: f, y: 7 - r } : { x: 7 - f, y: r };
  };

  const attempt = (from: string, to: string, viaDrag: boolean) => {
    if (!targets.has(to) && !chess.moves({ square: from as Square, verbose: true }).some((m) => m.to === to)) return false;
    if (isPromotionMove(chess, from, to)) {
      setPromotion({ from, to, color: chess.get(from as Square)!.color });
      setSkipAnim(viaDrag);
      return true;
    }
    setSkipAnim(viaDrag);
    const ok = onMove?.(from, to) !== false;
    if (!ok) setSkipAnim(false);
    setSelected(null);
    return ok;
  };

  const sqFromEvent = (e: RPointerEvent) =>
    (e.target as HTMLElement).closest<HTMLElement>('[data-square]')?.dataset.square ?? squareAtPoint(e.clientX, e.clientY);

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (promotion) return;
    const sq = sqFromEvent(e);
    if (!sq) return;
    if (e.button === 2) {
      rightRef.current = sq;
      return;
    }
    if (e.button !== 0) return;
    setUserArrows([]);
    setUserCircles([]);
    const piece = chess.get(sq as Square);
    const own = piece && piece.color === chess.turn() && canMoveColor(piece.color);

    if (selected && selected !== sq && targets.has(sq)) {
      attempt(selected, sq, false);
      return;
    }
    if (own) {
      const wasSelected = selected === sq;
      setSelected(sq);
      pressRef.current = { sq, x: e.clientX, y: e.clientY, wasSelected };
      setDrag({ from: sq, code: piece.color + piece.type.toUpperCase(), x: e.clientX, y: e.clientY, active: false });
      boardRef.current?.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    } else {
      setSelected(null);
    }
  };

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!drag || !pressRef.current) return;
    const moved = Math.hypot(e.clientX - pressRef.current.x, e.clientY - pressRef.current.y);
    if (!drag.active && moved < 4) return;
    setDrag({ ...drag, x: e.clientX, y: e.clientY, active: true });
    setHover(squareAtPoint(e.clientX, e.clientY));
  };

  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button === 2 && rightRef.current) {
      const from = rightRef.current;
      const to = squareAtPoint(e.clientX, e.clientY);
      rightRef.current = null;
      if (!to) return;
      if (to === from) setUserCircles((c) => (c.includes(to) ? c.filter((x) => x !== to) : [...c, to]));
      else
        setUserArrows((a) =>
          a.some((x) => x.from === from && x.to === to) ? a.filter((x) => !(x.from === from && x.to === to)) : [...a, { from, to }],
        );
      return;
    }
    const press = pressRef.current;
    pressRef.current = null;
    const d = drag;
    setDrag(null);
    setHover(null);
    if (!press || !d) return;
    if (d.active) {
      const to = squareAtPoint(e.clientX, e.clientY);
      if (to && to !== d.from) attempt(d.from, to, true);
    } else if (press.wasSelected) {
      setSelected(null);
    }
  };

  const [boardPx, setBoardPx] = useState(480);
  useEffect(() => {
    const el = boardRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setBoardPx(el.getBoundingClientRect().width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Sürükleme sırasında pencere dışına çıkılırsa iptal
  useEffect(() => {
    const cancel = () => {
      setDrag(null);
      setHover(null);
      pressRef.current = null;
    };
    window.addEventListener('blur', cancel);
    return () => window.removeEventListener('blur', cancel);
  }, []);

  const kingInCheck = useMemo(() => {
    if (!chess.inCheck()) return null;
    return chess.findPiece({ type: 'k', color: chess.turn() })[0] ?? null;
  }, [chess]);

  const squares: { sq: string; light: boolean; x: number; y: number }[] = [];
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const sq = orientation === 'w' ? `${FILES[x]}${8 - y}` : `${FILES[7 - x]}${y + 1}`;
      const light = (FILES.indexOf(sq[0]) + Number(sq[1])) % 2 === 1;
      squares.push({ sq, light, x, y });
    }

  const allArrows = [
    ...arrows.map((a) => ({ ...a, c: ARROW_COLORS[a.color] })),
    ...userArrows.map((a) => ({ ...a, c: ARROW_COLORS.user })),
  ];

  return (
    <div
      ref={boardRef}
      className="board"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        setDrag(null);
        setHover(null);
      }}
      onContextMenu={(e) => e.preventDefault()}
      role="grid"
      aria-label="Satranç tahtası"
    >
      {squares.map(({ sq, light, x, y }) => {
        const classes = ['sq', light ? 'light' : 'dark'];
        if (lastMove && (lastMove.from === sq || lastMove.to === sq)) classes.push('last');
        if (selected === sq) classes.push('selected');
        if (marks[sq]) classes.push(`mark-${marks[sq]}`);
        if (kingInCheck === sq) classes.push('check');
        if (drag?.active && hover === sq) classes.push('hover');
        return (
          <div
            key={sq}
            data-square={sq}
            className={classes.join(' ')}
            style={{ left: `${x * 12.5}%`, top: `${y * 12.5}%` }}
          >
            {showCoords && x === 0 && <span className="coord rank">{sq[1]}</span>}
            {showCoords && y === 7 && <span className="coord file">{sq[0]}</span>}
            {targets.has(sq) && <span className={targets.get(sq) ? 'target capture' : 'target dot'} />}
            {userCircles.includes(sq) && <span className="user-circle" />}
          </div>
        );
      })}

      {pieces.map((p) => {
        const { x, y } = pos(p.sq);
        const dragging = drag?.active && drag.from === p.sq;
        const Piece = defaultPieces[p.code];
        return (
          <div
            key={p.id}
            className={`piece${animate ? ' anim' : ''}${dragging ? ' ghost' : ''}`}
            style={{ transform: `translate(${x * 100}%, ${y * 100}%)` }}
            aria-hidden
          >
            {Piece ? <Piece /> : null}
          </div>
        );
      })}

      {allArrows.length > 0 && (
        <svg className="arrows" viewBox="0 0 800 800" aria-hidden>
          {allArrows.map((a, i) => (
            <ArrowShape key={i} from={pos(a.from)} to={pos(a.to)} color={a.c} />
          ))}
        </svg>
      )}

      {drag?.active && defaultPieces[drag.code] && (
        <div
          className="drag-piece"
          style={{
            width: boardPx / 8,
            height: boardPx / 8,
            transform: `translate(${drag.x - boardPx / 16}px, ${drag.y - boardPx / 16}px)`,
          }}
        >
          {defaultPieces[drag.code]()}
        </div>
      )}

      {promotion && (
        <div className="promo-overlay" onPointerDown={(e) => e.stopPropagation()} onClick={() => setPromotion(null)}>
          <div
            className="promo-picker"
            style={{
              left: `${pos(promotion.to).x * 12.5}%`,
              top: pos(promotion.to).y === 0 ? 0 : undefined,
              bottom: pos(promotion.to).y === 7 ? 0 : undefined,
              flexDirection: pos(promotion.to).y === 0 ? 'column' : 'column-reverse',
            }}
          >
            {(['q', 'n', 'r', 'b'] as const).map((t) => {
              const P = defaultPieces[promotion.color + t.toUpperCase()];
              return (
                <button
                  key={t}
                  className="promo-btn"
                  aria-label={{ q: 'Vezir', n: 'At', r: 'Kale', b: 'Fil' }[t]}
                  onClick={(e) => {
                    e.stopPropagation();
                    const { from, to } = promotion;
                    setPromotion(null);
                    onMove?.(from, to, t);
                  }}
                >
                  <P />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ArrowShape({ from, to, color }: { from: { x: number; y: number }; to: { x: number; y: number }; color: string }) {
  const c = (p: { x: number; y: number }) => ({ x: p.x * 100 + 50, y: p.y * 100 + 50 });
  const a = c(from);
  const b = c(to);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const isKnight = (Math.abs(dx) === 1 && Math.abs(dy) === 2) || (Math.abs(dx) === 2 && Math.abs(dy) === 1);
  // At hamlesi: L şeklinde (önce uzun kol)
  const points = isKnight
    ? Math.abs(dy) === 2
      ? [a, { x: a.x, y: b.y }, b]
      : [a, { x: b.x, y: a.y }, b]
    : [a, b];
  const head = 38;
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const ang = Math.atan2(last.y - prev.y, last.x - prev.x);
  const tip = { x: last.x - Math.cos(ang) * 10, y: last.y - Math.sin(ang) * 10 };
  const base = { x: tip.x - Math.cos(ang) * head, y: tip.y - Math.sin(ang) * head };
  // Başlangıcı merkezden biraz ileri al
  const first = points[0];
  const second = points[1];
  const ang0 = Math.atan2(second.y - first.y, second.x - first.x);
  const start = isKnight ? first : { x: first.x + Math.cos(ang0) * 18, y: first.y + Math.sin(ang0) * 18 };
  const shaft = [start, ...points.slice(1, -1), base];
  const perp = { x: -Math.sin(ang), y: Math.cos(ang) };
  const w = 24;
  return (
    <g opacity={1}>
      <polyline
        points={shaft.map((p) => `${p.x},${p.y}`).join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={16}
        strokeLinejoin="miter"
      />
      <polygon
        points={`${tip.x},${tip.y} ${base.x + perp.x * w},${base.y + perp.y * w} ${base.x - perp.x * w},${base.y - perp.y * w}`}
        fill={color}
      />
    </g>
  );
}
