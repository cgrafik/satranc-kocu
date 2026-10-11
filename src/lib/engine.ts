// Stockfish'i UCI üzerinden kullanan sarmalayıcı.
// - Komutlar sıraya alınır (tek motor, tek arama).
// - Zaman aşımında "stop" gönderilir; motor yine cevap vermezse yeniden başlatılır.
// - Sonuçlar FEN + ayar bazında önbelleğe alınır.
// - Motor açılamazsa hata fırlatılır; arayüz bunu kullanıcıya bildirir, çökmez.
import { parseBestMove, parseInfo, type PvLine } from './uci';

export interface EngineTransport {
  post(cmd: string): void;
  onLine(cb: (line: string) => void): void;
  terminate(): void;
}

export interface AnalyzeOptions {
  depth?: number;
  movetime?: number;
  multipv?: number;
  /** Bu süre içinde bestmove gelmezse arama durdurulur. */
  timeoutMs?: number;
  /** Önbelleği atla. */
  noCache?: boolean;
  /** Aynı etiketli yeni istek gelince bekleyen/süren eski istek iptal edilir (ör. 'live'). */
  tag?: string;
}

export interface Analysis {
  fen: string;
  /** multipv sırasına göre (1 = en iyi). Skorlar hamle sırasındaki tarafın bakışındadır. */
  lines: PvLine[];
  bestMove: string | null;
  depth: number;
  /** Zaman aşımı nedeniyle yarıda kesildiyse true (sonuçlar yine de kullanılabilir). */
  partial: boolean;
}

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error';

export class EngineError extends Error {}

interface Job {
  fen: string;
  opts: Required<Pick<AnalyzeOptions, 'multipv'>> & AnalyzeOptions;
  resolve: (a: Analysis) => void;
  reject: (e: Error) => void;
}

const DEFAULT_TIMEOUT = 8000;
const CACHE_LIMIT = 400;

export class Engine {
  status: EngineStatus = 'idle';
  lastError: string | null = null;
  private transport: EngineTransport | null = null;
  private listeners = new Set<(l: string) => void>();
  private queue: Job[] = [];
  private running = false;
  private currentMultipv = 1;
  private cache = new Map<string, Analysis>();
  private initPromise: Promise<void> | null = null;
  private statusListeners = new Set<(s: EngineStatus) => void>();
  private readonly createTransport: () => EngineTransport;
  private readonly initTimeoutMs: number;

  constructor(createTransport: () => EngineTransport, initTimeoutMs = 15000) {
    this.createTransport = createTransport;
    this.initTimeoutMs = initTimeoutMs;
  }

