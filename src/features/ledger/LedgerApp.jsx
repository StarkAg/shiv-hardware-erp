import React, { useEffect, useState } from 'react';
import { api } from '../../../convex/_generated/api';
import { useLive } from './lib/cache';
import { useShortcuts } from '../../lib/useShortcuts';
import Parties from './components/Parties';
import AllParties from './components/AllParties';
import LedgerView from './components/LedgerView';
import Bills, { needsYou } from './components/Bills';
import TrialBalance from './components/TrialBalance';
import History from './components/History';
import Capture from './components/Capture';
import VoucherForm from './components/VoucherForm';
import LedgerForm from './components/LedgerForm';
import BillViewer from './components/BillViewer';
import PrintPacket from './components/PrintPacket';
import SalaryRent from './components/SalaryRent';
import { History as HistoryIcon } from 'lucide-react'

const TABS = [
  // Customers and suppliers in one list, and where Party Accounts opens: most
  // days the question is a name, not which side of the books it sits on.
  ['all', 'All Parties'],
  ['suppliers', 'Suppliers'],
  ['customers', 'Customers'],
  ['monthly', 'Salary & Rent'],
  ['bills', 'Bills'],
  ['trial', 'Trial Balance'],
];

/**
 * Where the four old tabs went.
 *
 * Reviewing, doubting, pricing and looking through the photographs are four
 * things done to one bill, and having them four tabs apart is what made a bill
 * feel scattered. They are stages of the Bills screen now. The old names still
 * work as links — the phone's shortcut is `/?tab=pending` and there are
 * bookmarks besides.
 */
const MOVED = {
  review: 'review',
  doubt: 'doubt',
  pending: 'unpriced',
  photos: 'photos',
};

const KINDS = ['purchase', 'payment', 'sale', 'receipt'];

/** Which side of the books each voucher is written on. */
const PARTY_GROUP = {
  purchase: 'Sundry Creditors',
  payment: 'Sundry Creditors',
  sale: 'Sundry Debtors',
  receipt: 'Sundry Debtors',
  refund: 'Sundry Debtors',
};

/** Accounts kept on the Salary & Rent tab rather than with the parties. */
const MONTHLY_GROUPS = ['Staff', 'Rent Payable'];

/** Whether an account belongs on a voucher of this kind. */
const fitsVoucher = (kind, group) =>
  group === PARTY_GROUP[kind] ||
  // A goods return goes either way; a payment can be wages or rent.
  (kind === 'return' && (group === 'Sundry Debtors' || group === 'Sundry Creditors')) ||
  (kind === 'payment' && MONTHLY_GROUPS.includes(group));

/** Manifest shortcuts land here: /?new=sale, /?tab=pending. */
function launchIntent() {
  const q = new URLSearchParams(window.location.search);
  const intent = {
    tab: q.get('tab'),
    form: q.get('new'),
    capture: q.has('capture'),
  };
  if (intent.tab || intent.form) {
    window.history.replaceState({}, '', window.location.pathname);
  }
  return intent;
}

