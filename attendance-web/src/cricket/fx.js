/**
 * Effects shared by the live strip and Today's play: the ball in flight with its
 * shadow and after-images, the spark at the bat, dust off the pitch, a stump
 * cartwheeling away, fireworks, and camera flashes in the stands.
 *
 * Every piece is made here, flies, and removes itself. All of it sits inside a
 * stage that ignores touches, and clearFlying() takes the lot away at once when a
 * new mark cuts in.
 */
import ballPng from './art/ball.png'
import stumpPng from './art/stump.png'

function made(root, cls, tag = 'i') {
  const el = document.createElement(tag)
  el.className = `ck-fly ${cls}`
  if (tag === 'img') { el.alt = ''; el.draggable = false }
  root.appendChild(el)
  return el
}
const gone = (el) => () => el.remove()
const frame = (k, extra = {}) => ({ ...(k.o != null ? { offset: k.o } : {}), ...extra })

/** Everything still flying in this stage, gone. Pending flashes check for it too. */
export function clearFlying(root) {
  root?.querySelectorAll('.ck-fly').forEach((el) => { el.getAnimations().forEach((a) => a.cancel()); el.remove() })
  if (root) root.dataset.cut = String(Number(root.dataset.cut || 0) + 1)
}

/**
 * The ball along a path. keys: {x, y, r, o} where x, y is the ball's top-left in
 * the stage and o an optional offset (0 to 1) in the flight. With `ground` (the
 * ball's y when it sits on the grass) a shadow runs under it and shrinks as it
 * climbs, which is what makes the height read.
 */
export function flight(root, keys, { duration, easing = 'linear', ground = null, size = 12, trail = true }) {
  if (!root || keys.length < 2) return
  const opts = { duration, easing, fill: 'both' }
  if (ground != null) {
    const sh = made(root, 'ck-shadow')
    sh.style.width = `${size}px`
    sh.animate(keys.map((k) => {
      const s = Math.max(0.3, 1 - Math.max(0, ground - k.y) / 110)
      return frame(k, { transform: `translate(${k.x}px, ${ground + size - 3}px) scale(${s})`, opacity: 0.15 + 0.45 * s })
    }), opts).onfinish = gone(sh)
  }
  const path = keys.map((k) => frame(k, { transform: `translate(${k.x}px, ${k.y}px) rotate(${k.r || 0}deg)` }))
  const ghosts = trail ? [[34, 0.4], [68, 0.18]] : []
  for (const [delay, opacity] of ghosts) {
    const g = made(root, 'ck-ballfly ghost', 'img')
    g.src = ballPng
    g.style.cssText = `width:${size}px;height:${size}px;opacity:${opacity}`
    g.animate(path, { ...opts, delay }).onfinish = gone(g)
  }
  const b = made(root, 'ck-ballfly', 'img')
  b.src = ballPng
  b.style.cssText = `width:${size}px;height:${size}px`
  b.animate(path, opts).onfinish = gone(b)
}

/** Square pixels thrown out from a point, falling a little as they go. */
export function burst(root, x, y, colours, { count = 12, spread = 70, fall = 26, size = 6, ms = 420 } = {}) {
  if (!root) return
  for (let i = 0; i < count; i++) {
    const p = made(root, 'ck-bit')
    p.style.cssText = `left:${x}px;top:${y}px;width:${size}px;height:${size}px;margin:${-size / 2}px 0 0 ${-size / 2}px;background:${colours[i % colours.length]}`
    const a = Math.random() * Math.PI * 2
    const r = spread * (0.5 + Math.random() * 0.6)
    p.animate(
      [
        { transform: 'translate(0, 0)', opacity: 1 },
        { transform: `translate(${Math.cos(a) * r}px, ${Math.sin(a) * r + fall}px)`, opacity: 0 },
      ],
      { duration: ms + Math.random() * 240, easing: 'cubic-bezier(.15,.7,.3,1)' },
    ).onfinish = gone(p)
  }
}

/** The flash where leather meets willow. */
export function spark(root, x, y) {
  if (!root) return
  const s = made(root, 'ck-spark')
  s.style.cssText = `left:${x}px;top:${y}px`
  s.addEventListener('animationend', gone(s))
  burst(root, x, y, ['#ffffff', '#ffe27a'], { count: 6, spread: 26, fall: 0, size: 4, ms: 200 })
}

