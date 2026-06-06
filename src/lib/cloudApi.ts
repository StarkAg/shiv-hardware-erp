import type { GuaranteeDocument, Quotation } from './types'

export const CLOUD_API_URL = import.meta.env.VITE_CLOUD_API_URL ?? ''
const CLOUD_API_KEY = import.meta.env.VITE_CLOUD_API_KEY ?? ''

export type CloudPrintJobKind = 'quotation' | 'guarantee' | 'raw-file'
export type CloudPrintJobSource = 'android' | 'web' | 'whatsapp' | 'server'
export type CloudPrintJobStatus = 'pending' | 'claimed' | 'printing' | 'printed' | 'failed' | 'cancelled'

export type CreateCloudPrintJobPayload =
  | {
      kind: 'quotation'
      quote: Quotation
      copies?: number
      source?: CloudPrintJobSource
      requestedBy?: string
      assignedPrinterId?: string
    }
  | {
      kind: 'guarantee'
      document: GuaranteeDocument
      layout?: 'a4' | 'card'
      copies?: number
      source?: CloudPrintJobSource
      requestedBy?: string
      assignedPrinterId?: string
    }

export type CreateCloudPrintJobResult = {
  ok: true
  id: string
}

export type CloudPrintJob = {
  _id: string
  status: CloudPrintJobStatus
  kind: CloudPrintJobKind
  source: CloudPrintJobSource
  copies: number
  requestedBy?: string
  assignedPrinterId?: string
  claimedBy?: string
  claimedAt?: number
  printedAt?: number
  failedAt?: number
  error?: string
  createdAt: number
  updatedAt: number
}

function cloudHeaders() {
  return {
    'Content-Type': 'application/json',
    ...(CLOUD_API_KEY ? { Authorization: `Bearer ${CLOUD_API_KEY}` } : {}),
  }
}

async function cloudFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!CLOUD_API_URL) throw new Error('Cloud API URL is not configured')
  const response = await fetch(`${CLOUD_API_URL.replace(/\/+$/, '')}${path}`, {
    ...init,
    headers: {
      ...cloudHeaders(),
      ...(init?.headers ?? {}),
    },
  })
  const json = await response.json().catch(() => null)
  if (!response.ok || !json?.ok) {
    throw new Error(json?.error ?? `Cloud API returned HTTP ${response.status}`)
  }
  return json as T
}

export async function createCloudPrintJob(payload: CreateCloudPrintJobPayload): Promise<CreateCloudPrintJobResult> {
  const body = payload.kind === 'quotation'
    ? {
        kind: 'quotation',
        source: payload.source ?? 'android',
        copies: payload.copies ?? 1,
        requestedBy: payload.requestedBy,
        assignedPrinterId: payload.assignedPrinterId,
        payload: { quote: payload.quote },
      }
    : {
        kind: 'guarantee',
        source: payload.source ?? 'android',
        copies: payload.copies ?? 1,
        requestedBy: payload.requestedBy,
        assignedPrinterId: payload.assignedPrinterId,
        payload: { document: payload.document, layout: payload.layout ?? 'a4' },
      }

  return await cloudFetch<CreateCloudPrintJobResult>('/api/print-jobs', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function getCloudPrintJob(id: string): Promise<{ ok: true; job: CloudPrintJob }> {
  return await cloudFetch(`/api/print-jobs/${encodeURIComponent(id)}`)
}

export async function upsertCloudCustomer(customer: {
  id: string
  name: string
  mobile?: string
  altMobile?: string
  uid?: string
  address?: string
}): Promise<{ ok: true; id: string }> {
  return await cloudFetch('/api/customers', {
    method: 'POST',
    body: JSON.stringify({
      localId: customer.id,
      name: customer.name,
      mobile: customer.mobile || undefined,
      altMobile: customer.altMobile || undefined,
      uid: customer.uid || undefined,
      address: customer.address || undefined,
    }),
  })
}

export async function saveCloudQuotation(quote: Quotation): Promise<{ ok: true; id: string }> {
  return await cloudFetch('/api/quotations', {
    method: 'POST',
    body: JSON.stringify({
      localId: quote.id,
      number: quote.number,
      customer: quote.customer,
      document: quote,
    }),
  })
}

export async function saveCloudGuarantee(document: GuaranteeDocument): Promise<{ ok: true; id: string }> {
  return await cloudFetch('/api/guarantees', {
    method: 'POST',
    body: JSON.stringify({
      localId: document.id,
      number: document.number,
      customer: document.customer,
      document,
    }),
  })
}

export async function checkCloudApi(): Promise<{ ok: true; service: string; convexConfigured: boolean; authEnabled: boolean }> {
  return await cloudFetch('/health')
}
