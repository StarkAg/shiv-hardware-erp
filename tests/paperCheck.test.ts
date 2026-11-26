import { describe, expect, it } from 'vitest'
import { createCanvas } from '@napi-rs/canvas'
// @ts-expect-error plain ESM module without types
import { looksLikePaper } from '../print-server/paper-check.mjs'

/** A JPEG drawn here: fill colour(s) and a few strokes of ink. */
function picture(draw: (ctx: any, w: number, h: number) => void, w = 400, h = 300) {
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  draw(ctx, w, h)
  return canvas.toBuffer('image/jpeg')
}

const slip = (paper: string) => picture((ctx, w, h) => {
  // Paper in uneven light, with ruled lines and blue handwriting.
  const g = ctx.createLinearGradient(0, 0, w, h)
  g.addColorStop(0, paper)
  g.addColorStop(1, '#c9cdd6')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = '#b8c0cc'
  for (let y = 30; y < h; y += 28) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
  ctx.strokeStyle = '#2346c8'
  ctx.lineWidth = 3
  ctx.beginPath(); ctx.moveTo(40, 60); ctx.lineTo(220, 64); ctx.moveTo(60, 140); ctx.lineTo(300, 150); ctx.stroke()
})

describe('looksLikePaper (no AI, colours only)', () => {
  it('takes a photo of a cream or grey-blue paper slip as paper', async () => {
    expect((await looksLikePaper(slip('#ece4d2'))).paper).toBe(true)
    expect((await looksLikePaper(slip('#d9dde6'))).paper).toBe(true)
  })

  it('skips a colourful photo, a dark one, and a made image on pure white', async () => {
    const colourful = picture((ctx, w, h) => {
      ctx.fillStyle = '#c0392b'; ctx.fillRect(0, 0, w / 2, h)
      ctx.fillStyle = '#2e86c1'; ctx.fillRect(w / 2, 0, w / 2, h / 2)
      ctx.fillStyle = '#7f8c3d'; ctx.fillRect(w / 2, h / 2, w / 2, h / 2)
    })
    const dark = picture((ctx, w, h) => { ctx.fillStyle = '#3a3f44'; ctx.fillRect(0, 0, w, h) })
    const card = picture((ctx, w, h) => {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = '#000000'; ctx.fillRect(20, 20, 120, 30)
    })
    expect((await looksLikePaper(colourful)).paper).toBe(false)
    expect((await looksLikePaper(dark)).paper).toBe(false)
    expect((await looksLikePaper(card)).paper).toBe(false)
  })
})
