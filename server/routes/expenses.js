// Money going out — what was spent, what repeats every month, and the loans.
//
// Three things live here, and they are deliberately different shapes because
// they are different kinds of fact:
//
//   ENTRIES   Something that was actually spent, on a date, for an amount.
//             A record of the past. One book per year.
//   BILLS     Something that repeats every month — rent, salaries, the
//             electricity. Entered once, and it shows up in every month it
//             covers. A rule about the future, not a record of the past.
//   LOANS     Money being repaid: the lender, the EMI, when it started and how
//             many instalments there are. Each month's EMI is either marked
//             paid or it is not.
//
// Keeping bills and loans as RULES rather than copying them into every month
// is what stops the same rent appearing twice, and what makes correcting the
// rent one edit instead of twelve.
//
// Admin-only in both directions. What a business spends and what it owes is
// nobody else's business, so there is deliberately no public half.
const express = require('express');
const { admin, init } = require('../firebase');

const router = express.Router(); // admin-only (mounted behind adminAuth)

const COLL = 'finance';

const MAX_ENTRIES = 3000;   // per year — about eight a day, every day
const MAX_BILLS = 120;
const MAX_LOANS = 60;
const MAX_MONTHS = 720;     // months markable paid on one loan: sixty years
const MAX_TEXT = 120;
const MAX_NOTE = 600;
const MAX_BYTES = 800 * 1024;

// A ceiling that is absurd for this business but well inside what a double can
// hold exactly. It exists to catch a typo — an amount with six extra zeroes
// would otherwise silently wreck every total on the page.
const MAX_AMOUNT = 1e11;

// What kind of borrowing it is. A gold loan behaves differently enough from a
// term loan to be worth naming: it is usually interest every three months with
// the principal returned at the end, not an amortising EMI.
const LOAN_KINDS = ['Term loan', 'Gold loan', 'Vehicle loan', 'Overdraft', 'Hand loan', 'Other'];

// How the money comes back. 'emi' is a level instalment that pays down the
// balance; 'interest-only' is interest each period with the principal due at
// the end. Forcing a gold loan into the first would misstate both the payment
// and what is left owing.
const REPAY = ['emi', 'interest-only'];

// Suggestions, not a fixed list. The page offers these and accepts anything
// else typed in, the same way the document library handles its folders.
const CATEGORIES = [
  'Rent', 'Salaries', 'Electricity', 'Fuel', 'Transport', 'Raw material',
  'Machinery', 'Tools', 'Building', 'Repairs', 'Licences & fees',
  'Internet & phone', 'Marketing', 'Bank & interest', 'Other',
];

function str(v, max) {
  const s = String(v == null ? '' : v).trim();
  return max && s.length > max ? s.slice(0, max) : s;
}

// Money. Anything that is not a real number becomes 0 rather than NaN —
// one NaN in a list poisons every total downstream of it, and a wrong total
// that looks like a number is far worse than a zero you can see is wrong.
function money(v) {
  // Strip grouping and a rupee sign before parsing. The page sends numbers,
  // but anything hand-posting "10,00,000" would otherwise have it read as NaN
  // and stored as 0 — a silent loss of ten lakh, which is the worst possible
  // way for this to go wrong.
  const n = Number(typeof v === 'string' ? v.replace(/[,\s₹]/g, '') : v);
  if (!isFinite(n) || n < 0) return 0;
  return Math.round(Math.min(n, MAX_AMOUNT) * 100) / 100;
}

function int(v, lo, hi, dflt) {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

// Dates the app wrote, or nothing. A half-parsed date sorts wrongly for ever
// afterwards, and these sort into months and years.
function isoDate(v) {
  const s = String(v == null ? '' : v).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}
function isoMonth(v) {
  const s = String(v == null ? '' : v).trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s) ? s : '';
}
function months(arr) {
  const seen = Object.create(null);
  return (Array.isArray(arr) ? arr : [])
    .map(isoMonth)
    .filter((m) => m && !seen[m] && (seen[m] = 1))
    .slice(0, MAX_MONTHS)
    .sort();
}

