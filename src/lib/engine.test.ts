import { afterAll, describe, expect, it } from 'vitest';
import { Engine, EngineError, type EngineTransport } from './engine';
import { createNodeEngine } from '../test/nodeEngine';

/** Sahte motor: verilen fonksiyonla komutlara cevap verir. */
function fakeTransport(respond: (cmd: string, emit: (l: string) => void) => void): () => EngineTransport {
  return () => {
    let cb: (l: string) => void = () => {};
    return {
      post: (cmd) => queueMicrotask(() => respond(cmd, cb)),
      onLine: (fn) => {
        cb = fn;
      },
      terminate: () => {},
    };
  };
}

const basic = (cmd: string, emit: (l: string) => void) => {
  if (cmd === 'uci') emit('uciok');
  if (cmd === 'isready') emit('readyok');
};

describe('Engine (sahte motor)', () => {
  it('motor başlatılamazsa hata verir, uygulama çökmez', async () => {
    const e = new Engine(() => {
      throw new Error('Worker desteklenmiyor');
    });
    await expect(e.analyze('8/8/8/8/8/8/8/K6k w - - 0 1')).rejects.toBeInstanceOf(EngineError);
    expect(e.status).toBe('error');
    expect(e.lastError).toContain('Motor başlatılamadı');
  });

  it('uciok gelmezse zaman aşımıyla hata verir', async () => {
    const e = new Engine(fakeTransport(() => {}), 50);
    await expect(e.init()).rejects.toThrow(/yanıt gelmedi/);
    expect(e.status).toBe('error');
  });

  it('arama zaman aşımında stop gönderir ve kısmi sonucu döndürür', async () => {
    const sent: string[] = [];
    const e = new Engine(
      fakeTransport((cmd, emit) => {
        sent.push(cmd);
        basic(cmd, emit);
        if (cmd.startsWith('go')) emit('info depth 3 multipv 1 score cp 25 pv e2e4 e7e5');
        if (cmd === 'stop') emit('bestmove e2e4');
      }),
    );
    const a = await e.analyze('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', { timeoutMs: 30 });
    expect(sent).toContain('stop');
    expect(a.partial).toBe(true);
    expect(a.bestMove).toBe('e2e4');
    expect(a.lines[0].score).toEqual({ type: 'cp', value: 25 });
  });

  it('motor stop komutuna da cevap vermezse hata verir ve yeniden başlatılabilir', async () => {
    let starts = 0;
    let hang = true;
    const e = new Engine(() => {
      starts++;
      return fakeTransport((cmd, emit) => {
        basic(cmd, emit);
        if (cmd.startsWith('go') && !hang) {
          emit('info depth 1 score cp 0 pv a2a3');
          emit('bestmove a2a3');
        }
      })();
    });
    await expect(e.analyze('8/8/8/8/8/8/P7/K6k w - - 0 1', { timeoutMs: 20 })).rejects.toThrow(/zaman aşımı/);
    hang = false;
    const a = await e.analyze('8/8/8/8/8/8/P7/K6k w - - 0 1', { timeoutMs: 1000 });
    expect(a.bestMove).toBe('a2a3');
    expect(starts).toBe(2);
  }, 10000);

  it('aynı pozisyonu önbellekten döndürür', async () => {
    let gos = 0;
    const e = new Engine(
      fakeTransport((cmd, emit) => {
        basic(cmd, emit);
        if (cmd.startsWith('go')) {
          gos++;
          emit('info depth 10 score cp 10 pv e2e4');
          emit('bestmove e2e4');
        }
      }),
    );
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    await e.analyze(fen, { depth: 10 });
    await e.analyze(fen, { depth: 10 });
    expect(gos).toBe(1);
    await e.analyze(fen, { depth: 11 });
    expect(gos).toBe(2);
  });

  it('aynı etiketli yeni istek eski bekleyen isteği iptal eder, diğerlerine dokunmaz', async () => {
    const e = new Engine(
      fakeTransport((cmd, emit) => {
        basic(cmd, emit);
        if (cmd.startsWith('go')) {
          emit('info depth 5 score cp 1 pv a2a3');
          emit('bestmove a2a3');
        }
      }),
    );
    const review = e.analyze('8/8/8/8/8/8/P7/K6k w - - 0 1', { depth: 5 });
    const live1 = e.analyze('8/8/8/8/8/8/P7/K5k1 w - - 0 1', { depth: 5, tag: 'live' });
    const live2 = e.analyze('8/8/8/8/8/8/P7/K4k2 w - - 0 1', { depth: 5, tag: 'live' });
    await expect(live1).rejects.toThrow('İptal edildi');
    await expect(review).resolves.toMatchObject({ bestMove: 'a2a3' });
    await expect(live2).resolves.toMatchObject({ fen: '8/8/8/8/8/8/P7/K4k2 w - - 0 1' });
  });

  it('istekleri sırayla işler', async () => {
    const e = new Engine(
      fakeTransport((cmd, emit) => {
        basic(cmd, emit);
        if (cmd.startsWith('go')) {
          emit('info depth 5 score cp 1 pv a2a3');
          emit('bestmove a2a3');
        }
      }),
    );
    const fens = ['8/8/8/8/8/8/P7/K6k w - - 0 1', '8/8/8/8/8/8/P7/K5k1 w - - 0 1', '8/8/8/8/8/8/P7/K4k2 w - - 0 1'];
    const res = await Promise.all(fens.map((f) => e.analyze(f)));
    expect(res.map((r) => r.fen)).toEqual(fens);
  });
});

describe('Engine (gerçek Stockfish 19 lite)', () => {
  const engine = createNodeEngine();
  afterAll(() => engine.terminate());

  it('1 hamlede matı bulur', async () => {
    // Arka yatay matı: Kd8#
    const a = await engine.analyze('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', { depth: 10 });
    expect(a.bestMove).toBe('d1d8');
    expect(a.lines[0].score).toEqual({ type: 'mate', value: 1 });
    expect(a.lines[0].wdl).toBeDefined();
  }, 30000);

  it('MultiPV ile birden çok aday döndürür', async () => {
    const a = await engine.analyze('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', { depth: 8, multipv: 3 });
    expect(a.lines).toHaveLength(3);
    expect(new Set(a.lines.map((l) => l.pv[0])).size).toBe(3);
  }, 30000);

  it('mat olmuş pozisyonda bestmove (none)', async () => {
    const a = await engine.analyze('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3', { depth: 5 });
    expect(a.bestMove).toBeNull();
  }, 30000);
});
