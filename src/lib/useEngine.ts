import { useEffect, useState } from 'react';
import { Engine, workerTransport, type EngineStatus } from './engine';

// Uygulama genelinde tek motor örneği.
let shared: Engine | null = null;

export function getEngine(): Engine {
  shared ??= new Engine(() => workerTransport());
  return shared;
}

export function useEngine() {
  const engine = getEngine();
  const [status, setStatus] = useState<EngineStatus>(engine.status);
  useEffect(() => {
    const off = engine.onStatus(setStatus);
    engine.init().catch(() => {
      /* durum 'error' olarak yayınlanır */
    });
    return () => {
      off();
    };
  }, [engine]);
  return { engine, status, error: engine.lastError };
}

/** Koç analizleri için ortak ayar: yeterince derin ama mobilde de hızlı. */
export const COACH_OPTS = { depth: 12, multipv: 3, movetime: 2500, timeoutMs: 6000 } as const;
export const AFTER_OPTS = { depth: 12, multipv: 1, movetime: 2500, timeoutMs: 6000 } as const;