  onStatus(cb: (s: EngineStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  private setStatus(s: EngineStatus, err?: string | null) {
    this.status = s;
    if (err !== undefined) this.lastError = err;
    this.statusListeners.forEach((cb) => cb(s));
  }

  init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.setStatus('loading');
    this.initPromise = (async () => {
      try {
        this.transport = this.createTransport();
        this.transport.onLine((line) => this.listeners.forEach((l) => l(line)));
      } catch (e) {
        throw this.fail(`Motor başlatılamadı: ${(e as Error).message}`);
      }
      await this.waitFor('uci', (l) => l === 'uciok', this.initTimeoutMs);
      this.send('setoption name UCI_ShowWDL value true');
      await this.ready(this.initTimeoutMs);
      this.currentMultipv = 1;
      this.setStatus('ready', null);
    })().catch((e) => {
      this.initPromise = null;
      this.teardown();
      if (this.status !== 'error') this.setStatus('error', `Motor başlatılamadı: ${(e as Error).message}`);
      throw e instanceof EngineError ? e : new EngineError(this.lastError ?? 'Motor başlatılamadı');
    });
    return this.initPromise;
  }

  analyze(fen: string, options: AnalyzeOptions = {}): Promise<Analysis> {
    const opts = { multipv: 1, ...options };
    const key = cacheKey(fen, opts);
    if (!opts.noCache) {
      const hit = this.cache.get(key);
      if (hit) {
        // LRU: en sona taşı
        this.cache.delete(key);
        this.cache.set(key, hit);
        return Promise.resolve(hit);
      }
    }
    if (opts.tag) {
      const stale = this.queue.filter((j) => j.opts.tag === opts.tag);
      this.queue = this.queue.filter((j) => j.opts.tag !== opts.tag);
      stale.forEach((j) => j.reject(new EngineError('İptal edildi')));
      if (this.currentTag === opts.tag) this.stopCurrent?.();
    }
    return new Promise<Analysis>((resolve, reject) => {
      this.queue.push({ fen, opts, resolve, reject });
      void this.pump();
    });
  }

  /** Kuyruğu boşaltır ve süren aramayı durdurur (süren arama kısmi sonuçla döner, önbelleğe alınmaz). */
  interrupt() {
    this.clearQueue();
    this.stopCurrent?.();
  }

  private stopCurrent: (() => void) | null = null;
  private currentTag: string | undefined;

  /** Sıradaki (henüz başlamamış) işleri iptal eder. */
  clearQueue() {
    const q = this.queue;
    this.queue = [];
    q.forEach((j) => j.reject(new EngineError('İptal edildi')));
  }

  terminate() {
    this.clearQueue();
    this.teardown();
    this.initPromise = null;
    this.setStatus('idle');
  }

  private async pump() {
    if (this.running) return;
    const job = this.queue.shift();
    if (!job) return;
    this.running = true;
    this.currentTag = job.opts.tag;
    try {
      await this.init();
      const result = await this.run(job);
      const key = cacheKey(job.fen, job.opts);
      if (!result.partial) {
        this.cache.set(key, result);
        if (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
      }
      job.resolve(result);
    } catch (e) {
      job.reject(e as Error);
    } finally {
      this.running = false;
      this.currentTag = undefined;
      void this.pump();
    }
  }

  private run(job: Job): Promise<Analysis> {
    const { fen, opts } = job;
    if (opts.multipv !== this.currentMultipv) {
      this.send(`setoption name MultiPV value ${opts.multipv}`);
      this.currentMultipv = opts.multipv;
    }
    this.send(`position fen ${fen}`);
    const lines = new Map<number, PvLine>();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;

    return new Promise<Analysis>((resolve, reject) => {
      let partial = false;
      let hardTimer: ReturnType<typeof setTimeout> | undefined;
      const softTimer = setTimeout(() => {
        partial = true;
        this.send('stop');
        hardTimer = setTimeout(() => {
          cleanup();
          // Motor kilitlendi: kapat, bir sonraki istekte yeniden başlatılacak.
          this.teardown();
          this.initPromise = null;
          reject(this.fail('Motor yanıt vermedi (zaman aşımı). Yeniden başlatılacak.'));
        }, 1500);
      }, timeoutMs);

      const listener = (line: string) => {
        const info = parseInfo(line);
        if (info) {
          // Sınır skorları (lowerbound/upperbound) kesin değildir; önceki tam skoru koru.
          if (!info.bound || !lines.has(info.multipv)) lines.set(info.multipv, info);
          return;
        }
        const bm = parseBestMove(line);
        if (bm) {
          cleanup();
          const sorted = [...lines.values()]
            .filter((l) => l.multipv <= opts.multipv)
            .sort((a, b) => a.multipv - b.multipv);
          resolve({
            fen,
            lines: sorted,
            bestMove: bm.best,
            depth: sorted[0]?.depth ?? 0,
            partial,
          });
        }
      };
      this.stopCurrent = () => {
        partial = true;
        this.send('stop');
      };
      const cleanup = () => {
        this.stopCurrent = null;
        clearTimeout(softTimer);
        if (hardTimer) clearTimeout(hardTimer);
        this.listeners.delete(listener);
      };
      this.listeners.add(listener);

      const parts = ['go'];
      if (opts.depth) parts.push('depth', String(opts.depth));
      if (opts.movetime) parts.push('movetime', String(opts.movetime));
      if (!opts.depth && !opts.movetime) parts.push('depth', '12');
      this.send(parts.join(' '));
    });
  }

  private ready(timeoutMs: number) {
    return this.waitFor('isready', (l) => l === 'readyok', timeoutMs);
  }

  private waitFor(cmd: string, match: (l: string) => boolean, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.listeners.delete(l);
        reject(new EngineError(`'${cmd}' komutuna yanıt gelmedi`));
      }, timeoutMs);
      const l = (line: string) => {
        if (line.startsWith('__error__')) {
          clearTimeout(t);
          this.listeners.delete(l);
          reject(new EngineError(line.slice(10) || 'motor dosyası yüklenemedi'));
          return;
        }
        if (match(line.trim())) {
          clearTimeout(t);
          this.listeners.delete(l);
          resolve();
        }
      };
      this.listeners.add(l);
      try {
        this.send(cmd);
      } catch (e) {
        clearTimeout(t);
        this.listeners.delete(l);
        reject(e as Error);
      }
    });
  }

  private send(cmd: string) {
    if (!this.transport) throw new EngineError('Motor çalışmıyor');
    this.transport.post(cmd);
  }

  private teardown() {
    try {
      this.transport?.terminate();
    } catch {
      /* zaten kapalı */
    }
    this.transport = null;
    this.listeners.clear();
  }

  private fail(msg: string): EngineError {
    this.setStatus('error', msg);
    return new EngineError(msg);
  }
}

function cacheKey(fen: string, o: AnalyzeOptions & { multipv: number }) {
  return `${fen}|d${o.depth ?? ''}|t${o.movetime ?? ''}|m${o.multipv}`;
}

/** Tarayıcı için Web Worker taşıyıcısı. */
export function workerTransport(url = `${import.meta.env.BASE_URL}engine/stockfish-19-lite-single.js`): EngineTransport {
  const worker = new Worker(url);
  let cb: ((line: string) => void) | null = null;
  worker.onmessage = (ev: MessageEvent) => {
    const data = typeof ev.data === 'string' ? ev.data : String(ev.data ?? '');
    for (const line of data.split('\n')) if (line) cb?.(line);
  };
  worker.onerror = (ev) => {
    cb?.(`__error__ ${ev.message ?? 'worker error'}`);
  };
  return {
    post: (cmd) => worker.postMessage(cmd),
    onLine: (fn) => {
      cb = fn;
    },
    terminate: () => worker.terminate(),
  };
}
