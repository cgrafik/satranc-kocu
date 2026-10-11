// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import Board from './Board';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

afterEach(cleanup);

function setup(props: Partial<Parameters<typeof Board>[0]> = {}) {
  const onMove = vi.fn(() => true);
  const utils = render(<Board fen={START} orientation="w" movable="w" onMove={onMove} {...props} />);
  const sq = (s: string) => utils.container.querySelector(`[data-square="${s}"]`) as HTMLElement;
  const press = (s: string) => {
    fireEvent.pointerDown(sq(s), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(sq(s), { button: 0, clientX: 0, clientY: 0 });
  };
  const dots = () => [...utils.container.querySelectorAll('.target')].map((t) => (t.parentElement as HTMLElement).dataset.square).sort();
  return { ...utils, sq, press, dots, onMove };
}

describe('Tahta: chess.com tarzı hamle gösterimi', () => {
  it('64 kare ve 32 taş çizer', () => {
    const { container } = setup();
    expect(container.querySelectorAll('[data-square]')).toHaveLength(64);
    expect(container.querySelectorAll('.piece')).toHaveLength(32);
  });

  it('piyona tıklayınca gidebileceği kareleri nokta ile gösterir', () => {
    const { press, dots, container } = setup();
    press('e2');
    expect(dots()).toEqual(['e3', 'e4']);
    expect(container.querySelectorAll('.target.dot')).toHaveLength(2);
  });

  it('ata tıklayınca L şeklindeki yasal kareleri gösterir', () => {
    const { press, dots } = setup();
    press('g1');
    expect(dots()).toEqual(['f3', 'h3']);
  });

  it('alınabilecek taş halka ile gösterilir', () => {
    const { press, container } = setup({ fen: 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2' });
    press('e4');
    const capture = container.querySelector('.target.capture')!;
    expect((capture.parentElement as HTMLElement).dataset.square).toBe('d5');
  });

  it('tıkla-tıkla hamle yapar', () => {
    const { press, onMove } = setup();
    press('e2');
    press('e4');
    expect(onMove).toHaveBeenCalledWith('e2', 'e4');
  });

  it('yasal olmayan kareye tıklamak hamle yapmaz, seçimi kaldırır', () => {
    const { press, onMove, dots } = setup();
    press('e2');
    press('e5');
    expect(onMove).not.toHaveBeenCalled();
    expect(dots()).toEqual([]);
  });

  it('aynı taşa ikinci kez tıklamak seçimi kaldırır', () => {
    const { press, dots } = setup();
    press('e2');
    press('e2');
    expect(dots()).toEqual([]);
  });

  it('başka bir kendi taşına tıklamak seçimi değiştirir', () => {
    const { press, dots } = setup();
    press('e2');
    press('b1');
    expect(dots()).toEqual(['a3', 'c3']);
  });

  it('rakibin taşı ya da sıra rakipteyken seçilemez', () => {
    const { press, dots } = setup();
    press('e7');
    expect(dots()).toEqual([]);
  });

  it('oynatma kapalıyken (rakip düşünürken) taş seçilemez', () => {
    const { press, dots } = setup({ movable: 'none' });
    press('e2');
    expect(dots()).toEqual([]);
  });

  it('şah altındayken yalnızca kurtaran hamleler gösterilir', () => {
    // Beyaz şah e1'e e4'teki vezir şah çekiyor; d1-veziri yalnızca e2'ye araya girebilir
    const { press, dots, container } = setup({ fen: 'rnb1kbnr/pppp1ppp/8/4p3/4q3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1' });
    expect(container.querySelector('.sq.check')?.getAttribute('data-square')).toBe('e1');
    press('d1');
    expect(dots()).toEqual(['e2']);
  });

  it('terfi: seçici açılır, at seçilirse at ile terfi eder', () => {
    const { press, onMove, getByLabelText } = setup({ fen: '8/4P1k1/8/8/8/8/8/4K3 w - - 0 1' });
    press('e7');
    press('e8');
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.click(getByLabelText('At'));
    expect(onMove).toHaveBeenCalledWith('e7', 'e8', 'n');
  });

  it('son hamle ve tahta çevirme', () => {
    const { container } = setup({ orientation: 'b', lastMove: { from: 'e2', to: 'e4' } });
    const last = [...container.querySelectorAll('.sq.last')].map((e) => (e as HTMLElement).dataset.square).sort();
    expect(last).toEqual(['e2', 'e4']);
    // Siyah bakışında sol üst köşe h1'dir
    expect((container.querySelector('[data-square]') as HTMLElement).dataset.square).toBe('h1');
  });

  it('okları çizer', () => {
    const { container } = setup({ arrows: [{ from: 'g1', to: 'f3', color: 'green' }] });
    expect(container.querySelectorAll('svg.arrows polygon')).toHaveLength(1);
  });
});