function id(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function year(v) {
  const n = Math.round(Number(v));
  // 2000–2099. Not open-ended: the year is part of a document id, and a
  // request for year 999999999 should be a 400, not a new Firestore document.
  return isFinite(n) && n >= 2000 && n <= 2099 ? n : 0;
}

// ---- shapes ----------------------------------------------------------------

function cleanEntry(x) {
  x = x || {};
  return {
    id: str(x.id, 40) || id('e'),
    date: isoDate(x.date),
    amount: money(x.amount),
    category: str(x.category, MAX_TEXT),
    venture: str(x.venture, 60),   // a slug from ventures-data.js, or ''
    home: !!x.home,                // the house's, not the business's
    note: str(x.note, MAX_NOTE),
  };
}

function cleanBill(x) {
  x = x || {};
  return {
    id: str(x.id, 40) || id('b'),
    name: str(x.name, MAX_TEXT),
    amount: money(x.amount),
    category: str(x.category, MAX_TEXT),
    venture: str(x.venture, 60),
    dueDay: int(x.dueDay, 1, 31, 1),
    // How many months between one charge and the next. The electricity here
    // comes every two months, so 'monthly' was never the whole story. Defaults
    // to 1, which is what every bill saved before this field existed was.
    every: int(x.every, 1, 12, 1),
    // Whether this is the business's or the house's. Kept as a mark on the
    // bill rather than a separate book: the two are paid from the same hand
    // and it is the TOTALS that need to keep them apart, not the entry.
    home: !!x.home,
    from: isoMonth(x.from),
    to: isoMonth(x.to),          // '' means it is still running
    paid: months(x.paid),
    // A month this bill did not apply after all — the office was closed, the
    // machine was off. Skipping is not the same as deleting the bill, and not
    // the same as paying nothing: it says "this month, there was no charge".
    skip: months(x.skip),
    note: str(x.note, MAX_NOTE),
  };
}

// A tranche. A sanction is not a payment: KFC and every other lender releases
// against progress, so what has actually reached the account is its own fact,
// separate from what was agreed.
function cleanRelease(x) {
  x = x || {};
  return {
    id: str(x.id, 40) || id('r'),
    date: isoDate(x.date),
    amount: money(x.amount),
    note: str(x.note, MAX_TEXT),
  };
}

function cleanLoan(x) {
  x = x || {};
  const start = isoMonth(x.start);
  const moratorium = int(x.moratorium, 0, 120, 0);
  return {
    id: str(x.id, 40) || id('l'),
    lender: str(x.lender, MAX_TEXT),
    purpose: str(x.purpose, MAX_TEXT),
    // What was sanctioned. Named principal from the start and left that way —
    // renaming a stored field to read better costs every existing record.
    principal: money(x.principal),
    emi: money(x.emi),
    rate: (function () {
      const n = Number(x.rate);
      return isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) / 100 : 0;
    })(),
    dueDay: int(x.dueDay, 1, 31, 5),
    kind: LOAN_KINDS.indexOf(x.kind) >= 0 ? x.kind : 'Term loan',
    repay: REPAY.indexOf(x.repay) >= 0 ? x.repay : 'emi',
    // Months between one instalment and the next. A gold loan is commonly
    // three. 1 is monthly, and is what every loan saved before this existed
    // was, so nothing already stored moves.
    every: int(x.every, 1, 12, 1),
    // The month the loan starts, and how many months of holiday before the
    // first instalment. When both are set the page derives `from` from them,
    // so the schedule still keys off one field.
    start: start,
    moratorium: moratorium,
    from: isoMonth(x.from),
    // NUMBER OF INSTALMENTS, not months. With `every` above 1 the two differ,
    // and calling it months would make a three-yearly gold loan look like a
    // three-month one.
    months: int(x.months, 0, 600, 0),
    releases: (Array.isArray(x.releases) ? x.releases : [])
      .slice(0, 60).map(cleanRelease).filter((r) => r.amount || r.date),
    venture: str(x.venture, 60),
    paid: months(x.paid),
    note: str(x.note, MAX_NOTE),
  };
}

