// Koç: gerçek motorla 400–900 seviyesinin tipik hata senaryoları.
import { afterAll, describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { buildHint, classify, explainThreat, reviewMove } from './coach';
import { createNodeEngine } from '../test/nodeEngine';
import { passTurnFen } from './tactics';

const engine = createNodeEngine();
afterAll(() => engine.terminate());

async function review(startFen: string, uciMoves: string[], move: string) {
  const c = new Chess(startFen);
  for (const u of uciMoves) c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
  const fenBefore = c.fen();
  const before = await engine.analyze(fenBefore, { depth: 12, multipv: 3 });
  const after2 = new Chess(fenBefore);
  after2.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] });
  const after = after2.isGameOver() ? null : await engine.analyze(after2.fen(), { depth: 12 });
  return reviewMove(fenBefore, { from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] }, before, after);
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('sınıflandırma eşikleri', () => {
  it('kayıp miktarına göre sınıf', () => {
    expect(classify(0, true)).toBe('best');
    expect(classify(0.5, false)).toBe('best');
    expect(classify(2, false)).toBe('excellent');
    expect(classify(5, false)).toBe('good');
    expect(classify(8, false)).toBe('inaccuracy');
    expect(classify(15, false)).toBe('mistake');
    expect(classify(40, false)).toBe('blunder');
  });
});

describe('hamle değerlendirme (gerçek motor)', () => {
  it('çoban matına izin veren hamle büyük hatadır ve mat tehdidi açıklanır', async () => {
    // 1.e4 e5 2.Fc4 Ac6 3.Vh5 Af6?? 4.Vxf7#
    const r = await review(START, ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5'], 'g8f6');
    expect(r.cls).toBe('blunder');
    expect(r.reasons.join(' ')).toMatch(/mat edebilir/);
    expect(r.refutation?.line[0]).toBe('Vxf7#');
    expect(r.afterArrows[0]).toMatchObject({ from: 'h5', to: 'f7', color: 'red' });
    expect(r.best).toBeDefined();
  }, 60000);

  it('veziri savunmasız kareye götürmek: taş kaybı açıklanır', async () => {
    // 1.e4 e5 2.Af3 Vg5?? 3.Axg5
    const r = await review(START, ['e2e4', 'e7e5', 'g1f3'], 'd8g5');
    expect(r.cls).toBe('blunder');
    expect(r.reasons[0]).toBe("Vezirini savunmasız bir kareye götürdün: rakip Axg5 ile g5'teki vezirini alıyor.");
    expect(r.dangerSquares).toContain('g5');
  }, 60000);

  it('bedava taşı almamak: kritik fırsat kaçtı', async () => {
    const r = await review('4k3/8/8/4n3/8/5N2/PP6/4K3 w - - 0 1', [], 'a2a3');
    expect(['missed', 'mistake', 'blunder']).toContain(r.cls);
    expect(r.best?.uci).toBe('f3e5');
    expect(r.reasons.join(' ')).toMatch(/savunmasızdı/);
    expect(r.beforeArrows[0]).toMatchObject({ from: 'f3', to: 'e5', color: 'green' });
  }, 60000);

  it('çatal hamlesi en iyi hamle olarak tanınır ve çatal açıklanır', async () => {
    const r = await review('r3k3/8/4q3/3N4/8/8/8/6K1 w - - 0 1', [], 'd5c7');
    expect(r.cls).toBe('best');
    expect(r.reasons.join(' ')).toMatch(/Çatal/);
  }, 60000);

  it('sağlam açılış hamlesi iyi sınıfındadır', async () => {
    const r = await review(START, [], 'e2e4');
    expect(['best', 'excellent', 'good']).toContain(r.cls);
    expect(r.trSan).toBe('e4');
  }, 60000);

  it('mat eden hamle', async () => {
    const r = await review('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', [], 'd1d8');
    expect(r.cls).toBe('best');
    expect(r.reasons[0]).toMatch(/Mat!/);
    expect(r.trSan).toBe('Kd8#');
  }, 60000);
});

describe('kademeli ipucu (gerçek motor)', () => {
  it('1: yön, 2: taş, 3: hamle', async () => {
    const fen = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
    const a = await engine.analyze(fen, { depth: 10, multipv: 3 });
    expect(buildHint(fen, a, 1)?.text).toMatch(/Mat var/);
    expect(buildHint(fen, a, 1)?.arrows).toEqual([]);
    expect(buildHint(fen, a, 2)?.marks).toEqual({ d1: 'hint' });
    const h3 = buildHint(fen, a, 3)!;
    expect(h3.text).toContain('Kd8#');
    expect(h3.arrows[0]).toMatchObject({ from: 'd1', to: 'd8', color: 'blue' });
  }, 60000);

  it('bedava taş varken almalara yönlendirir', async () => {
    const fen = '4k3/8/8/4n3/8/5N2/PP6/4K3 w - - 0 1';
    const a = await engine.analyze(fen, { depth: 10, multipv: 3 });
    expect(buildHint(fen, a, 1)?.text).toMatch(/Alabileceğin taşlara bak/);
  }, 60000);
});

describe('tehdit analizi (gerçek motor)', () => {
  it('çoban matı tehdidini görür', async () => {
    const c = new Chess();
    for (const u of ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5']) c.move({ from: u.slice(0, 2), to: u.slice(2, 4) });
    const fen = c.fen();
    const passed = passTurnFen(fen)!;
    const [p, cur] = await Promise.all([engine.analyze(passed, { depth: 10 }), engine.analyze(fen, { depth: 10 })]);
    const t = explainThreat(fen, p, cur);
    expect(t.message).toMatch(/Mat tehdidi/);
    expect(t.arrows[0]).toMatchObject({ from: 'h5', to: 'f7', color: 'orange' });
  }, 60000);

  it('savunmasız taşı ve onu alma tehdidini gösterir', async () => {
    // Siyah at e5 savunmasız, beyaz at f3 saldırıyor; sıra siyahta
    const fen = '4k3/pp6/8/4n3/8/5N2/PP6/4K3 b - - 0 1';
    const passed = passTurnFen(fen)!;
    const [p, cur] = await Promise.all([engine.analyze(passed, { depth: 10 }), engine.analyze(fen, { depth: 10 })]);
    const t = explainThreat(fen, p, cur);
    expect(t.dangerSquares).toContain('e5');
    expect(t.message).toMatch(/atını almak istiyor/);
  }, 60000);
});
