import { useEffect, useState } from 'react';

// Yalnızca bu tarayıcıda saklanan ayarlar (hiçbir yere gönderilmez).
export function loadLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export function saveLocal(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* gizli sekme vb. */
  }
}

export function usePersistent<T extends object>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => loadLocal(key, fallback));
  useEffect(() => saveLocal(key, value), [key, value]);
  return [value, setValue] as const;
}
