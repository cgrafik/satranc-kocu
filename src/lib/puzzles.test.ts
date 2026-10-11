import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import raw from '../data/puzzles.json';
import {
  EMPTY_PROGRESS,
  THEMES,
  checkPuzzleMove,
  parsePuzzles,
  pickPuzzle,
  puzzleStart,
  recordResult,
  updateRating,
  weakestThemes,
  type PuzzleData,
} from './puzzles';
import { seededRng } from './bot';

const puzzles = parsePuzzles(raw as PuzzleData);

describe('bulmaca veri seti (Lichess, CC0)', () => {
  it('kaynak bilgisi var ve yeterli sayıda bulmaca içeriyor', () => {
    expect((raw as PuzzleData).source).toMatch(/Lichess/);
    expect(puzzles.length).toBeGreaterThan(1000);
  });

  it('her tema için en az 50 bulmaca var', () => {
    for (const t of THEMES) expect(puzzles.filter((p) => p.themes.includes(t.id)).length, t.id).toBeGreaterThanOrEqual(50);
  });

  it('puanlar 400–1500 aralığında', () => {
    for (const p of puzzles) {
      expect(p.rating).toBeGreaterThanOrEqual(400);
      expect(p.rating).toBeLessThan(1500);
    }
  });

  it('TÜM bulmacalardaki tüm hamleler yasal (doğrulanmış pozisyonlar)', () => {
    let bad = 0;
    for (const p of puzzles) {
      const c = new Chess(p.fen);
      for (const u of p.moves) {
        try {
          c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
        } catch {
          bad++;
          break;
        }
      }
    }
    expect(bad).toBe(0);
  });

  it('mat temalı bulmacalar gerçekten matla bitiyor', () => {
    for (const p of puzzles.filter((x) => x.themes.some((t) => t.startsWith('mateIn') || t.endsWith('Mate')))) {
      const c = new Chess(p.fen);
      for (const u of p.moves) c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      expect(c.isCheckmate(), p.id).toBe(true);
    }
  });

  it('1 hamlede mat bulmacası tek çözüm hamlesi içerir', () => {
    for (const p of puzzles.filter((x) => x.themes.includes('mateIn1'))) expect(p.moves.length).toBe(2);
  });
});

describe('bulmaca mantığı', () => {
  const p = puzzles.find((x) => x.themes.includes('mateIn2'))!;

  it('başlangıç: rakibin hamlesi oynanır, sıra çözücüde', () => {
    const s = puzzleStart(p);
    expect(new Chess(s.fen).turn()).toBe(s.solver);
    expect(s.solver).not.toBe(new Chess(p.fen).turn());
  });

  it('doğru / yanlış / tamamlandı', () => {
    const s = puzzleStart(p);
    expect(checkPuzzleMove(p, s.fen, 1, p.moves[1])).toBe('correct');
    const c = new Chess(s.fen);
    const wrong = c.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion ?? '')).find((u) => {
      if (u === p.moves[1]) return false;
      const t = new Chess(s.fen);
      t.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      return !t.isCheckmate();
    })!;
    expect(checkPuzzleMove(p, s.fen, 1, wrong)).toBe('wrong');
    // son hamle
    const c2 = new Chess(p.fen);
    for (const u of p.moves.slice(0, 3)) c2.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    expect(checkPuzzleMove(p, c2.fen(), 3, p.moves[3])).toBe('complete');
  });

  it('mat eden alternatif son hamle kabul edilir', () => {
    // İki farklı matı olan konum: Kd8# ve Ve8# (beyaz kale d1, vezir e2; siyah şah g8, piyonlar f7 g7 h7)
    const fen = '6k1/5ppp/8/8/8/8/4QPPP/3R2K1 w - - 0 1';
    const fake = { id: 'x', fen, moves: ['d1d8'], rating: 600, themes: ['mateIn1'], url: '' };
    // ply 0 burada kullanıcının hamlesi gibi davranır (test amaçlı)
    expect(checkPuzzleMove(fake, fen, 0, 'd1d8')).toBe('complete');
    expect(checkPuzzleMove(fake, fen, 0, 'e2e8')).toBe('complete');
    expect(checkPuzzleMove(fake, fen, 0, 'e2e4')).toBe('wrong');
  });

  it('puana yakın ve temaya uygun bulmaca seçer, görülenleri tekrar etmez', () => {
    const rng = seededRng(5);
    const a = pickPuzzle(puzzles, { theme: 'fork', rating: 700 }, rng)!;
    expect(a.themes).toContain('fork');
    expect(Math.abs(a.rating - 700)).toBeLessThanOrEqual(125);
    const seen = new Set(puzzles.filter((x) => x.themes.includes('fork') && Math.abs(x.rating - 700) <= 125).map((x) => x.id));
    const b = pickPuzzle(puzzles, { theme: 'fork', rating: 700, exclude: seen }, rng)!;
    expect(seen.has(b.id)).toBe(false);
    expect(b.themes).toContain('fork');
  });

  it('Elo: kolay bulmacayı çözmek az, zoru çözmek çok puan kazandırır', () => {
    const easy = updateRating(800, 500, true, 50) - 800;
    const hard = updateRating(800, 1200, true, 50) - 800;
    expect(hard).toBeGreaterThan(easy);
    expect(updateRating(800, 800, false, 50)).toBeLessThan(800);
  });

  it('ilerleme: seri, tema istatistiği, hatalı bulmaca kuyruğu', () => {
    // 600 puanlı kullanıcı için uygun zorlukta (800 altı) bir 2 hamlede mat bulmacası
    const p = puzzles.find((x) => x.themes.includes('mateIn2') && x.rating < 800)!;
    let prog = recordResult(EMPTY_PROGRESS, p, 'failed');
    expect(prog.failedIds).toContain(p.id);
    expect(prog.streak).toBe(0);
    expect(prog.rating).toBeLessThan(600);
    prog = recordResult(prog, p, 'solved');
    expect(prog.failedIds).not.toContain(p.id);
    expect(prog.streak).toBe(1);
    expect(prog.perTheme.mateIn2).toEqual({ ok: 1, fail: 1 });
    const before = prog.rating;
    prog = recordResult(prog, p, 'assisted');
    expect(prog.rating).toBe(before);
    expect(prog.failedIds).toContain(p.id);
  });

  it('en zayıf temalar', () => {
    const prog = {
      ...EMPTY_PROGRESS,
      perTheme: { fork: { ok: 1, fail: 4 }, pin: { ok: 4, fail: 1 }, skewer: { ok: 1, fail: 0 } },
    };
    expect(weakestThemes(prog).map((x) => x.id)).toEqual(['fork', 'pin']);
  });
});
