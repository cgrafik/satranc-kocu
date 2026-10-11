import { afterAll, describe, expect, it } from 'vitest';
import { baseTime, fetchRecentGames, ImportError, normalizeUsername, parsePgn, toMeta } from './importer';
import { analyzeGame, topTags } from './gameReview';
import { createNodeEngine } from '../test/nodeEngine';

const PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[White "Rakip123"]
[Black "Benim_Adim"]
[Result "1-0"]
[TimeControl "600"]

1. e4 {[%clk 0:09:58]} 1... e5 {[%clk 0:09:57]} 2. Bc4 {[%clk 0:09:50]} 2... Nc6 {[%clk 0:09:40]} 3. Qh5 {[%clk 0:09:45]} 3... Nf6 {[%clk 0:00:30]} 4. Qxf7# {[%clk 0:09:40]} 1-0`;

const game = (over: Partial<Record<string, unknown>> = {}) => ({
  url: 'https://www.chess.com/game/live/1',
  pgn: PGN,
  end_time: 1790000000,
  time_class: 'rapid',
  time_control: '600',
  rules: 'chess',
  white: { username: 'Rakip123', rating: 650, result: 'win' },
  black: { username: 'Benim_Adim', rating: 610, result: 'checkmated' },
  ...over,
});

function fakeFetch(routes: Record<string, unknown | number>): typeof fetch {
  return (async (url: string) => {
    const r = routes[url];
    if (r === undefined) return new Response('not found', { status: 404 });
    if (typeof r === 'number') return new Response('', { status: r });
    return new Response(JSON.stringify(r), { status: 200 });
  }) as unknown as typeof fetch;
}

describe('chess.com içe aktarma', () => {
  it('kullanıcı adını temizler', () => {
    expect(normalizeUsername('  @Benim_Adim ')).toBe('benim_adim');
    expect(normalizeUsername('https://www.chess.com/member/Benim_Adim')).toBe('benim_adim');
  });

  it('oyunu kullanıcının rengine ve sonucuna göre çevirir', () => {
    const m = toMeta(game() as never, 'benim_adim')!;
    expect(m.myColor).toBe('b');
    expect(m.myResult).toBe('loss');
    expect(m.opponent).toEqual({ username: 'Rakip123', rating: 650 });
    expect(toMeta(game({ black: { username: 'Benim_Adim', rating: 610, result: 'agreed' } }) as never, 'benim_adim')!.myResult).toBe('draw');
  });

  it('standart olmayan varyantları ve başkasının oyunlarını atlar', () => {
    expect(toMeta(game({ rules: 'chess960' }) as never, 'benim_adim')).toBeNull();
    expect(toMeta(game() as never, 'baskasi')).toBeNull();
  });

  it('arşivlerden en yeni oyunları getirir', async () => {
    const f = fakeFetch({
      'https://api.chess.com/pub/player/benim_adim/games/archives': {
        archives: ['https://api.chess.com/pub/player/benim_adim/games/2026/09', 'https://api.chess.com/pub/player/benim_adim/games/2026/10'],
      },
      'https://api.chess.com/pub/player/benim_adim/games/2026/10': {
        games: [game({ url: 'a', end_time: 1 }), game({ url: 'b', end_time: 3 }), game({ url: 'c', rules: 'bughouse' })],
      },
      'https://api.chess.com/pub/player/benim_adim/games/2026/09': { games: [game({ url: 'd', end_time: 0 })] },
    });
    const list = await fetchRecentGames('Benim_Adim', 20, f);
    expect(list.map((g) => g.url)).toEqual(['b', 'a', 'd']);
    expect((await fetchRecentGames('Benim_Adim', 1, f)).map((g) => g.url)).toEqual(['b']);
  });

  it('hatalar Türkçe ve anlaşılır', async () => {
    await expect(fetchRecentGames('yokboylebiri', 20, fakeFetch({}))).rejects.toThrow('hesabı bulunamadı');
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(fetchRecentGames('benim_adim', 20, offline)).rejects.toThrow('İnternet bağlantını');
    await expect(fetchRecentGames('x', 20, fakeFetch({}))).rejects.toBeInstanceOf(ImportError);
  });
});

describe('PGN çözümleme', () => {
  it('hamleleri ve saatleri okur', () => {
    const g = parsePgn(PGN);
    expect(g.moves).toHaveLength(7);
    expect(g.moves[0]).toMatchObject({ uci: 'e2e4', color: 'w', clock: 598 });
    expect(g.moves[5]).toMatchObject({ san: 'Nf6', clock: 30 });
    expect(g.headers.White).toBe('Rakip123');
  });

  it('bozuk PGN anlaşılır hata verir', () => {
    expect(() => parsePgn('1. e4 e5 2. Ke9')).toThrow(ImportError);
    expect(() => parsePgn('[Event "x"]')).toThrow('hamle yok');
  });

  it('süre kontrolü', () => {
    expect(baseTime('600')).toBe(600);
    expect(baseTime('180+2')).toBe(180);
    expect(baseTime('1/86400')).toBeNull();
  });
});

describe('oyun raporu (gerçek motor)', () => {
  const engine = createNodeEngine();
  afterAll(() => engine.terminate());

  it('çoban matı yenen oyunda kritik hatayı ve türünü bulur', async () => {
    const g = parsePgn(PGN);
    const progress: number[] = [];
    const rep = (await analyzeGame(g, 'b', (fen) => engine.analyze(fen, { depth: 10, multipv: 2 }), {
      id: 'test',
      onProgress: (d) => progress.push(d),
    }))!;
    expect(rep.reviews.map((r) => r.ply)).toEqual([1, 3, 5]);
    expect(rep.critical[0]).toBe(5); // 3... Af6??
    const nf6 = rep.reviews.find((r) => r.ply === 5)!;
    expect(nf6.cls).toBe('blunder');
    expect(nf6.tags).toContain('allowedMate');
    expect(nf6.tags).toContain('timePressure'); // 30 sn kalmıştı (600'ün %10'undan az)
    expect(rep.tags.allowedMate).toBe(1);
    expect(progress.at(-1)).toBeGreaterThan(0);
    expect(topTags([rep])[0].tag).toBe('allowedMate');
  }, 60000);

  it('iptal edilince null döner', async () => {
    const rep = await analyzeGame(parsePgn(PGN), 'b', (fen) => engine.analyze(fen, { depth: 6 }), { id: 'x', isCancelled: () => true });
    expect(rep).toBeNull();
  });
});
