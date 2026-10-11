// Motor skorlarını yorumlama: bakış açısı çevirme, kazanma yüzdesi, metin.
import type { Score } from './uci';

export type Side = 'w' | 'b';

/** Skoru (hamle sırasındaki taraf bakışından) istenen tarafın bakışına çevirir. */
export function scoreFor(score: Score, sideToMove: Side, perspective: Side): Score {
  if (sideToMove === perspective) return score;
  return { type: score.type, value: -score.value } as Score;
}

/** Mat skorlarını karşılaştırılabilir sayıya çevirir (yakın mat daha büyük). */
export function scoreToNumber(score: Score): number {
  if (score.type === 'cp') return score.value;
  if (score.value === 0) return -100000; // mat olmuş taraf
  return score.value > 0 ? 100000 - score.value * 100 : -100000 - score.value * 100;
}

/**
 * Lichess'in yayımladığı santipiyon → kazanma ihtimali dönüşümü
 * (lila: WinPercent.fromCentiPawns, katsayı 0.00368208).
 * 0–100 aralığında, skorun sahibi açısından "beklenen puan" yüzdesidir.
 * Not: Bu güçlü oyuncu oyunlarına göre kalibre edilmiştir; 400–900 seviyesinde
 * gerçek sonuç çok daha belirsizdir. Sınıflandırma için tutarlı bir ölçü olarak kullanılır.
 */
export function winPercent(score: Score): number {
  if (score.type === 'mate') {
    if (score.value === 0) return 0;
    return score.value > 0 ? 100 : 0;
  }
  const cp = Math.max(-1000, Math.min(1000, score.value));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

/** "+1.4", "-0.3", "M3", "-M2" (beyaz bakış açısı verilmişse ona göre). */
export function formatScore(score: Score): string {
  if (score.type === 'mate') {
    if (score.value === 0) return '#';
    return `${score.value > 0 ? '' : '-'}M${Math.abs(score.value)}`;
  }
  const v = score.value / 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
}

/** Beyaz bakışından skoru sade Türkçe ile anlatır. */
export function describeScore(whiteScore: Score): string {
  if (whiteScore.type === 'mate') {
    if (whiteScore.value === 0) return 'Mat.';
    const side = whiteScore.value > 0 ? 'Beyaz' : 'Siyah';
    return `${side} ${Math.abs(whiteScore.value)} hamlede mat edebilir.`;
  }
  const cp = whiteScore.value;
  const abs = Math.abs(cp);
  const side = cp > 0 ? 'Beyaz' : 'Siyah';
  if (abs < 50) return 'Pozisyon yaklaşık eşit.';
  if (abs < 150) return `${side} biraz daha iyi.`;
  if (abs < 300) return `${side} açıkça daha iyi (yaklaşık ${(abs / 100).toFixed(1)} piyon fazlası kadar).`;
  return `${side} kazanan durumda (yaklaşık ${(abs / 100).toFixed(1)} piyon değerinde üstünlük).`;
}
