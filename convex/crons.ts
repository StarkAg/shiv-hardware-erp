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

export default crons