// How far ahead a due date should start being flagged. Stored rather than
// assumed: five days suits a bill you pay from the phone, ten suits one that
// needs money moving between accounts first.
function cleanSettings(x) {
  x = x || {};
  return {
    remindDays: int(x.remindDays, 0, 60, 5),
    // A browser notification, and only that. It cannot reach a phone that is
    // not looking at this page, and the wording on the page says so — a
    // reminder someone believes in and does not get is worse than none.
    notify: !!x.notify,
  };
}

// ---- storage ---------------------------------------------------------------
//
// Three documents rather than three collections of small ones: a year of
// spending, the bills, the loans. Each read is one fetch and each save is
// atomic, so a list can never be half-written. The cost is a 1 MB ceiling per
// document, which the limits above stay well inside — 3000 entries is about
// 300 KB.

function ready(res) {
  try {
    init();
    return true;
  } catch (e) {
    res.status(503).json({ error: 'Storage is not available right now.' });
    return false;
  }
}

function docRef(key) {
  return admin.firestore().collection(COLL).doc(key);
}

async function readList(key, clean, max) {
  const doc = await docRef(key).get();
  const d = doc.exists ? (doc.data() || {}) : {};
  const items = Array.isArray(d.items) ? d.items : [];
  return items.slice(0, max).map(clean);
}

// Refuse rather than truncate. Everything here saves as a whole list, so
// quietly dropping the tail would lose an expense with nobody noticing until
// the month did not add up.
function tooBig(res, payload) {
  const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (bytes > MAX_BYTES) {
    res.status(413).json({
      error: `That is ${Math.round(bytes / 1024)} KB, too big to store in one go.`,
    });
    return true;
  }
  return false;
}

async function saveList(res, key, items) {
  const payload = { items };
  if (tooBig(res, payload)) return null;
  await docRef(key).set(
    { items, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
  return items;
}

// ---- read everything at once ----------------------------------------------
//
// One request for a year: its entries, plus the bills and loans, because the
// month view needs all three to add up a month and there is no sense making
// the page wait for three round trips on a cold server.

router.get('/finance', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, private');
  if (!ready(res)) return;

  const y = year(req.query.year || new Date().getFullYear());
  if (!y) return res.status(400).json({ error: 'That is not a year I can store.' });

  try {
    const [entriesDoc, bills, loans, settingsDoc] = await Promise.all([
      docRef('year-' + y).get(),
      readList('bills', cleanBill, MAX_BILLS),
      readList('loans', cleanLoan, MAX_LOANS),
      docRef('settings').get(),
    ]);
    const raw = entriesDoc.exists ? (entriesDoc.data() || {}) : {};
    const entries = (Array.isArray(raw.entries) ? raw.entries : [])
      .slice(0, MAX_ENTRIES)
      .map(cleanEntry)
      // Newest first, and an entry with no date last rather than dropped:
      // it is still money that went out, and hiding it would hide a mistake.
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));

    res.json({
      year: y, entries, bills, loans,
      settings: cleanSettings(settingsDoc.exists ? settingsDoc.data() : null),
      categories: CATEGORIES,
      loanKinds: LOAN_KINDS,
    });
  } catch (err) {
    console.error('GET /api/finance failed:', err);
    res.status(500).json({ error: 'Could not load the expenses.' });
  }
});

// ---- the year's entries ----------------------------------------------------

