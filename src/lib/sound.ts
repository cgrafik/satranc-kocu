// Basit hamle sesleri (WebAudio ile üretilir, dosya gerekmez).
let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(v: boolean) {
  enabled = v;
}

function tone(freq: number, dur: number, gain = 0.15, type: OscillatorType = 'triangle') {
  if (!enabled) return;
  try {
    ctx ??= new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + dur);
  } catch {
    /* ses desteklenmiyor */
  }
}

export function playMoveSound(kind: 'move' | 'capture' | 'check' | 'end') {
  if (kind === 'move') tone(520, 0.07);
  else if (kind === 'capture') {
    tone(300, 0.09, 0.2, 'square');
  } else if (kind === 'check') {
    tone(880, 0.12, 0.15);
  } else {
    tone(440, 0.25, 0.15, 'sine');
    setTimeout(() => tone(660, 0.3, 0.15, 'sine'), 160);
  }
}

export function soundForSan(san: string, over: boolean) {
  if (over) return playMoveSound('end');
  if (san.includes('+')) return playMoveSound('check');
  if (san.includes('x')) return playMoveSound('capture');
  playMoveSound('move');
}
