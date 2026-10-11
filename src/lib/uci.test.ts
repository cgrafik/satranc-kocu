import { describe, expect, it } from 'vitest';
import { parseBestMove, parseInfo } from './uci';
import { describeScore, formatScore, scoreFor, scoreToNumber, winPercent } from './evaluation';

describe('UCI ayrıştırma', () => {
  it('cp, wdl, multipv ve pv okur', () => {
    const l = parseInfo(
      'info depth 12 seldepth 18 multipv 2 score cp -35 wdl 50 800 150 nodes 12345 nps 100000 hashfull 3 time 120 pv e7e5 g1f3 b8c6',
    );
    expect(l).toEqual({
      multipv: 2,
      depth: 12,
      score: { type: 'cp', value: -35 },
      wdl: [50, 800, 150],
      bound: undefined,
      pv: ['e7e5', 'g1f3', 'b8c6'],
    });
  });

  it('mat skoru ve sınır skorlarını okur', () => {
    expect(parseInfo('info depth 5 score mate -2 pv h5f7 e8f7')?.score).toEqual({ type: 'mate', value: -2 });
    expect(parseInfo('info depth 9 score cp 120 lowerbound pv e2e4')?.bound).toBe('lower');
  });

  it('pv içermeyen satırları yok sayar', () => {
    expect(parseInfo('info string NNUE evaluation using nn-xyz.nnue')).toBeNull();
    expect(parseInfo('info depth 1 currmove e2e4 currmovenumber 1')).toBeNull();
    expect(parseInfo('readyok')).toBeNull();
  });

  it('bestmove okur, (none) → null', () => {
    expect(parseBestMove('bestmove e2e4 ponder e7e5')).toEqual({ best: 'e2e4' });
    expect(parseBestMove('bestmove (none)')).toEqual({ best: null });
    expect(parseBestMove('info depth 3')).toBeNull();
  });
});

describe('değerlendirme', () => {
  it('bakış açısını çevirir', () => {
    expect(scoreFor({ type: 'cp', value: 50 }, 'b', 'w')).toEqual({ type: 'cp', value: -50 });
    expect(scoreFor({ type: 'mate', value: 3 }, 'w', 'w')).toEqual({ type: 'mate', value: 3 });
  });

  it('kazanma yüzdesi simetrik ve sınırlı', () => {
    expect(winPercent({ type: 'cp', value: 0 })).toBeCloseTo(50);
    const a = winPercent({ type: 'cp', value: 200 });
    const b = winPercent({ type: 'cp', value: -200 });
    expect(a + b).toBeCloseTo(100);
    expect(a).toBeGreaterThan(65);
    expect(a).toBeLessThan(75);
    expect(winPercent({ type: 'mate', value: 2 })).toBe(100);
    expect(winPercent({ type: 'mate', value: -1 })).toBe(0);
  });

  it('yakın mat uzak mattan büyük, her mat her cp skorundan büyük', () => {
    expect(scoreToNumber({ type: 'mate', value: 1 })).toBeGreaterThan(scoreToNumber({ type: 'mate', value: 5 }));
    expect(scoreToNumber({ type: 'mate', value: 9 })).toBeGreaterThan(scoreToNumber({ type: 'cp', value: 5000 }));
    expect(scoreToNumber({ type: 'mate', value: -1 })).toBeLessThan(scoreToNumber({ type: 'mate', value: -6 }));
  });

  it('metin biçimleri', () => {
    expect(formatScore({ type: 'cp', value: 140 })).toBe('+1.4');
    expect(formatScore({ type: 'cp', value: -30 })).toBe('-0.3');
    expect(formatScore({ type: 'mate', value: -2 })).toBe('-M2');
    expect(describeScore({ type: 'cp', value: 20 })).toBe('Pozisyon yaklaşık eşit.');
    expect(describeScore({ type: 'cp', value: -420 })).toContain('Siyah kazanan durumda');
    expect(describeScore({ type: 'mate', value: 3 })).toBe('Beyaz 3 hamlede mat edebilir.');
  });
});
