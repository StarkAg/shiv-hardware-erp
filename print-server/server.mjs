// Shiv Hardware Print Server
// Run: node server.mjs
// Phone sends POST /print with quote JSON → PDF → printer

import express from 'express'
import cors from 'cors'
import { exec } from 'child_process'
import { writeFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildQuotationHtml } from './template.mjs'

const PORT = 3333
const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))

// Health check — phone uses this to confirm server is reachable
app.get('/status', (_req, res) => res.json({ ok: true, server: 'Shiv Print Server' }))

app.post('/print', async (req, res) => {
  const { quote, copies = 1 } = req.body
  if (!quote) return res.status(400).json({ error: 'Missing quote data' })

  try {
    const html = await buildQuotationHtml(quote)

    // Render HTML → PDF via headless Chromium
    const { default: puppeteer } = await import('puppeteer')
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0' })
    const pdf = await page.pdf({ format: 'A4', printBackground: true })
    await browser.close()

    // Save to tmp and send to printer via CUPS (Mac/Linux)
    const tmp = join(tmpdir(), `shiv-print-${Date.now()}.pdf`)
    await writeFile(tmp, pdf)
    await new Promise((ok, fail) =>
      exec(`lp -n ${copies} "${tmp}"`, (err, stdout) => {
        if (err) fail(err); else { console.log('[print]', stdout.trim()); ok() }
      }),
    )
    await unlink(tmp)
    res.json({ ok: true })
  } catch (err) {
    console.error('[error]', err)
    res.status(500).json({ error: String(err) })
  }
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✓ Shiv Print Server running`)
  console.log(`  Local:   http://localhost:${PORT}`)
  console.log(`  Network: http://192.168.29.174:${PORT}`)
  console.log(`  Phone:   POST http://192.168.29.174:${PORT}/print\n`)
})
