// Koç: gerçek motorla 400–900 seviyesinin tipik hata senaryoları.
import { afterAll, describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { advise, buildQuiz, classify, explainQuizChoice, explainThreat, QUIZ_OPTS, reviewMove, tacticalHint } from './coach';
import { seededRng } from './bot';
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
    expect(r.reasons[0]).toBe("Bu hamle rakibe mat imkânı veriyor: Rakip veziriyle f7'deki piyonunu alır — bu mat!");
    expect(r.refutation?.text).toBe("Rakip veziriyle f7'deki piyonunu alır — bu mat!");
    expect(r.playedText).toBe("Atını g8'den f6'ya götürdün");
    expect(r.afterArrows[0]).toMatchObject({ from: 'h5', to: 'f7', color: 'red' });
    expect(r.best).toBeDefined();
  }, 60000);

  it('veziri savunmasız kareye götürmek: taş kaybı açıklanır', async () => {
    // 1.e4 e5 2.Af3 Vg5?? 3.Axg5
    const r = await review(START, ['e2e4', 'e7e5', 'g1f3'], 'd8g5');
    expect(r.cls).toBe('blunder');
    expect(r.reasons[0]).toBe("Vezirini savunmasız bir kareye götürdün. Rakip atıyla g5'teki vezirini alır.");
    expect(r.dangerSquares).toContain('g5');
  }, 60000);

  it('bedava taşı almamak: kritik fırsat kaçtı', async () => {
    const r = await review('4k3/8/8/4n3/8/5N2/PP6/4K3 w - - 0 1', [], 'a2a3');
    expect(['missed', 'mistake', 'blunder']).toContain(r.cls);
    expect(r.best?.uci).toBe('f3e5');
    expect(r.reasons.join(' ')).toMatch(/Bunun yerine: Atınla f3'ten e5'teki atı al\. E5'teki at korumasızdı/);
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
    expect(r.playedText).toBe("Piyonunu e2'den e4'e sürdün");
  }, 60000);

  it('mat eden hamle', async () => {
    const r = await review('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', [], 'd1d8');
    expect(r.cls).toBe('best');
    expect(r.reasons[0]).toMatch(/Mat!/);
    expect(r.trSan).toBe('Kd8#');
  }, 60000);
});