router.put('/finance/entries/:year', async (req, res) => {
  if (!ready(res)) return;
  const y = year(req.params.year);
  if (!y) return res.status(400).json({ error: 'That is not a year I can store.' });

  const raw = Array.isArray((req.body || {}).entries) ? req.body.entries : [];
  if (raw.length > MAX_ENTRIES) {
    return res.status(400).json({
      error: `That is more than ${MAX_ENTRIES} expenses in one year.`,
    });
  }

  // An entry dated into a different year would vanish: it is saved in this
  // year's book but read back with that year's. Say so rather than lose it.
  const stray = raw.map(cleanEntry).find((e) => e.date && e.date.slice(0, 4) !== String(y));
  if (stray) {
    return res.status(400).json({
      error: `"${stray.category || 'That expense'}" is dated ${stray.date}, which is not ${y}. `
           + 'Change the date, or switch year first and add it there.',
    });
  }

  const entries = raw.map(cleanEntry);
  const payload = { entries };
  if (tooBig(res, payload)) return;

  try {
    await docRef('year-' + y).set(
      { entries, year: y, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    res.json({ year: y, entries });
  } catch (err) {
    console.error('PUT /api/finance/entries failed:', err);
    res.status(500).json({ error: 'Could not save the expenses.' });
  }
});

// ---- repeating bills -------------------------------------------------------

router.put('/finance/bills', async (req, res) => {
  if (!ready(res)) return;
  const raw = Array.isArray((req.body || {}).items) ? req.body.items : [];
  if (raw.length > MAX_BILLS) {
    return res.status(400).json({ error: `That is more than ${MAX_BILLS} repeating bills.` });
  }
  const items = raw.map(cleanBill);

  // A bill that ends before it starts would show in no month at all and look
  // like it had failed to save.
  const backwards = items.find((b) => b.from && b.to && b.to < b.from);
  if (backwards) {
    return res.status(400).json({
      error: `"${backwards.name || 'That bill'}" ends (${backwards.to}) before it starts (${backwards.from}).`,
    });
  }

  try {
    const saved = await saveList(res, 'bills', items);
    if (saved) res.json({ items: saved });
  } catch (err) {
    console.error('PUT /api/finance/bills failed:', err);
    res.status(500).json({ error: 'Could not save the bills.' });
  }
});

// ---- loans -----------------------------------------------------------------

router.put('/finance/loans', async (req, res) => {
  if (!ready(res)) return;
  const raw = Array.isArray((req.body || {}).items) ? req.body.items : [];
  if (raw.length > MAX_LOANS) {
    return res.status(400).json({ error: `That is more than ${MAX_LOANS} loans.` });
  }
  const items = raw.map(cleanLoan);

  // More instalments marked paid than the loan has is a sign something has
  // gone wrong upstream, and it would make "left to pay" go negative.
  const over = items.find((l) => l.months && l.paid.length > l.months);
  if (over) {
    return res.status(400).json({
      error: `"${over.lender || 'That loan'}" has ${over.paid.length} instalments marked paid `
           + `but only ${over.months} in total.`,
    });
  }

  // A release dated before the loan starts is almost always a typo in the
  // year, and it would quietly sit outside every total that sums by period.
  const early = items.find((l) => l.start && l.releases.some((r) => r.date && r.date.slice(0, 7) < l.start));
  if (early) {
    return res.status(400).json({
      error: `"${early.lender || 'That loan'}" has money released before the loan starts (${early.start}). `
           + 'Check the date on it.',
    });
  }

  try {
    const saved = await saveList(res, 'loans', items);
    if (saved) res.json({ items: saved });
  } catch (err) {
    console.error('PUT /api/finance/loans failed:', err);
    res.status(500).json({ error: 'Could not save the loans.' });
  }
});

// ---- reminder settings -----------------------------------------------------

router.put('/finance/settings', async (req, res) => {
  if (!ready(res)) return;
  const settings = cleanSettings(req.body);
  try {
    await docRef('settings').set(
      { ...settings, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    res.json(settings);
  } catch (err) {
    console.error('PUT /api/finance/settings failed:', err);
    res.status(500).json({ error: 'Could not save the reminder setting.' });
  }
});

module.exports = {
  router,
  LOAN_KINDS,
  REPAY,
  CATEGORIES,
  MAX_ENTRIES,
  MAX_BILLS,
  MAX_LOANS,
  // Exported for the tests, which check the arithmetic these produce.
  _clean: { cleanEntry, cleanBill, cleanLoan, cleanSettings, money, isoMonth, year },
};
