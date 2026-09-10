// Re-uploads the ledger's bill photos into this deployment and records the
// old id -> new id map. Resumable: a map entry already written is skipped.
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api.js'
import fs from 'node:fs'
import path from 'node:path'

const S = '/tmp/claude-501/-Users-mrstark-Desktop-Code-PlayGround-Shiv-Panel/7cde09d9-d128-45b4-8b5d-e4da49c4d8bc/scratchpad'
const DIR = path.join(S, 'old-export/_storage')
const MAP = path.join(S, 'storage-map.json')

const client = new ConvexHttpClient('https://sensible-panther-176.convex.cloud')
const ids = JSON.parse(fs.readFileSync(path.join(S, 'broken.json'), 'utf8'))
const meta = new Map()
for (const line of fs.readFileSync(path.join(DIR, 'documents.jsonl'), 'utf8').trim().split('\n')) {
  const d = JSON.parse(line)
  meta.set(d._id, d)
}
const map = fs.existsSync(MAP) ? JSON.parse(fs.readFileSync(MAP, 'utf8')) : {}

const todo = ids.filter((id) => !map[id])
console.log(`${ids.length} files, ${todo.length} still to upload`)

let done = 0
const CONC = 6
async function worker() {
  for (;;) {
    const id = todo.pop()
    if (!id) return
    const m = meta.get(id)
    const file = path.join(DIR, `${id}.jpeg`)
    if (!fs.existsSync(file)) { console.log('MISSING', id); continue }
    const body = fs.readFileSync(file)
    for (let attempt = 1; ; attempt++) {
      try {
        const url = await client.mutation(api.files.generateUploadUrl, {})
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': m?.contentType || 'image/jpeg' },
          body,
        })
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
        const { storageId } = await res.json()
        map[id] = storageId
        break
      } catch (err) {
        if (attempt >= 4) { console.log('FAILED', id, String(err).slice(0, 120)); break }
        await new Promise((r) => setTimeout(r, 400 * attempt))
      }
    }
    if (++done % 25 === 0) {
      fs.writeFileSync(MAP, JSON.stringify(map, null, 2))
      console.log(`  ${done}/${ids.length}`)
    }
  }
}
await Promise.all(Array.from({ length: CONC }, worker))
fs.writeFileSync(MAP, JSON.stringify(map, null, 2))
console.log(`uploaded ${Object.keys(map).length}/${ids.length}`)