describe('"Ne oynamalıyım?" önerisi (gerçek motor)', () => {
  it('mat varsa direkt mat hamlesini söyler', async () => {
    const fen = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
    const a = await engine.analyze(fen, { depth: 10, multipv: 3 });
    const adv = advise(fen, a)!;
    expect(adv.text).toBe("Kaleni d1'den d8'e götür — bu mat!");
    expect(adv.reasons[0]).toBe('Bu hamle hemen mat eder!');
    expect(adv.arrows[0]).toMatchObject({ from: 'd1', to: 'd8', color: 'green' });
  }, 60000);

  it('bedava taşı almayı söyler ve nedenini açıklar', async () => {
    const fen = '4k3/8/8/4n3/8/5N2/PP6/4K3 w - - 0 1';
    const a = await engine.analyze(fen, { depth: 10, multipv: 3 });
    const adv = advise(fen, a)!;
    expect(adv.text).toBe("Atınla f3'ten e5'teki atı al");
    expect(adv.reasons[0]).toBe("E5'teki at korumasız; bedava alırsın.");
    expect(adv.alternatives.length).toBe(2);
  }, 60000);

  it('rakip bir şey yaptıktan sonra cevabı söyler (karşı hamle)', async () => {
    // 1.e4 e5 2.Af3 → rakip (beyaz) e5'e saldırdı; siyahın en iyi cevabı piyonu korumak
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';
    const a = await engine.analyze(fen, { depth: 12, multipv: 3 });
    const adv = advise(fen, a)!;
    expect(adv.text).toMatch(/^(Atını|Piyonunu)/);
    expect(adv.reasons.length).toBeGreaterThan(0);
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
    expect(t.message).toBe("Dikkat! Rakip atıyla e5'teki atını alabilir.");
    // Motor burada atı kaçırmak yerine Axf3+ ile karşı atı alıyor; öneri düz cümle olmalı
    expect(t.advice).toMatch(/^Atın(ı|la) e5'ten/);
  }, 60000);
});

describe('tahmin sorusu (gerçek motor)', () => {
  it('bedava taş konumunda: en iyi + iki zayıf seçenek, karışık sırada', async () => {
    const fen = '4k3/8/8/4n3/8/5N2/PP6/4K3 w - - 0 1';
    const a = await engine.analyze(fen, QUIZ_OPTS);
    const q = buildQuiz(fen, a, seededRng(3))!;
    expect(q).not.toBeNull();
    expect(q.options.map((o) => o.letter)).toEqual(['A', 'B', 'C']);
    expect(q.options.filter((o) => o.correct)).toHaveLength(1);
    expect(q.options.find((o) => o.correct)!.uci).toBe('f3e5');
    expect(new Set(q.options.map((o) => o.uci)).size).toBe(3);
    for (const o of q.options) expect(o.text).not.toMatch(/\b[KQRBN][a-h][1-8]/);
    // yanlış seçimin açıklaması
    const wrong = q.options.find((o) => !o.correct)!;
    const c = new Chess(fen);
    c.move({ from: wrong.uci.slice(0, 2), to: wrong.uci.slice(2, 4) });
    const after = await engine.analyze(c.fen(), { depth: 12 });
    const why = explainQuizChoice(fen, a, wrong.uci, after);
    expect(why.join(' ')).toMatch(/En iyi hamlenin faydası/);
    // doğru seçimin açıklaması
    expect(explainQuizChoice(fen, a, 'f3e5', null)[0]).toMatch(/korumasız/);
  }, 60000);

  it('tek mantıklı hamle yoksa (seçenekler çok yakınsa) soru üretmez', async () => {
    // Sadece şah hamleleri olan, hepsi berabere bir konum
    const fen = '8/8/8/4k3/8/8/8/4K3 w - - 0 1';
    const a = await engine.analyze(fen, QUIZ_OPTS);
    expect(buildQuiz(fen, a)).toBeNull();
  }, 60000);
});
describe('sadece ipucu (gerçek motor)', () => {
  // İpucu hamleyi, kare adını ya da notasyonu ele vermemeli
  const leaks = (s: string) => /[a-h][1-8]|götür|\bsür\b|\bal\b|Atını|Filini|Kaleni|Vezirini/.test(s);

  it('çatal fırsatını bölgesiyle söyler, hamleyi söylemez', async () => {
    const fen = 'r3k3/8/4q3/3N4/8/8/8/6K1 w - - 0 1';
    const h = tacticalHint(fen, await engine.analyze(fen, { depth: 12, multipv: 3 }))!;
    expect(h.motif).toBe('fork');
    expect(h.text).toBe('Merkezde bir çatal fırsatı var, taşların dizilimine dikkat et.');
    expect(leaks(h.text + h.detail)).toBe(false);
    expect(h.reveal?.uci).toBe('d5c7');
  }, 60000);

  it('mat fırsatı', async () => {
    const fen = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
    const h = tacticalHint(fen, await engine.analyze(fen, { depth: 10, multipv: 3 }))!;
    expect(h.motif).toBe('mate');
    expect(h.text).toBe('Tek hamlede mat var!');
    expect(leaks(h.text + h.detail)).toBe(false);
  }, 60000);

  it('korumasız taş', async () => {
    const fen = '4k3/8/8/4n3/8/5N2/PP6/4K3 w - - 0 1';
    const h = tacticalHint(fen, await engine.analyze(fen, { depth: 10, multipv: 3 }))!;
    expect(h.motif).toBe('freePiece');
    expect(h.text).toBe('Merkezde korumasız bir rakip taş var.');
    expect(leaks(h.text + h.detail)).toBe(false);
  }, 60000);

  it('ipucu her zaman motorun EN İYİ hamlesine dayanır', async () => {
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';
    const a = await engine.analyze(fen, { depth: 12, multipv: 3 });
    for (let i = 0; i < 20; i++) expect(tacticalHint(fen, a)!.reveal!.uci).toBe(a.lines[0].pv[0]);
  }, 60000);
});