export default function App({ route, onRoute, newVoucher, onConsumeNew, onOpenVoucher }) {
  const [intent] = useState(launchIntent);

  // The phone opens straight onto the camera; nothing else on that screen.
  if (intent.capture) return <Capture />;

  // An old tab name opens Bills at the stage it became.
  const landed = MOVED[intent.tab] ? 'bills' : intent.tab;
  // The URL wins over the query-string intent: a pasted link should land where
  // it says, so every tab and every account is somewhere you can link to.
  const initialTab = route?.tab && TABS.some(([id]) => id === route.tab)
    ? route.tab
    : (TABS.some(([id]) => id === landed) ? landed : 'all');
  const [tab, setTab] = useState(initialTab);
  const [billStage] = useState(() => MOVED[intent.tab] ?? null);
  const [partyId, setPartyId] = useState(route?.partyId ?? null);

  // Follow the address bar — back/forward and pasted links both arrive here.
  useEffect(() => {
    if (route?.tab && route.tab !== tab) setTab(route.tab);
    if ((route?.partyId ?? null) !== partyId) setPartyId(route?.partyId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.tab, route?.partyId]);

  // …and write back to it, so what's on screen is always what the URL says.
  useEffect(() => {
    onRoute?.(tab, partyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, partyId]);
  const [form, setForm] = useState(() =>
    KINDS.includes(intent.form) ? { kind: intent.form } : null
  );
  const [ledgerForm, setLedgerForm] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [printing, setPrinting] = useState(null);
  const [history, setHistory] = useState(false);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));

  const masters = useLive(api.masters.all, {}, 'masters');
  const pending = useLive(api.reports.pendingBills, {}, 'pending');

  const ledgers = masters?.ledgers ?? [];
  const counts = useLive(api.review.counts, {}, 'review:counts') ?? {
    ready: 0, reading: 0, failed: 0, doubt: 0, unread: 0,
  };
  const billsCount = needsYou(counts);
  const groupOf = (id) => ledgers.find((l) => l._id === id)?.groupName;
  const onCustomers = tab === 'customers';

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('shiv-panel:theme', next ? 'dark' : 'light');
    } catch {
      /* private browsing — the choice just will not stick */
    }
  };

  // Only carry the open party into the voucher if it is on that voucher's side
  // of the books: a supplier has no business on a sale.
  const startForm = (kind, amount) => {
    const keep = partyId && groupOf(partyId) === PARTY_GROUP[kind] ? partyId : null;
    setForm({ kind, partyId: keep, amount: keep ? amount : undefined });
  };

  /**
   * The buttons on an account head for the panel's own voucher screen, taking
   * the account with them. Same test as `startForm`: the party rides along only
   * when the voucher is on their side of the books.
   */
  const addVoucher = (kind) => {
    const keep = partyId && fitsVoucher(kind, groupOf(partyId)) ? partyId : null;
    const name = keep ? ledgers.find((l) => l._id === keep)?.name : undefined;
    if (onOpenVoucher) onOpenVoucher(kind, name);
    else startForm(kind);
  };

  // A voucher asked for by link (?new=sale) opens once, then the link is spent.
  useEffect(() => {
    if (!newVoucher || !KINDS.includes(newVoucher)) return;
    startForm(newVoucher);
    onConsumeNew?.();
  }, [newVoucher]);

  // Esc closes whatever is on top; the four vouchers are on their initials.
  // The function keys are bound panel-wide instead, where they open the bill
  // builder — one key, one behaviour, wherever it is pressed. A bare letter
  // never fires while typing; that rule lives in the hook.
  const shut = () => {
    if (viewing) return setViewing(null);
    if (history) return setHistory(false);
    if (form) return setForm(null);
    if (ledgerForm) return setLedgerForm(false);
    if (printing) return setPrinting(null);
    if (partyId) return setPartyId(null);
    return undefined;
  };
  const busy = Boolean(form || ledgerForm || viewing || printing || history);
  const open = (kind) => () => { if (!busy) startForm(kind); };

  useShortcuts({
    Escape: shut,
    p: open('purchase'),
    y: open('payment'),
    s: open('sale'),
    r: open('receipt'),
  });

  // Opened from All Parties, an account stays under All Parties, so Back
  // returns to the combined list rather than to one side of it.
  const openParty = (id) => {
    setPartyId(id);
    setTab((current) =>
      current === 'all'
        ? 'all'
        : MONTHLY_GROUPS.includes(groupOf(id))
          ? 'monthly'
          : groupOf(id) === 'Sundry Debtors'
            ? 'customers'
            : 'suppliers'
    );
  };

  if (printing) {
    return <PrintPacket {...printing} onBack={() => setPrinting(null)} />;
  }

  const ledgerPane = (
    <LedgerView
      ledgerId={partyId}
      masters={masters}
      onBack={() => setPartyId(null)}
      backLabel={tab === 'all' ? 'All parties' : tab === 'monthly' ? 'Salary & Rent' : undefined}
      onViewBill={setViewing}
      onPrint={(payload) => setPrinting(payload)}
      onAddVoucher={addVoucher}
    />
  );

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="pagetitle">Party Accounts</h1>
        <div className="actions">
          {/* The four voucher buttons that were here are gone. They were the
              third way to write the same voucher and the worst of the three:
              chosen by which tab you were on, so Trial Balance offered two
              supplier buttons for no reason. The sidebar lists all four, and a
              party's own page offers the right two with the party — and the
              amount that settles them — already filled in. */}
          <button className="btn ghost" onClick={() => setLedgerForm(true)}>+ Ledger</button>
          <button className="iconbtn" onClick={() => setHistory(true)} aria-label="History" title="History">
            <HistoryIcon size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            className={`tab${tab === id ? ' on' : ''}`}
            onClick={() => {
              setTab(id);
              setPartyId(null);
            }}
          >
            {label}
            {id === 'bills' && billsCount > 0 && <span className="pill">{billsCount}</span>}
          </button>
        ))}
      </nav>

      {tab === 'all' &&
        (partyId ? (
          ledgerPane
        ) : (
          <AllParties onOpen={openParty} onPrint={() => setPrinting({ scope: 'all' })} />
        ))}

      {tab === 'suppliers' &&
        (partyId ? (
          ledgerPane
        ) : (
          <Parties
            fnRef={api.reports.outstanding}
            cacheKey="payables"
            totalLabel="Total payable"
            nameLabel="Suppliers"
            movement={[
              { label: 'Purchases', key: 'credits' },
              { label: 'Paid', key: 'debits' },
            ]}
            showUnsettled={false}
            onOpen={openParty}
            onPrint={() => setPrinting({ scope: 'all' })}
          />
        ))}

      {tab === 'customers' &&
        (partyId ? (
          ledgerPane
        ) : (
          <Parties
            fnRef={api.reports.receivables}
            cacheKey="receivables"
            totalLabel="Total due from customers"
            nameLabel="Customers"
            movement={[
              { label: 'Sold', key: 'debits' },
              { label: 'Received', key: 'credits' },
            ]}
            onOpen={openParty}
            onPrint={() => setPrinting({ scope: 'all' })}
          />
        ))}

      {tab === 'monthly' &&
        (partyId ? (
          ledgerPane
        ) : (
          <SalaryRent
            onOpen={openParty}
            onPay={(id) => {
              // Wages and rent are paid on the same voucher screen as everything
              // else, with the account already named.
              const name = id ? ledgers.find((l) => l._id === id)?.name : undefined;
              if (onOpenVoucher) onOpenVoucher('payment', name);
              else startForm('payment');
            }}
          />
        ))}

      {tab === 'bills' && (
        <Bills
          masters={masters}
          pending={pending}
          initialStage={billStage}
          onViewBill={setViewing}
          onOpen={openParty}
        />
      )}

      {tab === 'trial' && <TrialBalance />}


      {form && (
        <VoucherForm
          kind={form.kind}
          defaultPartyId={form.partyId ?? undefined}
          defaultAmount={form.amount}
          ledgers={ledgers}
          groups={masters?.groups ?? []}
          onViewBill={setViewing}
          onClose={() => setForm(null)}
        />
      )}

      {ledgerForm && (
        <LedgerForm groups={masters?.groups ?? []} onClose={() => setLedgerForm(false)} />
      )}

      {history && <History onClose={() => setHistory(false)} />}

      {viewing && <BillViewer voucher={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
