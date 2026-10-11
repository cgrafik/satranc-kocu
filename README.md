# Satranç Koçu

Türkçe, tarayıcıda çalışan kişisel satranç antrenörü. Hedef kitle: **chess.com'da 400–900 puan** arası oyuncular. Bu seviyede oyunları en çok belirleyen şeyler bedava taş bırakmak, rakibin tehdidini görmemek ve basit taktikleri kaçırmak. Uygulama önce bunlara odaklanıyor.

## Çalıştırma

```bash
npm install        # Stockfish dosyalarını public/engine altına da kopyalar
npm run dev        # http://localhost:5173
npm test           # birim + motor + arayüz testleri
npm run build      # dist/ — herhangi bir statik hostta çalışır
npm run calibrate  # bot seviyelerini birbirine karşı oynatır (yavaş, ~1 dk)
```

Sunucu, API anahtarı ya da ücretli servis gerekmez. Motor kullanıcının tarayıcısında çalışır.

## Mimari

| Katman | Dosya | Görev |
|---|---|---|
| Kurallar | `chess.js` + `src/lib/game.ts` | Yasal hamle, şah/mat/pat, rok, geçerken alma, terfi |
| Motor | `src/lib/engine.ts` | Stockfish 19 lite (WASM, Web Worker) ile UCI. Kuyruk, zaman aşımı, yeniden başlatma, önbellek, etiketli iptal |
| Ayrıştırma | `src/lib/uci.ts`, `evaluation.ts` | `info`/`bestmove` satırları, bakış açısı, kazanma yüzdesi |
| Statik taktik | `src/lib/tactics.ts` | Savunmasız taş, çatal, malzeme hesabı, Türkçe notasyon (Ş V K F A) |
| Koç | `src/lib/coach.ts` | Hamle sınıflandırma, Türkçe "Neden?" açıklamaları, tehdit analizi, kademeli ipucu |
| Rakip | `src/lib/bot.ts` | 5 seviye. Düşük derinlik + MultiPV + olasılıklı seçim |
| Arayüz | `src/components/Board.tsx` | chess.com tarzı tahta: tıklayınca yasal kareler, sürükle-bırak, oklar, terfi |
| Modlar | `src/modes/PlayMode.tsx`, `AnalysisMode.tsx` | Eğitmenle maç, serbest analiz |

### Hamle sınıflandırması

Hamleyi yapan tarafın kazanma yüzdesindeki kayba göre sınıflandırılır. Kazanma yüzdesi, Lichess'in yayımladığı santipiyon→yüzde dönüşümüyle hesaplanır.

| Kayıp | Sınıf |
|---|---|
| ≤ 1 | En iyi hamle |
| ≤ 3 | Çok iyi hamle |
| ≤ 6 | İyi hamle |
| ≤ 10 | Doğal fakat daha zayıf |
| ≤ 18 | Hata |
| > 18 | Büyük hata |

İki özel durum vardır:
- En iyi hamle malzeme ya da mat kazandırıyorsa, oynanan hamle konumu da çökertmediyse sınıf **"Kritik fırsat kaçtı"** olur.
- Rakibe mat imkânı veren hamle her zaman **"Büyük hata"** sayılır.

### Bot seviyeleri ve kalibrasyon

Stockfish'in kendi `UCI_Elo` ayarı en düşük 1320'ye iniyor; bu, 400–900 bandı için fazla güçlü. Bu yüzden bot şöyle zayıflatılıyor: motorun aday hamleleri arasından puan farkına göre olasılıklı seçim yapıyor ve ara sıra rastgele hamle oynuyor.

`npm run calibrate` ile yapılan bot-vs-bot turnuvasında (20 oyun) her seviye bir alttakini yendi:

| Eşleşme | Skor |
|---|---|
| Kolay – Başlangıç | 19.5/20 |
| Orta – Kolay | 18/20 |
| İleri – Orta | 18.5/20 |
| Usta – İleri | 20/20 |

Seviyelerin sıralaması doğrulandı. Arayüzdeki "≈ 400/600/800" etiketleri ise **tahmindir**; insanlara karşı ölçülmediği için chess.com puanıyla birebir eşleşmez.

## Lisanslar

- Stockfish.js 19: GPL-3.0. Lisans metni `public/engine/STOCKFISH-LICENSE-GPL3.txt` olarak dağıtılır ve uygulamanın alt bilgisinden bağlantı verilir. Uygulama Stockfish ile birlikte dağıtıldığı için dağıtılan paket GPL-3.0 koşullarına tabidir; kaynak kodun da sunulması gerekir.
- chess.js: BSD-2-Clause. react-chessboard (yalnızca taş SVG'leri): MIT.

## Gizlilik

Ayarlar ve devam eden oyun yalnızca tarayıcının `localStorage`'ında tutulur. Hiçbir veri dış servise gönderilmez.
