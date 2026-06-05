import type { GuaranteeDocument, Quotation } from './types'

export const CLOUD_API_URL = import.meta.env.VITE_CLOUD_API_URL ?? ''
const CLOUD_API_KEY = import.meta.env.VITE_CLOUD_API_KEY ?? ''

export type CloudPrintJobKind = 'quotation' | 'guarantee' | 'raw-file'
export type CloudPrintJobSource = 'android' | 'web' | 'whatsapp' | 'server'

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

export async function checkCloudApi(): Promise<{ ok: true; service: string; convexConfigured: boolean; authEnabled: boolean }> {
  return await cloudFetch('/health')
}

