import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { LEVELS, getLevel, pickBotMove, seededRng } from './bot';
import type { Analysis } from './engine';

const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const analysis: Analysis = {
  fen,
  bestMove: 'e2e4',
  depth: 8,
  partial: false,
  lines: [
    { multipv: 1, depth: 8, score: { type: 'cp', value: 40 }, pv: ['e2e4'] },
    { multipv: 2, depth: 8, score: { type: 'cp', value: 35 }, pv: ['d2d4'] },
    { multipv: 3, depth: 8, score: { type: 'cp', value: -150 }, pv: ['g2g4'] },
  ],
};

describe('bot', () => {
  it('seviyeler artan güçte sıralı', () => {
    for (let i = 1; i < LEVELS.length; i++) {
      expect(LEVELS[i].depth).toBeGreaterThanOrEqual(LEVELS[i - 1].depth);
      expect(LEVELS[i].randomRate).toBeLessThanOrEqual(LEVELS[i - 1].randomRate);
    }
  });

  it('Usta her zaman en iyi hamleyi oynar', () => {
    const rng = seededRng(1);
    for (let i = 0; i < 20; i++) expect(pickBotMove(fen, getLevel('usta'), analysis, rng)).toBe('e2e4');
  });

  it('her zaman yasal hamle döndürür', () => {
    const legal = new Set(new Chess(fen).moves({ verbose: true }).map((m) => m.from + m.to));
    const rng = seededRng(7);
    for (const lvl of LEVELS) for (let i = 0; i < 50; i++) expect(legal.has(pickBotMove(fen, lvl, analysis, rng)!)).toBe(true);
  });

  it('düşük seviye kötü hamleleri daha sık oynar', () => {
    const count = (id: 'baslangic' | 'ileri') => {
      const rng = seededRng(42);
      let bad = 0;
      for (let i = 0; i < 2000; i++) {
        const m = pickBotMove(fen, getLevel(id), analysis, rng);
        if (m !== 'e2e4' && m !== 'd2d4') bad++;
      }
      return bad;
    };
    expect(count('baslangic')).toBeGreaterThan(count('ileri') * 3);
  });

  it('Orta seviye 1 hamlede matı kaçırmaz', () => {
    const mateFen = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
    const a: Analysis = {
      fen: mateFen, bestMove: 'd1d8', depth: 6, partial: false,
      lines: [
        { multipv: 1, depth: 6, score: { type: 'mate', value: 1 }, pv: ['d1d8'] },
        { multipv: 2, depth: 6, score: { type: 'cp', value: 300 }, pv: ['d1d7'] },
      ],
    };
    const rng = seededRng(3);
    for (let i = 0; i < 50; i++) expect(pickBotMove(mateFen, getLevel('orta'), a, rng)).toBe('d1d8');
  });

  it('analiz yoksa rastgele yasal hamle, hamle yoksa null', () => {
    expect(pickBotMove(fen, getLevel('kolay'), null, seededRng(1))).toMatch(/^[a-h][1-8][a-h][1-8]$/);
    expect(pickBotMove('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', getLevel('kolay'), null)).toBeNull();
  });
});
