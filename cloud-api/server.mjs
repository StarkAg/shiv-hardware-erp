import express from 'express'
import cors from 'cors'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { readFileSync } from 'fs'

try {
  readFileSync(new URL('.env', import.meta.url), 'utf8').split('\n').forEach(line => {
    const [key, ...value] = line.split('=')
    if (key?.trim() && !key.trim().startsWith('#')) {
      process.env[key.trim()] = value.join('=').trim()
    }
  })
} catch {}

const PORT = Number(process.env.PORT) || 8080
const CONVEX_URL = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL
const CLOUD_API_KEY = process.env.CLOUD_API_KEY || ''

if (!CONVEX_URL) {
  throw new Error('Missing CONVEX_URL. Set it to your Convex deployment URL.')
}

const convex = new ConvexHttpClient(CONVEX_URL)
const app = express()

app.use(cors())
app.use(express.json({ limit: process.env.JSON_LIMIT || '30mb' }))

const refs = {
  createPrintJob: makeFunctionReference('printJobs:create'),
  getPrintJob: makeFunctionReference('printJobs:getById'),
  listPendingPrintJobs: makeFunctionReference('printJobs:listPending'),
  claimNextPrintJobs: makeFunctionReference('printJobs:claimNext'),
  markPrintJobPrinting: makeFunctionReference('printJobs:markPrinting'),
  completePrintJob: makeFunctionReference('printJobs:complete'),
  failPrintJob: makeFunctionReference('printJobs:fail'),
  upsertCustomer: makeFunctionReference('customers:upsert'),
  saveQuotation: makeFunctionReference('documents:saveQuotation'),
  saveGuarantee: makeFunctionReference('documents:saveGuarantee'),
}

function requireApiKey(req, res, next) {
  if (!CLOUD_API_KEY) {
    next()
    return
  }

  const auth = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim()
  const key = String(req.headers['x-api-key'] ?? auth).trim()
  if (key === CLOUD_API_KEY) {
    next()
    return
  }

  res.status(401).json({ ok: false, error: 'Unauthorized' })
}

function requiredString(value, name) {
  const clean = String(value ?? '').trim()
  if (!clean) throw new Error(`Missing ${name}`)
  return clean
}

function sendError(res, err, status = 400) {
  res.status(status).json({ ok: false, error: err?.message ?? String(err) })
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'shiv-cloud-api',
    convexConfigured: Boolean(CONVEX_URL),
    authEnabled: Boolean(CLOUD_API_KEY),
  })
})

app.use('/api', requireApiKey)

app.post('/api/print-jobs', async (req, res) => {
  try {
    const id = await convex.mutation(refs.createPrintJob, {
      kind: req.body.kind,
      source: req.body.source ?? 'android',
      payload: req.body.payload,
      copies: req.body.copies,
      requestedBy: req.body.requestedBy,
      assignedPrinterId: req.body.assignedPrinterId,
    })
    res.json({ ok: true, id })
  } catch (err) {
    sendError(res, err)
  }
})

app.get('/api/print-jobs/pending', async (req, res) => {
  try {
    const jobs = await convex.query(refs.listPendingPrintJobs, {
      printerId: req.query.printerId ? String(req.query.printerId) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    })
    res.json({ ok: true, jobs })
  } catch (err) {
    sendError(res, err)
  }
})

app.get('/api/print-jobs/:id', async (req, res) => {
  try {
    const job = await convex.query(refs.getPrintJob, { id: req.params.id })
    if (!job) {
      res.status(404).json({ ok: false, error: 'Print job not found' })
      return
    }
    res.json({ ok: true, job })
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/print-jobs/claim', async (req, res) => {
  try {
    const printerId = requiredString(req.body.printerId, 'printerId')
    const jobs = await convex.mutation(refs.claimNextPrintJobs, {
      printerId,
      limit: req.body.limit,
    })
    res.json({ ok: true, jobs })
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/print-jobs/:id/printing', async (req, res) => {
  try {
    await convex.mutation(refs.markPrintJobPrinting, {
      id: req.params.id,
      printerId: requiredString(req.body.printerId, 'printerId'),
    })
    res.json({ ok: true })
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/print-jobs/:id/complete', async (req, res) => {
  try {
    await convex.mutation(refs.completePrintJob, {
      id: req.params.id,
      printerId: requiredString(req.body.printerId, 'printerId'),
    })
    res.json({ ok: true })
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/print-jobs/:id/fail', async (req, res) => {
  try {
    await convex.mutation(refs.failPrintJob, {
      id: req.params.id,
      printerId: requiredString(req.body.printerId, 'printerId'),
      error: requiredString(req.body.error, 'error'),
    })
    res.json({ ok: true })
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/customers', async (req, res) => {
  try {
    const id = await convex.mutation(refs.upsertCustomer, req.body)
    res.json({ ok: true, id })
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/quotations', async (req, res) => {
  try {
    const id = await convex.mutation(refs.saveQuotation, {
      localId: requiredString(req.body.localId, 'localId'),
      number: requiredString(req.body.number, 'number'),
      customer: req.body.customer,
      document: req.body.document,
    })
    res.json({ ok: true, id })
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/guarantees', async (req, res) => {
  try {
    const id = await convex.mutation(refs.saveGuarantee, {
      localId: requiredString(req.body.localId, 'localId'),
      number: requiredString(req.body.number, 'number'),
      customer: req.body.customer,
      document: req.body.document,
    })
    res.json({ ok: true, id })
  } catch (err) {
    sendError(res, err)
  }
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Shiv Cloud API running on :${PORT}`)
})
