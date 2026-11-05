import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Doc } from '../../../convex/_generated/dataModel'
import { Button, Input, Page, PageHeader } from '../../components/ui'
import { toast } from '../../components/Toast'

/**
 * Shiv Intro, for a new customer. Save puts them in the contacts on the owner's
 * Samsung; Send gives them the shop's greeting and visiting card on WhatsApp
 * from Tony's number. Two separate buttons, because either can be wanted alone.
 * See convex/shivIntro.ts.
 */

type Row = Doc<'introContacts'>
type Tone = 'wait' | 'done' | 'stop'

const TONE: Record<Tone, React.CSSProperties> = {
  wait: { background: '#ffcc00', color: '#0e1318' },
  done: { background: '#007a3d', color: '#ffffff' },
  stop: { background: '#b3202a', color: '#ffffff' },
}

/** A send that took this long never finished: the service stopped halfway. */
const STUCK_MS = 5 * 60_000

const saveSign = (row: Row): [string, Tone] | null => {
  if (row.saveStatus === 'waiting') return ['Waiting for phone', 'wait']
  if (row.saveStatus === 'saved') return ['Saved on phone', 'done']
  if (row.saveStatus === 'already') return ['Already on phone', 'done']
  if (row.saveStatus === 'failed') return ['Not saved', 'stop']
  return null
}

const sendSign = (row: Row): [string, Tone] | null => {
  if (row.sendStatus === 'requested') return ['Waiting to send', 'wait']
  if (row.sendStatus === 'sending') return ['Sending', 'wait']
  if (row.sendStatus === 'sent') return ['Card sent', 'done']
  if (row.sendStatus === 'skipped') return ['Not on WhatsApp', 'stop']
  if (row.sendStatus === 'failed') return ['Not sent', 'stop']
  return null
}

const Sign = ({ sign }: { sign: [string, Tone] }) => (
  <span className="px-2 py-1 text-xs font-bold" style={TONE[sign[1]]}>{sign[0]}</span>
)

const words = (err: unknown) => {
  const data = (err as { data?: unknown })?.data
  return typeof data === 'string' ? data : 'Not done. Check the internet and try again.'
}

const last10 = (typed: string) => typed.replace(/\D/g, '').slice(-10)

const ago = (at: number) => {
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} hours ago`
  return `${Math.round(minutes / 1440)} days ago`
}

const canSave = (row?: Row) => !row || !row.saveStatus || row.saveStatus === 'failed'
const canSend = (row?: Row) => {
  if (!row?.sendStatus) return true
  if (row.sendStatus === 'sending') return Date.now() - (row.sendAskedAt ?? 0) > STUCK_MS
  return row.sendStatus !== 'requested' && row.sendStatus !== 'sent'
}

export default function ShivIntro() {
  const data = useQuery(api.shivIntro.recent)
  const save = useMutation(api.shivIntro.save)
  const send = useMutation(api.shivIntro.send)
  const [name, setName] = useState('')
  const [place, setPlace] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)

  const rows = data?.rows ?? []
  const typed = last10(phone)
  const current = typed.length === 10 ? rows.find((row) => row.phone === typed) : undefined
  const filled = Boolean(name.trim() && typed.length === 10)
  const seenAt = data?.phoneSeenAt ?? null
  // The app checks in every 15 minutes, so a good while longer means it stopped.
  const phoneQuiet = seenAt === null || Date.now() - seenAt > 40 * 60_000

  const clear = () => { setName(''); setPlace(''); setPhone('') }

  async function run(job: () => Promise<unknown>, otherDone: boolean) {
    if (busy) return
    setBusy(true)
    try {
      await job()
      // Both done: ready for the next customer, with nothing to press.
      if (otherDone) clear()
    } catch (err) {
      toast(words(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const person = { name, place, phone }
  const sendRow = (row: Row, again: boolean) => {
    if (again && !window.confirm(`${row.name} was already sent the card. Send it again?`)) return
    void run(() => send({ name: row.name, place: row.place, phone: row.phone, again }), false)
  }

  return (
    <>
      <PageHeader title="Shiv Intro" subtitle="For a new customer: save on the main phone, and send the shop's card." />
      <Page>
        <div className="mx-auto flex max-w-md flex-col gap-3">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          <Input label="Place" value={place} onChange={(e) => setPlace(e.target.value)} autoComplete="off" />
          <Input label="Mobile number" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="off" />
          <div className="flex gap-3">
            <Button
              className="min-h-12 flex-1 justify-center"
              disabled={busy || !filled || !canSave(current)}
              onClick={() => void run(() => save(person), Boolean(current?.sendStatus))}
            >
              Save
            </Button>
            <Button
              className="min-h-12 flex-1 justify-center"
              disabled={busy || !filled || !canSend(current)}
              onClick={() => void run(() => send(person), Boolean(current?.saveStatus))}
            >
              Send
            </Button>
          </div>
          {current && (
            <p className="text-sm text-muted">
              {current.name} is already on the list below.{' '}
              <button type="button" className="font-semibold underline" onClick={clear}>New customer</button>
            </p>
          )}
          {data && (
            <p className="text-sm text-muted">
              Main phone: {seenAt === null ? 'not connected yet' : `last seen ${ago(seenAt)}`}
              {phoneQuiet ? '. Saves will wait until it is back.' : ''}
            </p>
          )}
        </div>

        <ul className="mx-auto mt-6 max-w-md divide-y divide-stone-200">
          {rows.map((row) => {
            const saved = saveSign(row)
            const sent = sendSign(row)
            return (
              <li key={row._id} className="py-3">
                <div className="font-semibold">{row.name}{row.place ? `, ${row.place}` : ''}</div>
                <div className="text-sm text-muted">
                  {row.phone}
                  {row.savedAs ? ` · on phone as ${row.savedAs}` : ''}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {saved && <Sign sign={saved} />}
                  {sent && <Sign sign={sent} />}
                  {canSave(row) && (
                    <Button variant="outline" disabled={busy} onClick={() => void run(() => save({ name: row.name, place: row.place, phone: row.phone }), false)}>
                      {row.saveStatus === 'failed' ? 'Save again' : 'Save'}
                    </Button>
                  )}
                  {(canSend(row) || row.sendStatus === 'sent') && (
                    <Button variant="outline" disabled={busy} onClick={() => sendRow(row, Boolean(row.sendStatus))}>
                      {row.sendStatus ? 'Send again' : 'Send'}
                    </Button>
                  )}
                </div>
                {(row.saveError || row.sendError) && (
                  <div className="mt-1 text-sm text-muted">{row.saveError ?? row.sendError}</div>
                )}
              </li>
            )
          })}
        </ul>
      </Page>
    </>
  )
}
