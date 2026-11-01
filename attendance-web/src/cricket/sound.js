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
    // An iPhone on silent mutes web sound unless the page says it is playing media.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback' } catch { /* older phone */ }
    ctx = new AC()
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const data = noiseBuf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }
  if (ctx.state !== 'running') {
    ctx.resume().catch(() => {})
    const hush = ctx.createBufferSource()
    hush.buffer = ctx.createBuffer(1, 1, ctx.sampleRate)
    hush.connect(ctx.destination)
    hush.start()
  }
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
  // The ball pitching: a dull thud off a hard surface.
  bounce: (c, at = 0) => {
    tone(c, { at, dur: 0.07, freq: 190, to: 90, vol: 0.22 })
    noise(c, { at, dur: 0.03, freq: 900, q: 1.2, vol: 0.08 })
  },
  // A four: the stands clap, a ragged patter rather than one beat.
  claps: (c, at = 0) => {
    for (let i = 0; i < 14; i++) {
      noise(c, { at: at + i * 0.045 + Math.random() * 0.03, dur: 0.04, freq: 1800 + Math.random() * 900, q: 1.4, vol: 0.06 + Math.random() * 0.05 })
    }
  },
  // A six: the whole ground on its feet, swelling then falling away.
  roar: (c, at = 0) => {
    noise(c, { at, dur: 1.9, freq: 1100, q: 0.4, vol: 0.2, attack: 0.35 })
    noise(c, { at, dur: 1.6, freq: 480, q: 0.5, vol: 0.14, attack: 0.3 })
    noise(c, { at: at + 0.1, dur: 1.2, freq: 2800, q: 0.7, vol: 0.06, attack: 0.25 })
  },
  // Wood on wood: the stumps and bails hitting each other on the way down.
  clatter: (c, at = 0) => {
    ;[0, 0.07, 0.15, 0.26].forEach((d, i) => tone(c, { at: at + d, dur: 0.05, freq: 1300 - i * 180, to: 500, vol: 0.12 - i * 0.02, type: 'triangle' }))
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
