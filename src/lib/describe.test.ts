import { describe, expect, it } from 'vitest';
import { describeLine, describeMove, squareFrom, toFigurine } from './describe';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('hamleyi düz Türkçeye çevirme', () => {
  it('sana öneri (emir kipi)', () => {
    expect(describeMove(START, 'g1f3', 'imp')).toBe("Atını g1'den f3'e götür");
    expect(describeMove(START, 'e2e4', 'imp')).toBe("Piyonunu e2'den e4'e sür");
    expect(describeMove(START, 'b1c3', 'imp')).toBe("Atını b1'den c3'e götür");
  });

  it('alma hamlesi', () => {
    const fen = '4k3/8/8/4n3/8/5N2/8/4K3 w - - 0 1';
    expect(describeMove(fen, 'f3e5', 'imp')).toBe("Atınla f3'ten e5'teki atı al");
    expect(describeMove(fen, 'f3e5', 'pastMine')).toBe("Atınla f3'ten e5'teki atı aldın");
  });

  it('rakibin hamlesi', () => {
    // 1.e4 e5 2.Af3 Vg5 → rakip (beyaz) Axg5
    const fen = 'rnb1kbnr/pppp1ppp/8/4p1q1/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    expect(describeMove(fen, 'f3g5', 'oppFuture')).toBe("Rakip atıyla g5'teki vezirini alır");
    expect(describeMove(fen, 'f3g5', 'oppCan')).toBe("Rakip atıyla g5'teki vezirini alabilir");
    expect(describeMove(START, 'g1f3', 'oppPast')).toBe("Rakip atını f3'e getirdi");
    expect(describeMove(START, 'e2e4', 'oppIf')).toBe("Rakip piyonunu e4'e sürerse");
  });

  it('kale için ünlü uyumu: kaleni / kalesini', () => {
    const fen = '4k3/8/8/8/8/8/8/R3K3 w - - 0 1';
    expect(describeMove(fen, 'a1a7', 'imp')).toBe("Kaleni a1'den a7'ye götür");
    expect(describeMove(fen, 'a1a7', 'oppPast')).toBe("Rakip kalesini a7'ye getirdi");
  });

  it('rok, terfi, şah ve mat', () => {
    expect(describeMove('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1g1', 'imp')).toBe('Kısa rok yap');
    expect(describeMove('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1', 'e8c8', 'oppPast')).toBe('Rakip uzun rok yaptı');
    expect(describeMove('8/4P1k1/8/8/8/8/8/4K3 w - - 0 1', 'e7e8q', 'imp')).toBe("Piyonunu e7'den e8'e sürüp vezir yap");
    expect(describeMove('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', 'd1d8', 'imp')).toBe("Kaleni d1'den d8'e götür — bu mat!");
    expect(describeMove('4k3/8/8/8/8/8/8/R3K3 w - - 0 1', 'a1a8', 'imp')).toBe("Kaleni a1'den a8'e götür (şah çekerek)");
  });

  it('devamı adım adım anlatır', () => {
    const fen = 'rnb1kbnr/pppp1ppp/8/4p1q1/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    expect(describeLine(fen, ['f3g5', 'g8f6'], 'b')).toEqual([
      "Rakip atıyla g5'teki vezirini alır.",
      "Sen atını f6'ya götürürsün.",
    ]);
  });

  it('ekler ve figürin', () => {
    expect(squareFrom('e4')).toBe("e4'ten");
    expect(squareFrom('f6')).toBe("f6'dan");
    expect(toFigurine('Nf3')).toBe('♘f3');
    expect(toFigurine('exd5')).toBe('exd5');
    expect(toFigurine('O-O')).toBe('O-O');
  });
});