/** Dust off the pitch: where the ball lands, and under running feet. */
export function dust(root, x, y, count = 6) {
  if (!root) return
  for (let i = 0; i < count; i++) {
    const p = made(root, 'ck-bit')
    const size = 3 + Math.round(Math.random() * 3)
    p.style.cssText = `left:${x}px;top:${y}px;width:${size}px;height:${size}px;background:${i % 2 ? '#d8c391' : '#b89f68'}`
    const dx = (Math.random() - 0.5) * 34
    p.animate(
      [
        { transform: 'translate(0, 0)', opacity: 0.9 },
        { transform: `translate(${dx}px, ${-8 - Math.random() * 12}px)`, opacity: 0.6, offset: 0.5 },
        { transform: `translate(${dx * 1.4}px, ${-4}px)`, opacity: 0 },
      ],
      { duration: 360 + Math.random() * 200, easing: 'ease-out' },
    ).onfinish = gone(p)
  }
}

/** The middle stump cartwheeling away when the ball hits it. */
export function stumpFly(root, x, y, scale = 1) {
  if (!root) return
  const s = made(root, 'ck-stumpfly', 'img')
  s.src = stumpPng
  s.style.cssText = `left:${x}px;top:${y}px;width:${4 * scale}px;height:${40 * scale}px`
  s.animate(
    [
      { transform: 'translate(0, 0) rotate(0)' },
      { transform: `translate(${-34 * scale}px, ${-58 * scale}px) rotate(-420deg)`, offset: 0.45 },
      { transform: `translate(${-70 * scale}px, ${10 * scale}px) rotate(-760deg)`, opacity: 1, offset: 0.85 },
      { transform: `translate(${-76 * scale}px, ${6 * scale}px) rotate(-770deg)`, opacity: 0 },
    ],
    { duration: 820, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'forwards' },
  ).onfinish = gone(s)
  burst(root, x + 2 * scale, y + 6 * scale, ['#ebd7aa', '#b0925f', '#ffffff'], { count: 10, spread: 40 * scale, fall: 18, size: 4, ms: 360 })
}

/** A rocket goes up, then bursts into a ring that droops as it fades. */
export function firework(root, x, y, colours, { rise = 70, ring = 46 } = {}) {
  if (!root) return
  const cut = root.dataset.cut
  const rocket = made(root, 'ck-bit')
  rocket.style.cssText = `left:${x}px;top:${y + rise}px;width:3px;height:6px;background:#fff6c8`
  rocket.animate(
    [{ transform: 'translateY(0)', opacity: 1 }, { transform: `translateY(${-rise}px)`, opacity: 0.8 }],
    { duration: 260, easing: 'ease-out' },
  ).onfinish = () => {
    rocket.remove()
    if (!root.isConnected || root.dataset.cut !== cut) return
    const n = 14
    for (let i = 0; i < n; i++) {
      const p = made(root, 'ck-bit')
      p.style.cssText = `left:${x}px;top:${y}px;width:4px;height:4px;margin:-2px 0 0 -2px;background:${colours[i % colours.length]}`
      const a = (i / n) * Math.PI * 2
      p.animate(
        [
          { transform: 'translate(0, 0)', opacity: 1 },
          { transform: `translate(${Math.cos(a) * ring}px, ${Math.sin(a) * ring}px)`, opacity: 1, offset: 0.55 },
          { transform: `translate(${Math.cos(a) * ring * 1.1}px, ${Math.sin(a) * ring + 22}px)`, opacity: 0 },
        ],
        { duration: 760, easing: 'cubic-bezier(.1,.8,.3,1)' },
      ).onfinish = gone(p)
    }
  }
}

/** Phones going off in the stands: small white flashes at random over `ms`. */
export function flashes(root, area, count, ms = 900) {
  if (!root) return
  const cut = root.dataset.cut
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      if (!root.isConnected || root.dataset.cut !== cut) return
      const f = made(root, 'ck-camflash')
      f.style.cssText = `left:${area.x0 + Math.random() * (area.x1 - area.x0)}px;top:${area.y0 + Math.random() * (area.y1 - area.y0)}px`
      f.addEventListener('animationend', gone(f))
    }, Math.random() * ms)
  }
}

/** The camera jolts: a few pixels each way, in steps. */
export function shake(el, px = 4, ms = 260) {
  el?.animate(
    [0, -px, px, -px * 0.6, px * 0.6, 0].map((x, i) => ({ transform: `translate(${x}px, ${i % 2 ? -px / 2 : 0}px)` })),
    { duration: ms, easing: 'steps(6)' },
  )
}

/** A quick push in on one point, then back out: the replay camera on a wicket. */
export function punch(el, ox, oy, zoom = 1.12, ms = 520) {
  if (!el) return
  el.style.transformOrigin = `${ox}px ${oy}px`
  el.animate(
    [{ transform: 'scale(1)' }, { transform: `scale(${zoom})`, offset: 0.3 }, { transform: `scale(${zoom})`, offset: 0.7 }, { transform: 'scale(1)' }],
    { duration: ms, easing: 'steps(8)' },
  )
}
