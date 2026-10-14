import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

// Poll the WhatsApp template's approval state. It stops calling Twilio once the
// notice has been sent (or the template is rejected), so this costs nothing
// after the first success.
crons.interval(
  'watch whatsapp template approval',
  { minutes: 10 },
  internal.twilio.checkTemplateApproval,
  {},
)

// Every customer holds a bookmark: any account opened some other way (the cash
// book, an import) is given its number within ten minutes.
crons.interval(
  'give every customer a bookmark',
  { minutes: 10 },
  internal.filing.holdAllCustomers,
  {},
)

// Wrong-PIN marks older than the lockout window are no use to anyone.
crons.daily('clear old wrong PINs', { hourUTC: 21, minuteUTC: 0 }, internal.devices.sweepAttempts, {})

// The sealed history is walked end to end every night (convex/chain.ts), at
// 1:30 am in the shop, so the backup that runs at 2 carries that night's
// fingerprint out of this database.
crons.daily('check the sealed history', { hourUTC: 20, minuteUTC: 0 }, internal.chain.verify, { by: 'night' })

// The night's fingerprint, sent to Bitcoin after the check, is asked after
// every few hours until it is in a block (convex/anchor.ts).
crons.interval('bring the books fingerprint into bitcoin', { hours: 3 }, internal.anchor.upgrade, {})

// Verify Data (convex/integrity.ts): every rule the books must keep, checked
// at 1:45 am in the shop, after the history check and before the backup.
crons.daily('verify the books', { hourUTC: 20, minuteUTC: 15 }, internal.integrity.run, { by: 'night' })

export default crons
