// Tahmin sorusu ayarları ve skoru (yalnızca bu tarayıcıda).
import { loadLocal } from './usePersistent';

/** off: hep cevabı söyle · sometimes/always: 3 şıklı soru · hint: sadece taktik ipucu, hamleyi söyleme */
export type QuizMode = 'off' | 'sometimes' | 'always' | 'hint';
export const QUIZ_MODE_KEY = 'sk.quiz.mode';
export const QUIZ_STATS_KEY = 'sk.quiz.stats';

export function getQuizMode(): QuizMode {
  return loadLocal<{ mode: QuizMode }>(QUIZ_MODE_KEY, { mode: 'sometimes' }).mode;
}

/** "Bazen" modunda yaklaşık her iki sorudan birinde tahmin sorusu sorulur. */
export function shouldQuiz(mode: QuizMode, rng: () => number = Math.random): boolean {
  return mode === 'always' || (mode === 'sometimes' && rng() < 0.5);
}

export function getQuizStats(): { right: number; total: number } {
  return loadLocal(QUIZ_STATS_KEY, { right: 0, total: 0 });
}

/** Önerileri yeni başlayan seviyesine göre basitleştir (varsayılan açık). */
export const SIMPLE_KEY = 'sk.coach.simple';

export function getSimple(): boolean {
  return loadLocal<{ on: boolean }>(SIMPLE_KEY, { on: true }).on;
}
