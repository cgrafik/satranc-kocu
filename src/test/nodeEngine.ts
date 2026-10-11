// Testlerde gerçek Stockfish'i (aynı lite-single WASM motoru) Node.js içinde çalıştırır.
import { createRequire } from 'node:module';
import { Engine, type EngineTransport } from '../lib/engine';

const require = createRequire(import.meta.url);

export function nodeTransport(): EngineTransport {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const init = require('stockfish') as (kind: string, cb: (line: string) => void) => {
    processCommand(cmd: string): void;
    terminate(): void;
  };
  let cb: ((line: string) => void) | null = null;
  const pending: string[] = [];
  const engine = init('lite-single', (line: string) => {
    if (cb) cb(line);
    else pending.push(line);
  });
  return {
    post: (cmd) => engine.processCommand(cmd),
    onLine: (fn) => {
      cb = fn;
      pending.splice(0).forEach(fn);
    },
    terminate: () => engine.terminate(),
  };
}

export function createNodeEngine() {
  return new Engine(nodeTransport, 30000);
}
