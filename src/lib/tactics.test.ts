import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import {
  describeFork,
  detectFork,
  hangingPieces,
  lineMaterialSwing,
  passTurnFen,
  squareLoc,
  toTurkishSan,
} from './tactics';

describe('Türkçe notasyon', () => {
  it('taş harflerini çevirir', () => {
    expect(toTurkishSan('Nf3')).toBe('Af3');
    expect(toTurkishSan('Bxf7+')).toBe('Fxf7+');
    expect(toTurkishSan('Qh5')).toBe('Vh5');
    expect(toTurkishSan('Rxe8#')).toBe('Kxe8#');
    expect(toTurkishSan('Kg1')).toBe('Şg1');
    expect(toTurkishSan('e8=Q+')).toBe('e8=V+');
    expect(toTurkishSan('O-O-O')).toBe('O-O-O');
    expect(toTurkishSan('exd5')).toBe('exd5');
  });
  it('kare ekleri', () => {
    expect(squareLoc('e4')).toBe("e4'teki");
    expect(squareLoc('f6')).toBe("f6'daki");
    expect(squareLoc('a1')).toBe("a1'deki");
  });
});

describe('savunmasız taş tespiti', () => {
  it('savunmasız ve saldırı altındaki taşı bulur', () => {
    // Siyah at e5'te, savunanı yok; beyaz at f3 saldırıyor
    const c = new Chess('4k3/8/8/4n3/8/5N2/8/4K3 w - - 0 1');
    const h = hangingPieces(c, 'b');
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ square: 'e5', type: 'n', reason: 'undefended' });
  });
  it('savunulan ama daha değersiz taşın saldırdığı taşı bulur', () => {
    // Siyah vezir d5'te, c6 piyonu savunuyor; beyaz e4 piyonu saldırıyor
    const c = new Chess('4k3/8/2p5/3q4/4P3/8/8/4K3 b - - 0 1');
    const h = hangingPieces(c, 'b');
    expect(h.map((x) => [x.square, x.reason])).toEqual([['d5', 'cheaper']]);
  });
  it('güvendeki taşı işaretlemez', () => {
    const c = new Chess();
    expect(hangingPieces(c, 'w')).toEqual([]);
    expect(hangingPieces(c, 'b')).toEqual([]);
  });
});

describe('çatal tespiti', () => {
  it('atın şah ve vezire çatalını bulur', () => {
    // Beyaz at c7: e8'deki şah ve a8'deki kale + e6'daki vezir
    const c = new Chess('r3k3/2N5/4q3/8/8/8/8/4K3 b - - 0 1');
    const f = detectFork(c, 'c7');
    expect(f).not.toBeNull();
    expect(f!.targets.map((t) => t.type).sort()).toEqual(['k', 'q', 'r']);
    expect(describeFork(f!)).toContain('şah');
  });
  it('tek hedef çatal değildir', () => {
    const c = new Chess('4k3/8/8/8/8/2n5/8/4K3 w - - 0 1');
    expect(detectFork(c, 'c3')).toBeNull();
  });
});

describe('malzeme hesabı', () => {
  it('bedava taş alma dizisini +3 olarak hesaplar', () => {
    const fen = '4k3/8/8/4n3/8/5N2/8/4K3 w - - 0 1';
    expect(lineMaterialSwing(fen, ['f3e5'], 'w').swing).toBe(3);
    expect(lineMaterialSwing(fen, ['f3e5'], 'b').swing).toBe(-3);
  });
  it('takası yarıda kesmez', () => {
    // Beyaz Axe5 dxe5: eşit takas (0); maxPlies=1 olsa bile geri alma eklenir
    const fen = '4k3/3p4/8/4n3/8/5N2/8/4K3 w - - 0 1';
    expect(lineMaterialSwing(fen, ['f3e5', 'd7e6'], 'w', 1).swing).toBe(3);
    const fen2 = '4k3/8/3p4/4n3/8/5N2/8/4K3 w - - 0 1';
    expect(lineMaterialSwing(fen2, ['f3e5', 'd6e5'], 'w', 1).swing).toBe(0);
  });
});

describe('sırayı geçirme (tehdit analizi için)', () => {
  it('sırayı değiştirir', () => {
    const fen = passTurnFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
    expect(fen).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1');
  });
  it('şah altındayken null döner', () => {
    expect(passTurnFen('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3')).toBeNull();
  });
});
