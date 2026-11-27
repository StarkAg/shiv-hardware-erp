import { indiaTodayMs } from '../../../lib/businessDate';

const money = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const rupees = (n) =>
  n === undefined || n === null ? '' : money.format(n);

/** An amount with the side it sits on, the way a ledger states a balance. */
export const withSide = (n, side) =>
  n === undefined || n === null ? '' : `${money.format(n)} ${side}`;

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Dates are stored as UTC midnight, so read them back in UTC — otherwise a
// bill dated the 1st shows as the 31st for anyone behind GMT.
export const shortDate = (ms) => {
  const d = new Date(ms);
  // dd/mm/yy, the way the shop writes a date.
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(
    d.getUTCFullYear()
  ).slice(2)}`;
};

export const longDate = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

export const inputDate = (ms) => new Date(ms).toISOString().slice(0, 10);

export const fromInputDate = (str) => {
  const [y, m, d] = str.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

// India's date, not the device's: a PC on another time zone dated the day wrong.
export const today = () => indiaTodayMs();

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
  'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const under100 = (n) =>
  n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`;

const under1000 = (n) =>
  n < 100
    ? under100(n)
    : `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${under100(n % 100)}` : ''}`;

/** Indian numbering: crore, lakh, thousand — not millions. */
const words = (n) => {
  if (n === 0) return 'Zero';
  const parts = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${words(crore)} Crore`);
  if (lakh) parts.push(`${under1000(lakh)} Lakh`);
  if (thousand) parts.push(`${under1000(thousand)} Thousand`);
  if (rest) parts.push(under1000(rest));
  return parts.join(' ');
};

/** The figure spelled out, the way a statement states it. */
export const rupeesInWords = (n) => {
  if (n === undefined || n === null) return '';
  const paise = Math.round(Math.abs(n) * 100);
  const whole = Math.floor(paise / 100);
  const rest = paise % 100;
  return `Rupees ${words(whole)}${rest ? ` and ${under100(rest)} Paise` : ''} Only`;
};

/** "1234 5678 9012" — an Aadhaar in the groups people read it in. */
export const aadhaarGroups = (digits) =>
  !digits ? '' : digits.replace(/(\d{4})(?=\d)/g, '$1 ');

/** "•••• •••• 9012" — enough to recognise, not enough to misuse. */
export const aadhaarMasked = (digits) =>
  !digits ? '' : `•••• •••• ${digits.slice(-4)}`;

/**
 * "98765 43210" — a mobile in the halves people read it in, with or without
 * the +91.
 *
 * Only that one shape is reformatted. A landline like 0651-2345678 is eleven
 * digits starting with a zero, and so is a mobile written 09876543210 — there
 * is no telling them apart, so anything that is not plainly a ten-digit mobile
 * (Indian ones start 6–9) is handed back exactly as it was typed.
 */
export const phoneDisplay = (raw) => {
  if (!raw) return '';
  const asTyped = String(raw).trim();
  const digits = asTyped.replace(/\D/g, '');
  const ten =
    digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return ten.length === 10 && /^[6-9]/.test(ten)
    ? `${ten.slice(0, 5)} ${ten.slice(5)}`
    : asTyped;
};

/** The href for tapping a number to call it. */
export const phoneHref = (raw) => `tel:${String(raw).replace(/[^\d+]/g, '')}`;

/** The accounts money sits in: the drawer and the bank. */
const MONEY_ACCOUNTS = new Set(['Cash', 'Bank']);

/**
 * What a line on an account's ledger is called.
 *
 * A sale paid on the spot is one voucher with two lines on the customer's
 * account: the sale, and the money taken with it. Both belong to the Sale
 * voucher, but the money line is a receipt and reads as one; the same for a
 * purchase paid on the spot, whose money line is a payment. Told apart by the
 * side the line is on and by what stands against it (Cash or Bank), so the
 * Sales account's own lines, or the bank's, keep the voucher's name.
 */
export const rowType = (row) => {
  const against = row.contra ?? [];
  const money = against.length > 0 && against.every((name) => MONEY_ACCOUNTS.has(name));
  if (money && row.vchType === 'Sale' && row.side === 'Cr') return 'Receipt';
  if (money && row.vchType === 'Purchase' && row.side === 'Dr') return 'Payment';
  return row.vchType;
};

/**
 * One statement line in words a customer reads: "Receipt - Cash",
 * "Sale - Bill no. 4512 - fitting charges". No To/By, no account named after
 * the line's own type ("Sale - Sales"), and none of the books' own refs
 * (BILL-370, CASH-12), which only tie a voucher to its bill.
 */
const AUTO_REF = /^(BILL|CASH)-\d+$/;
const DEFAULT_NARRATION = /^(Sale|Purchase|Receipt|Payment|Goods Return|Refund|Advance) \S+$/;
export const statementDetails = (row) => {
  const type = rowType(row);
  const stem = type.toLowerCase().slice(0, 4);
  const against = (row.contra ?? []).filter((name) => !String(name).toLowerCase().startsWith(stem));
  const ref = String(row.refNo ?? '').trim();
  const note = String(row.narration ?? '').trim();
  return [
    type,
    against.join(', '),
    ref && !AUTO_REF.test(ref) && `Bill no. ${ref}`,
    note && note !== row.vchType && note !== type && !DEFAULT_NARRATION.test(note) && note,
  ].filter(Boolean).join(' - ');
};

/** A running balance as a statement prints it: "23,895.00 Dr", Dr above zero. */
export const balanceText = (v) => `${rupees(Math.abs(v))} ${v < -0.005 ? 'Cr' : 'Dr'}`;

/**
 * A party's entries as the lines of a statement, each with the balance after it.
 *
 * A receipt or payment settled with a discount is one entry in the books (the
 * party cleared for 30,080 against Cash 29,830 and Discount Allowed 250), but
 * the statement shows it as an accountant would: the money handed over, then
 * the discount on a line of its own, so the customer sees what was let off.
 */
const DISCOUNT_ACCOUNT = /^Discount (Allowed|Received)$/;
export const statementLines = (data) => {
  let running = (data.openingSide === 'Dr' ? 1 : -1) * (Number(data.opening) || 0);
  const lines = [];
  const add = (r, key, no, details, amount) => {
    running += r.side === 'Dr' ? amount : -amount;
    lines.push({ key, date: r.date, no, details, side: r.side, amount, balance: running });
  };
  (data.rows ?? []).forEach((r, i) => {
    const key = `${r.voucherId}-${i}`;
    const discount = Number(r.discount) || 0;
    const money = Math.round((r.amount - discount) * 100) / 100;
    if (discount > 0.005 && money > 0.005) {
      const contra = (r.contra ?? []).filter((name) => !DISCOUNT_ACCOUNT.test(name));
      add(r, key, r.vchLabel, statementDetails({ ...r, contra }), money);
      add(r, `${key}-discount`, '', 'Discount', discount);
    } else {
      add(r, key, r.vchLabel, statementDetails(r), r.amount);
    }
  });
  return lines;
};
