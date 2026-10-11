// Satranç kuralları: chess.js'in uygulamada kullandığımız davranışlarını doğrular.
import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { tryMove, isPromotionMove, gameResult } from './game';

describe('kurallar', () => {
  it('geçersiz hamleyi engeller', () => {
    const c = new Chess();
    expect(tryMove(c, 'e2', 'e5')).toBeNull();
    expect(tryMove(c, 'g1', 'g3')).toBeNull();
    expect(tryMove(c, 'e7', 'e5')).toBeNull(); // sıra beyazda
    expect(c.fen()).toBe(new Chess().fen());
  });

  it('şah altındayken yalnızca şahı kurtaran hamlelere izin verir', () => {
    // Beyaz şah e1, siyah vezir e4'ten şah çekiyor; Ae2/Fe2 araya girme ya da şah kaçışı geçerli, a3 geçersiz.
    const c = new Chess('4k3/8/8/8/4q3/8/P7/4K1NR w K - 0 1');
    expect(c.inCheck()).toBe(true);
    expect(tryMove(c, 'a2', 'a3')).toBeNull();
    expect(tryMove(c, 'g1', 'e2')).not.toBeNull();
  });

  it('açmazdaki taş şahı açıkta bırakacak şekilde oynanamaz', () => {
    const c = new Chess('4k3/4r3/8/8/8/8/4N3/4K3 w - - 0 1');
    expect(tryMove(c, 'e2', 'c3')).toBeNull();
  });

  it('rok: kurallara uygun rok yapılabilir, şah geçtiği kare tehdit altındaysa yapılamaz', () => {
    const ok = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(tryMove(ok, 'e1', 'g1')?.san).toBe('O-O');
    // f8'deki siyah kale f1'i kontrol ediyor: şah f1'den geçemez → kısa rok yok, uzun rok serbest
    const throughCheck = new Chess('4kr2/8/8/8/8/8/8/R3K2R w KQ - 0 1');
    expect(throughCheck.inCheck()).toBe(false);
    expect(tryMove(throughCheck, 'e1', 'g1')).toBeNull();
    expect(tryMove(throughCheck, 'e1', 'c1')?.san).toBe('O-O-O');
    const inCheck = new Chess('4k3/8/8/8/8/8/4r3/R3K2R w KQ - 0 1');
    expect(tryMove(inCheck, 'e1', 'g1')).toBeNull();
  });

  it('şah oynadıktan sonra rok hakkı kaybolur', () => {
    const c = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    tryMove(c, 'e1', 'f1');
    tryMove(c, 'a8', 'b8');
    tryMove(c, 'f1', 'e1');
    tryMove(c, 'b8', 'a8');
    expect(tryMove(c, 'e1', 'g1')).toBeNull();
  });

  it('geçerken alma', () => {
    const c2 = new Chess('4k3/5p2/8/4P3/8/8/8/4K3 b - - 0 1');
    tryMove(c2, 'f7', 'f5');
    const m = tryMove(c2, 'e5', 'f6');
    expect(m?.isEnPassant()).toBe(true);
    expect(c2.get('f5')).toBeUndefined();
    // Bir hamle beklenirse hak kaybolur
    const c3 = new Chess('4k3/5p2/8/4P3/8/8/8/4K3 b - - 0 1');
    tryMove(c3, 'f7', 'f5');
    tryMove(c3, 'e1', 'd1');
    tryMove(c3, 'e8', 'd8');
    expect(tryMove(c3, 'e5', 'f6')).toBeNull();
  });

  it('piyon terfisi: terfi hamlesi tespit edilir ve seçilen taş konur', () => {
    const c = new Chess('8/4P1k1/8/8/8/8/8/4K3 w - - 0 1');
    expect(isPromotionMove(c, 'e7', 'e8')).toBe(true);
    expect(isPromotionMove(c, 'e1', 'e2')).toBe(false);
    const m = tryMove(c, 'e7', 'e8', 'n');
    expect(m?.san).toBe('e8=N+');
    expect(c.get('e8')?.type).toBe('n');
  });

  it('terfi taşı belirtilmezse vezir varsayılır', () => {
    const c = new Chess('8/4P1k1/8/8/8/8/8/4K3 w - - 0 1');
    expect(tryMove(c, 'e7', 'e8')?.san).toBe('e8=Q');
  });

  it('mat ve pat tespiti', () => {
    const mate = new Chess();
    for (const [f, t] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']] as const) tryMove(mate, f, t);
    expect(gameResult(mate)).toEqual({ over: true, winner: 'b', reason: 'Mat' });

    const stalemate = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(gameResult(stalemate)).toEqual({ over: true, winner: null, reason: 'Pat' });

    const insufficient = new Chess('8/8/4k3/8/8/4K3/8/8 w - - 0 1');
    expect(gameResult(insufficient).reason).toBe('Yetersiz malzeme');
  });
});
