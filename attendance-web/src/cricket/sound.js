/**
 * Every sound of the theme, made on the spot: no audio files to download. All
 * short and quiet, and the Sounds switch in Ground settings silences the lot.
 */
let ctx = null
let noiseBuf = null

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    ctx = new AC()
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const data = noiseBuf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

function noise(c, { at = 0, dur, freq, q = 1, type = 'bandpass', vol, attack = 0.003 }) {
  const src = c.createBufferSource()
  src.buffer = noiseBuf
  src.loop = true
  const filter = c.createBiquadFilter()
  filter.type = type
  filter.frequency.value = freq
  filter.Q.value = q
  const g = c.createGain()
  const t = c.currentTime + at
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(vol, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(filter).connect(g).connect(c.destination)
  src.start(t, Math.random() * 0.5)
  src.stop(t + dur + 0.02)
}

function tone(c, { at = 0, dur, freq, to, vol, type = 'sine' }) {
  const o = c.createOscillator()
  o.type = type
  const g = c.createGain()
  const t = c.currentTime + at
  o.frequency.setValueAtTime(freq, t)
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(vol, t + 0.006)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(c.destination)
  o.start(t)
  o.stop(t + dur + 0.02)
}

const SOUNDS = {
  // Willow on leather: a hard click over a woody knock.
  crack: (c, at = 0) => {
    noise(c, { at, dur: 0.05, freq: 2600, q: 0.8, vol: 0.5 })
    tone(c, { at, dur: 0.09, freq: 720, to: 240, vol: 0.32, type: 'triangle' })
  },
  crowd: (c, at = 0) => {
    noise(c, { at, dur: 1.1, freq: 1500, q: 0.5, vol: 0.13, attack: 0.28 })
    noise(c, { at, dur: 0.9, freq: 620, q: 0.6, vol: 0.1, attack: 0.2 })
  },
  stumps: (c, at = 0) => {
    tone(c, { at, dur: 0.1, freq: 980, to: 420, vol: 0.24, type: 'square' })
    tone(c, { at: at + 0.05, dur: 0.12, freq: 720, to: 300, vol: 0.2, type: 'square' })
    noise(c, { at, dur: 0.12, freq: 3200, q: 1, vol: 0.2 })
  },
  groan: (c, at = 0) => {
    noise(c, { at, dur: 0.75, freq: 420, q: 0.8, vol: 0.12, attack: 0.1 })
    tone(c, { at, dur: 0.6, freq: 180, to: 110, vol: 0.05, type: 'sawtooth' })
  },
  run: (c) => { [0, 0.11].forEach((at) => tone(c, { at, dur: 0.06, freq: 300, to: 170, vol: 0.2, type: 'triangle' })) },
  thunk: (c) => {
    tone(c, { dur: 0.16, freq: 120, to: 50, vol: 0.42 })
    noise(c, { dur: 0.04, freq: 1800, vol: 0.2 })
  },
  whoosh: (c) => noise(c, { dur: 0.22, freq: 1100, q: 0.7, vol: 0.1, attack: 0.08 }),
  rain: (c) => {
    noise(c, { dur: 1.7, freq: 5200, q: 0.3, type: 'highpass', vol: 0.09, attack: 0.3 })
    tone(c, { at: 0.1, dur: 0.5, freq: 70, to: 42, vol: 0.2 })
  },
  coin: (c) => {
    tone(c, { dur: 0.1, freq: 1900, vol: 0.09 })
    tone(c, { at: 0.08, dur: 0.22, freq: 2500, vol: 0.09 })
  },
  whistle: (c) => tone(c, { dur: 0.32, freq: 2300, to: 2150, vol: 0.06, type: 'square' }),
  found: (c) => { [660, 880, 1320].forEach((freq, i) => tone(c, { at: i * 0.08, dur: 0.14, freq, vol: 0.09, type: 'triangle' })) },
  tick: (c) => tone(c, { dur: 0.03, freq: 1200, vol: 0.06, type: 'square' }),
}

/** Asks to be allowed to sound. Without a tap first, a phone opening the app says no. */
export function wakeSound() {
  try {
    const c = audio()
    return c?.state === 'running'
  } catch { return false }
}

/** Plays a named sound if the switch allows it. Several may start at their own offsets. */
export function play(name, at) {
  try {
    const c = audio()
    if (c && SOUNDS[name]) SOUNDS[name](c, at)
  } catch { /* a phone that cannot, stays quiet */ }
}
