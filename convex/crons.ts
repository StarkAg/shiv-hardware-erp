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

export default crons
