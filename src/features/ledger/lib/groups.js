/**
 * Tally's group names, said the way the shop says them. The books keep the
 * proper names — the Trial Balance still adds up under them — but nothing on
 * screen asks anyone to think in Sundry Debtors.
 */
const LABELS = {
  'Sundry Creditors': 'Suppliers',
  'Sundry Debtors': 'Customers',
  'Purchase Accounts': 'Purchases',
  'Sales Accounts': 'Sales',
  'Cash-in-Hand': 'Cash',
  'Bank Accounts': 'Bank',
};

export const groupLabel = (name) => LABELS[name] ?? name;
