/**
 * How a page of the shop's paper cash register is read (ai:readCashPage). Kept
 * apart from the action so the read can be tried on a photo from the command
 * line with the very same words.
 *
 * The reader only reads. Every sum and every comparison is done afterwards by
 * cash-web/src/pageCheck.js, so a wrong total cannot be invented, and a misread
 * figure shows up as a total that does not agree with the page.
 */
const LINE = {
  type: 'object',
  properties: {
    amount: { type: ['number', 'null'], description: 'The figure as written, in rupees. Null if it cannot be read.' },
    note: { type: 'string', description: 'What is written after the figure, as written.' },
    online: { type: 'boolean', description: 'The note says Online, or the line is highlighted yellow.' },
    mark: { type: 'string', enum: ['yellow', 'orange', 'none'], description: 'The highlighter on the line.' },
    struck: { type: 'boolean', description: 'The figure is crossed out by a line drawn through it.' },
    unsure: { type: 'boolean', description: 'True if any digit of the amount could be read another way.' },
  },
  required: ['amount', 'note', 'online', 'mark', 'struck', 'unsure'],
  additionalProperties: false,
}

export const CASH_PAGE_TOOL = {
  name: 'file_cash_page',
  description: 'Record every line of this page of the cash register, exactly as written.',
  input_schema: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'The date at the top of the page, as YYYY-MM-DD. Empty if unreadable.' },
      opening: { type: ['number', 'null'], description: 'The figure on the O/B line at the top of the left side.' },
      in: { type: 'array', items: LINE, description: 'The left side, top to bottom, without the O/B line or the working below its total.' },
      out: { type: 'array', items: LINE, description: 'The right side, top to bottom, without its total.' },
      written: {
        type: 'object',
        description: 'The sums the shop wrote under the left side. Null where a figure is not on the page.',
        properties: {
          inTotal: { type: ['number', 'null'], description: 'The total ruled off under the left side.' },
          outTotal: { type: ['number', 'null'], description: 'The total ruled off under the right side.' },
          balance: { type: ['number', 'null'], description: 'Left total minus right total, as written.' },
          drawer: { type: ['number', 'null'], description: 'The figure taken off the balance: what was counted in the drawer.' },
          difference: { type: ['number', 'null'], description: 'The last figure, the drawer against the book. Always written as a plain positive number.' },
          differenceWords: { type: 'string', description: 'The words beside that figure, such as "less in drawer".' },
        },
        required: ['inTotal', 'outTotal', 'balance', 'drawer', 'difference', 'differenceWords'],
        additionalProperties: false,
      },
    },
    required: ['date', 'opening', 'in', 'out', 'written'],
    additionalProperties: false,
  },
}

export const CASH_PAGE_SYSTEM = `You read one handwritten page of the cash register of a hardware shop in Ramgarh, Jharkhand. Your only job is to copy down what is written. Somebody will check every sum afterwards, and they rely on you to report the page as it is, including its mistakes.

The page has two sides, one line of money per row.

LEFT SIDE: money in, usually with a tick beside each line.
- The first line reads like "39604 = O/B". That is the opening balance: it goes in "opening", never in the lines.
- Lines read "<amount> = <note>". The note is often just a bill number (63, 19, 778) or "W/B", and sometimes a word like Advance with a name in brackets.
- Under the last line it is ruled off with the total, then the working: the right side's total taken off, the balance, the drawer figure taken off, and what is left with words such as "80 less in drawer".

RIGHT SIDE: money out, written the same way, ruled off with its own total at the bottom.
- Notes are usually names and what for, sometimes in Hindi. Write Hindi in Roman letters as best you can.

MARKS
- Yellow highlighter means the money was online. Orange highlighter is a different mark: report it as "orange" and do not treat it as online unless the note says so.
- struck is true ONLY when a stroke runs through the digits of the amount itself. Still list that line, and read the figure under the stroke as well as you can.
- These are NOT struck: a word in the note that is crossed out while the figure is clean (say "300 = [crossed-out word] 785"), a dash or a tail before a figure (say "-180"), a tick, a doodle, or a rule under a line. When unsure, struck is false: a line wrongly left in shows up in the totals.

AMOUNTS: THE PART THAT MATTERS
- These are rupees. Copy each figure digit by digit, from the page. Never round, and never tidy.
- Commas and the "=" after a figure are not digits. A 1 with a long tail is still a 1. Look at 1 and 7, 4 and 9, 3 and 8, 0 and 6 twice, as this writer's are close.
- NEVER change a figure so that a total comes out right. If the lines do not add up to the written total, that is exactly what the shop needs to find out. Do not do the sums for them.
- If a digit could honestly be read another way, give your best reading and set unsure true. If the figure cannot be read at all, amount is null.
- Copy every row, top to bottom, in order, on both sides. Do not skip a line because it repeats another: the same amount on both sides is normal.

The date is at the top right, day first, such as 4/11/26, and may be written over. 26 means 2026.`
