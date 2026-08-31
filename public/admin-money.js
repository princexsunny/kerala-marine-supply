// The expenses folder: the month, the loans, the repeating bills.
//
// A file of its own rather than more code inside admin.html. That page's
// script is one long IIFE holding the photos, documents, applications and
// roadmaps; adding a fourth subject to it makes every future change to any of
// them riskier. Nothing here reaches into it and nothing there reaches in
// here — the only join is window.KMS_MONEY.show(), which admin.html calls when
// one of these pages becomes visible.
//
// Three kinds of fact, kept apart on purpose (the server file says why at
// more length): ENTRIES are money that went out on a date; BILLS are a rule
// that repeats every month; LOANS are a rule with an end to it. Bills and
// loans are never copied into a month — they are worked out for the month you
// are looking at, so correcting the rent is one edit and not twelve.
//
// READ, THEN EDIT, THEN SAVE. Everything shows as a plain list. One row at a
// time opens into a form, and nothing leaves the page until Save is pressed.
// The earlier version saved every keystroke, which meant a half-typed amount
// was briefly the truth and there was no moment where you could say "that is
// what I meant". The two exceptions are the paid and skipped ticks: a tick is
// a whole action on its own, so it saves at once.
(function () {
  'use strict';

  var API = '/api/finance';

  // ---- money ---------------------------------------------------------------
  //
  // Indian digit grouping: 1,23,456 rather than 123,456. Getting this wrong on
  // a page of lakhs is the sort of thing that makes someone stop trusting the
  // rest of the numbers.
  function rupees(n) {
    var v = Number(n) || 0;
    var s = Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    return (v < 0 ? '−₹' : '₹') + s;
  }
  function num(v) {
    var n = Number(String(v == null ? '' : v).replace(/[, ₹]/g, ''));
    return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
  }

  // ---- months --------------------------------------------------------------
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function thisMonth() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function shiftMonth(m, by) {
    var y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7)) - 1 + by;
    y += Math.floor(mo / 12);
    mo = ((mo % 12) + 12) % 12;
    return y + '-' + pad2(mo + 1);
  }
  function monthDiff(a, b) {
    return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12
         + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)));
  }
  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];
  function monthName(m) {
    return MONTH_NAMES[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(0, 4);
  }
  // A due date in a month that may not have that day in it. A bill due on the
  // 31st is due on the 28th of February, not on the 3rd of March.
  function dueDate(month, day) {
    var y = Number(month.slice(0, 4)), mo = Number(month.slice(5, 7));
    var last = new Date(y, mo, 0).getDate();
    return month + '-' + pad2(Math.min(Math.max(1, day || 1), last));
  }
  function prettyDate(iso) {
    if (!iso) return '—';
    return iso.slice(8, 10) + ' ' + MONTH_NAMES[Number(iso.slice(5, 7)) - 1].slice(0, 3)
         + ' ' + iso.slice(0, 4);
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : s;
    return d.innerHTML;
  }
  function el(id) { return document.getElementById(id); }
  function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }

  // ---- what applies in a given month ---------------------------------------

  // How many months between one charge and the next. Anything saved before the
  // field existed is monthly, which is what it always was.
  function every(x) { return Math.max(1, Math.round(Number(x && x.every) || 1)); }

  // Does this bill fall in this month? Not just "is it running" — a bill every
  // two months falls in every OTHER month, counted from the one it started in.
  function billIn(b, month) {
    if (!b.from || month < b.from) return false;
    if (b.to && month > b.to) return false;
    return monthDiff(b.from, month) % every(b) === 0;
  }
  // Which instalment number this month is, or -1 if none is due. With `every`
  // above 1 most months have none: a gold loan paying every three months is
  // due in one month out of three, and silently charging it monthly would
  // overstate the year by a factor of three.
  //
  // A loan with months = 0 has not been told how long it runs, so it is
  // treated as still running rather than as finished.
  function loanInstalment(l, month) {
    if (!l.from || month < l.from) return -1;
    var d = monthDiff(l.from, month);
    var n = every(l);
    if (d % n !== 0) return -1;
    var i = d / n;
    if (l.months && i >= l.months) return -1;
    return i;
  }
  // What one payment is made of, and what it leaves behind.
  //
  //   emi            a level instalment that pays the balance down to nothing
  //   interest-only  interest each period, principal returned at the end
  //
  // A gold loan is the second. Forcing it into the first would understate the
  // payment and, far worse, show nothing left owing when the whole principal
  // still is.
  function periodRate(l) {
    return (Number(l.rate) || 0) / 100 * (every(l) / 12);
  }
  function calcPayment(l) {
    var P = Number(l.principal) || 0;
    var n = Math.round(Number(l.months) || 0);
    var r = periodRate(l);
    if (!P) return 0;
    if (l.repay === 'interest-only') return Math.round(P * r * 100) / 100;
    if (!n) return 0;
    if (!r) return Math.round(P / n * 100) / 100;   // interest free: just split it
    var f = Math.pow(1 + r, n);
    return Math.round(P * r * f / (f - 1) * 100) / 100;
  }
  function has(arr, m) { return (arr || []).indexOf(m) !== -1; }
  function toggle(arr, m, on) {
    var i = arr.indexOf(m);
    if (on && i === -1) arr.push(m);
    if (!on && i !== -1) arr.splice(i, 1);
    arr.sort();
  }

  // Everything that falls due in one month, bills and instalments together.
  // ONE function, used by the month list, the twelve-month outlook and the
  // reminders — three places that must never disagree about what is due.
  function dueItems(D, m) {
    var rows = [];
    (D.bills || []).forEach(function (b) {
      if (!billIn(b, m)) return;
      rows.push({
        kind: 'bill', id: b.id, name: b.name || 'Untitled bill',
        what: (b.category || 'Bill') + (every(b) > 1 ? ' · ' + cadence(b) : ''),
        amount: b.amount, when: dueDate(m, b.dueDay),
        paid: has(b.paid, m), skipped: has(b.skip, m),
        venture: b.venture, home: !!b.home,
      });
    });
    (D.loans || []).forEach(function (l) {
      // Interest through the moratorium. A real payment with a real date, in
      // the list beside the bills — not a footnote. It is what the bank takes
      // every month while no instalment is running.
      if (inMoratorium(l, m)) {
        var due = monthInterest(l, m);
        if (due > 0) {
          rows.push({
            kind: 'interest', id: l.id, name: (l.lender || 'Untitled loan') + ' — moratorium interest',
            what: 'On ' + rupees(releasedBy(l, m)) + ' released',
            amount: due, when: dueDate(m, l.dueDay),
            paid: has(l.intPaid || [], m), skipped: false,
            venture: l.venture, home: false,
          });
        }
      }
      var i = loanInstalment(l, m);
      if (i < 0) return;
      rows.push({
        kind: 'loan', id: l.id, name: l.lender || 'Untitled loan',
        what: (l.repay === 'interest-only' ? 'Interest ' : 'EMI ') + (i + 1) +
              (l.months ? ' of ' + l.months : '') +
              (every(l) > 1 ? ' · ' + cadence(l) : ''),
        amount: l.emi, when: dueDate(m, l.dueDay),
        paid: has(l.paid, m), skipped: false,
        venture: l.venture, home: false,
      });
    });
    rows.sort(function (a, b) { return a.when.localeCompare(b.when); });
    return rows;
  }

  // What a month costs: recorded spending, plus whatever falls due in it.
  // Bills and instalments count whether or not they have been ticked paid —
  // an unpaid bill is still that month's cost.
  //
  // The house and the business are added up separately as well as together.
  // One number covering both is a number that answers neither question.
  function monthTotals(D, month) {
    var out = { spent: 0, bills: 0, emi: 0, byCat: {}, count: 0, home: 0, business: 0 };
    function add(cat, amt, home) {
      out.byCat[cat || 'Uncategorised'] = (out.byCat[cat || 'Uncategorised'] || 0) + amt;
      if (home) out.home += amt; else out.business += amt;
    }
    (D.entries || []).forEach(function (e) {
      if (e.date.slice(0, 7) !== month) return;
      out.spent += e.amount; out.count++; add(e.category, e.amount, e.home);
    });
    dueItems(D, month).forEach(function (r) {
      if (r.skipped) return;
      if (r.kind === 'bill') { out.bills += r.amount; add(r.what.split(' · ')[0], r.amount, r.home); }
      else if (r.kind === 'interest') { out.emi += r.amount; add('Loan interest', r.amount, false); }
      else { out.emi += r.amount; add('Loan EMI', r.amount, false); }
    });
    out.total = out.spent + out.bills + out.emi;
    return out;
  }

  // What is left to pay: the instalments not yet ticked, times the EMI. This
  // is NOT the outstanding principal — an EMI is part interest — and it is
  // labelled that way everywhere it appears, because quoting it as principal
  // would overstate what a bank would accept to close the loan.
  function left(l) {
    if (!l.months) return 0;
    var owing = Math.max(0, l.months - l.paid.length) * l.emi;
    // Interest-only: the payments are interest, and the principal is still
    // there at the end. Leaving it out would say a gold loan was nearly
    // settled when none of it has been repaid at all.
    if (l.repay === 'interest-only') owing += Number(l.principal) || 0;
    return owing;
  }
  // What has actually reached the account, as against what was agreed. A
  // sanction is a promise; a release is money.
  function released(l) {
    return (l.releases || []).reduce(function (a, r) { return a + (Number(r.amount) || 0); }, 0);
  }
  // The month the first EMI falls in. When a start month and a moratorium are
  // both given, that is where it lands — six months of holiday from June means
  // the first EMI is in December. Otherwise it is whatever was typed in.
  function firstEmi(l) {
    if (l.start) return shiftMonth(l.start, l.moratorium || 0);
    return l.from || '';
  }
  // The last month of the holiday, or '' if there isn't one.
  function moratoriumEnds(l) {
    if (!l.start || !l.moratorium) return '';
    return shiftMonth(l.start, l.moratorium - 1);
  }
  function inMoratorium(l, m) {
    var end = moratoriumEnds(l);
    return !!end && m >= l.start && m <= end;
  }
  // ---- interest through the moratorium --------------------------------------
  //
  // A moratorium is a holiday from the INSTALMENT, not from the interest. The
  // interest still has to be paid every month, and it is charged on what has
  // actually been released — not on the sanction, because money that has not
  // arrived cannot cost anything.
  //
  // Worked on the daily product, which is how the bank does it: each tranche
  // earns from the day it lands, for the days it is outstanding in that month,
  // at rate/365. A tranche released on the 20th earns for eleven days of that
  // month, not a whole one and not none.
  //
  // 365, not 360 or 366: it is what Indian lenders quote against, and being
  // consistent matters more here than the fourth decimal place.
  function monthInterest(l, m) {
    if (!l || !l.rate || !m) return 0;
    var from = m + '-01';
    var toEx = shiftMonth(m, 1) + '-01';       // first day of the next month
    var total = 0;
    (l.releases || []).forEach(function (r) {
      if (!r || !r.date || !r.amount) return;
      var since = r.date > from ? r.date : from;
      if (since >= toEx) return;               // released after this month ended
      var days = daysBetween(since, toEx);
      total += Number(r.amount) * (Number(l.rate) / 100) * days / 365;
    });
    return Math.round(total * 100) / 100;
  }

  // Every month of the moratorium, with what the interest comes to in it and
  // how much had been released by then. This is the answer to "how is it going
  // now" — the running cost of money already drawn.
  function moratoriumSchedule(l) {
    var end = moratoriumEnds(l);
    if (!l.start || !end) return [];
    var out = [], m = l.start, guard = 0;
    while (m <= end && guard++ < 130) {
      out.push({
        month: m,
        released: releasedBy(l, m),
        interest: monthInterest(l, m),
        paid: has(l.intPaid || [], m),
        due: dueDate(m, l.dueDay),
      });
      m = shiftMonth(m, 1);
    }
    return out;
  }
  // What had reached the account by the end of a given month.
  function releasedBy(l, m) {
    var toEx = shiftMonth(m, 1) + '-01';
    return (l.releases || []).reduce(function (a, r) {
      return a + ((r && r.date && r.date < toEx) ? (Number(r.amount) || 0) : 0);
    }, 0);
  }
  function moratoriumTotal(l) {
    return Math.round(moratoriumSchedule(l).reduce(function (a, r) { return a + r.interest; }, 0) * 100) / 100;
  }
  // NOT `years`: that name is already the year -> entries cache below, and a
  // var declaration would quietly overwrite this function.
  // The term in years, which is instalments x months-between, NOT the number of
  // instalments. Twelve quarterly payments is three years, not one.
  function termYears(l) {
    var n = Math.round(Number(l && l.months) || 0);
    if (!n) return '';
    var m = n * every(l);
    return m % 12 === 0 ? (m / 12) + (m === 12 ? ' year' : ' years')
                        : (m / 12).toFixed(1) + ' years';
  }
  // "every 3 months" / "monthly", for saying out loud.
  function cadence(x) {
    var n = every(x);
    return n === 1 ? 'monthly' : n === 12 ? 'once a year' : 'every ' + n + ' months';
  }

  function nextDue(l) {
    if (!l.from) return '';
    var i = l.paid.length;
    if (l.months && i >= l.months) return '';
    // i instalments in, each `every` months apart.
    return dueDate(shiftMonth(l.from, i * every(l)), l.dueDay);
  }

  // Anything unpaid whose date has passed, or is within the reminder window.
  // Looks across THREE months — last, this and next — because a bill due on
  // the 2nd needs flagging in the last week of the month before.
  function dueSoon(D, days) {
    var now = today();
    var edge = addDays(now, days);
    var out = [];
    [shiftMonth(thisMonth(), -1), thisMonth(), shiftMonth(thisMonth(), 1)].forEach(function (m) {
      dueItems(D, m).forEach(function (r) {
        if (r.paid || r.skipped) return;
        if (r.when > edge) return;
        out.push({ item: r, late: r.when < now, days: daysBetween(now, r.when) });
      });
    });
    out.sort(function (a, b) { return a.item.when.localeCompare(b.item.when); });
    return out;
  }
  function addDays(iso, n) {
    var d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function daysBetween(a, b) {
    return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  }
  function inDays(n) {
    return n === 0 ? 'today' : n === 1 ? 'tomorrow'
         : n < 0 ? (-n) + (n === -1 ? ' day late' : ' days late')
         : 'in ' + n + ' days';
  }

  // ---- state ---------------------------------------------------------------

  var D = { year: 0, entries: [], bills: [], loans: [], categories: [] };
  var month = thisMonth();
  var loaded = {};        // years already fetched, so switching back is instant
  var years = {};         // year -> entries, so a year switch does not lose the other
  var ready = false;
  var current = '';       // which page is open

  // The one thing being edited, if any. At most one at a time: two open forms
  // means two answers to "what happens when I press Save", and a list you can
  // no longer read at a glance.
  //   { kind: 'entry'|'loan'|'bill', id, draft, isNew }
  var edit = null;

  // Reminder settings, and whether the twelve-month outlook is showing. The
  // outlook is a view of the same data, not a page — opening it should not
  // lose the month you were looking at.
  var settings = { remindDays: 5, notify: false };
  var showCal = false;
  var notified = false;   // one notification a visit, not one a render

  function ventures() {
    return (window.KMS_VISIBLE || window.KMS_VENTURES || []).filter(function (v) { return !v.hidden; });
  }
  function ventureName(slug) {
    var v = ventures().filter(function (x) { return x.slug === slug; })[0];
    return v ? v.name.replace(/^Shalom /, '') : '';
  }

  // ---- saving --------------------------------------------------------------
  //
  // Explicit. commit() is called by a Save button, or by a tick, and goes
  // straight to the server — there is no debounce and no queue, because there
  // is no longer a stream of keystrokes to absorb.

  var inFlight = 0;

  function setStatus(text, bad) {
    var n = el('moStatus');
    if (!n) return;
    n.textContent = text || '';
    n.className = 'mo-status' + (bad ? ' bad' : '');
  }

  function commit(what, then) {
    var url = what === 'entries' ? API + '/entries/' + D.year : API + '/' + what;
    var body = what === 'entries' ? { entries: D.entries } : { items: D[what] };
    inFlight++;
    setStatus('Saving…');
    return fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error(j.error || 'Could not save.');
          return j;
        });
      })
      .then(function (j) {
        inFlight--;
        setStatus('Saved at ' + new Date().toLocaleTimeString('en-IN',
          { hour: '2-digit', minute: '2-digit' }));
        if (then) then(j);
      })
      .catch(function (err) {
        inFlight--;
        // The change is still on screen and still in memory. Saying what went
        // wrong is better than reverting under the reader and losing the work.
        setStatus(err.message + ' Nothing was lost — press Save again.', true);
        throw err;
      });
  }

  // Leaving with a form open would lose whatever is in it, and the browser is
  // the only thing that can stop that in time.
  window.addEventListener('beforeunload', function (e) {
    if (!edit) return;
    e.preventDefault();
    e.returnValue = '';
    return '';
  });

  function saveSettings() {
    fetch(API + '/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(settings),
    }).catch(function () {
      setStatus('Could not save the reminder setting.', true);
    });
  }

  // One notification a visit, naming the nearest payment and how many others
  // there are. Firing one per item would be a wall of boxes.
  function maybeNotify() {
    if (!settings.notify || notified) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    var soon = dueSoon(D, settings.remindDays);
    if (!soon.length) return;
    notified = true;
    var first = soon[0];
    var rest = soon.length - 1;
    try {
      new Notification(
        soon.filter(function (x) { return x.late; }).length ? 'A payment is overdue' : 'A payment is coming up',
        {
          body: first.item.name + ' — ' + rupees(first.item.amount) + ', ' + inDays(first.days) +
                (rest ? '\nand ' + rest + ' more' : ''),
          tag: 'kms-money',
        }
      );
    } catch (e) {}
  }

  // ---- loading -------------------------------------------------------------

  function load(y, then) {
    if (loaded[y]) {
      D.year = y; D.entries = years[y];
      if (then) then();
      return;
    }
    setStatus('Loading…');
    fetch(API + '?year=' + y, { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) {
        if (r.status === 401) throw new Error('Your session has ended. Sign in again.');
        return r.json().then(function (j) {
          if (!r.ok) throw new Error(j.error || 'Could not load.');
          return j;
        });
      })
      .then(function (j) {
        years[y] = j.entries || [];
        loaded[y] = true;
        D.year = y;
        D.entries = years[y];
        D.bills = j.bills || [];
        D.loans = j.loans || [];
        D.categories = j.categories || [];
        if (j.settings) settings = j.settings;
        ready = true;
        setStatus('');
        paintTiles();
        maybeNotify();
        if (then) then();
      })
      .catch(function (err) {
        setStatus(err.message, true);
        ready = false;
        if (then) then();
      });
  }

  function yearOf(m) { return Number(m.slice(0, 4)); }

  // ---- the front tiles -----------------------------------------------------

  function paintTiles() {
    var t = monthTotals(D, month);
    var m = el('moTileMeta');
    if (m) {
      var late = dueSoon(D, settings.remindDays).filter(function (x) { return x.late; }).length;
      m.textContent = late
        ? late + (late === 1 ? ' payment overdue' : ' payments overdue')
        : rupees(t.total) + ' this month';
    }
    var mm = el('moMonthMeta');
    if (mm) mm.textContent = t.count + (t.count === 1 ? ' entry' : ' entries');
    var lm = el('moLoanMeta');
    if (lm) {
      var due = D.loans.filter(function (l) { return loanInstalment(l, month) >= 0; });
      lm.textContent = D.loans.length ? due.length + ' due this month' : 'none yet';
    }
    var bm = el('moBillMeta');
    if (bm) {
      var on = D.bills.filter(function (b) { return billIn(b, month); });
      bm.textContent = D.bills.length ? on.length + ' this month' : 'none yet';
    }
  }

  // ---- shared bits ---------------------------------------------------------

  function catOptions() {
    var used = {};
    D.categories.forEach(function (c) { used[c] = 1; });
    D.entries.forEach(function (e) { if (e.category) used[e.category] = 1; });
    D.bills.forEach(function (b) { if (b.category) used[b.category] = 1; });
    return Object.keys(used).sort().map(function (c) {
      return '<option value="' + esc(c) + '"></option>';
    }).join('');
  }

  function ventureSelect(value, cls) {
    return '<select class="' + cls + '">' +
      '<option value="">— no venture —</option>' +
      ventures().map(function (v) {
        var n = v.name.replace(/^Shalom /, '');
        return '<option value="' + esc(v.slug) + '"' + (v.slug === value ? ' selected' : '') + '>' +
               esc(v.num + ' · ' + n) + '</option>';
      }).join('') + '</select>';
  }

  // Months between one charge and the next. A dropdown, not a free number: the
  // useful values are few and named, and "every 2 months" said in words is
  // harder to misread than a bare 2 in a box.
  var EVERY_LABELS = { 1: 'Every month', 2: 'Every 2 months', 3: 'Every 3 months (quarterly)',
                       4: 'Every 4 months', 6: 'Every 6 months (half yearly)', 12: 'Once a year' };
  var LOAN_KINDS = ['Term loan', 'Gold loan', 'Vehicle loan', 'Overdraft', 'Hand loan', 'Other'];
  function kindOptions(v) {
    return LOAN_KINDS.map(function (k) {
      return '<option value="' + esc(k) + '"' + (k === v ? ' selected' : '') + '>' + esc(k) + '</option>';
    }).join('');
  }

  function everyOptions(v) {
    return [1, 2, 3, 4, 6, 12].map(function (n) {
      return '<option value="' + n + '"' + (n === v ? ' selected' : '') + '>' + EVERY_LABELS[n] + '</option>';
    }).join('');
  }

  function statusBar() { return '<p class="mo-status" id="moStatus"></p>'; }
  function emptyNote(t) { return '<p class="mo-empty">' + esc(t) + '</p>'; }
  function saveRow(label) {
    return '<div class="mo-row mo-save">' +
      '<button type="button" class="mo-btn f-save">' + esc(label || 'Save') + '</button>' +
      '<button type="button" class="mo-btn mo-quiet f-cancel">Cancel</button>' +
      '<span class="mo-editing">Not saved yet</span>' +
    '</div>';
  }

  // Editing anything else while a form is open would silently drop what is in
  // it. Asking is the only honest option.
  function leaveEdit() {
    if (!edit) return true;
    if (!confirm('You have not saved what you were editing. Leave it and lose the change?')) return false;
    if (edit.isNew) removeNew(edit);
    edit = null;
    return true;
  }
  function removeNew(e) {
    if (e.kind === 'entry') {
      D.entries = D.entries.filter(function (x) { return x.id !== e.id; });
      years[D.year] = D.entries;
    } else if (e.kind === 'loan') {
      D.loans = D.loans.filter(function (x) { return x.id !== e.id; });
    } else {
      D.bills = D.bills.filter(function (x) { return x.id !== e.id; });
    }
  }

  // ---- page: the month -----------------------------------------------------

  function renderMonth() {
    var host = el('moMonth');
    if (!host) return;
    if (!ready) { host.innerHTML = statusBar(); setStatus('Loading…'); return; }

    var t = monthTotals(D, month);
    var prev = shiftMonth(month, -1);
    var pt = loaded[yearOf(prev)]
      ? monthTotals({ entries: years[yearOf(prev)] || [], bills: D.bills, loans: D.loans }, prev)
      : null;

    var diff = pt ? t.total - pt.total : null;
    var change = diff === null
      ? '<span class="mo-flat">' + esc(monthName(prev)) + ' not loaded yet</span>'
      : (Math.abs(diff) < 0.005
          ? '<span class="mo-flat">Same as ' + esc(monthName(prev)) + '</span>'
          : '<span class="' + (diff > 0 ? 'mo-up' : 'mo-down') + '">' +
            (diff > 0 ? '▲ ' : '▼ ') + rupees(Math.abs(diff)) +
            (diff > 0 ? ' more' : ' less') + ' than ' + esc(monthName(prev)) + '</span>');

    var cats = Object.keys(t.byCat).sort(function (a, b) { return t.byCat[b] - t.byCat[a]; });
    var biggest = cats.length ? t.byCat[cats[0]] : 0;

    host.innerHTML =
      '<div class="mo-bar">' +
        '<button type="button" class="mo-nav" id="moPrev" aria-label="Previous month">‹</button>' +
        '<input type="month" id="moPick" value="' + month + '">' +
        '<button type="button" class="mo-nav" id="moNext" aria-label="Next month">›</button>' +
        '<button type="button" class="mo-nav mo-today" id="moNow">This month</button>' +
        '<button type="button" class="mo-nav mo-today' + (showCal ? ' mo-onnow' : '') + '" id="moCal">' +
          (showCal ? '✕ Close calendar' : '▦ Calendar — next 12 months') + '</button>' +
      '</div>' +
      (showCal ? renderCalendar() : '') +
      renderRemind() +

      '<div class="mo-cards">' +
        '<div class="mo-card mo-big"><span class="k">Total for ' + esc(monthName(month)) + '</span>' +
          '<strong>' + rupees(t.total) + '</strong><span class="c">' + change + '</span></div>' +
        '<div class="mo-card"><span class="k">Business</span><strong>' + rupees(t.business) + '</strong>' +
          '<span class="c">' + (t.total ? Math.round(t.business / t.total * 100) : 0) + '% of the month</span></div>' +
        '<div class="mo-card"><span class="k">Home</span><strong>' + rupees(t.home) + '</strong>' +
          '<span class="c">' + (t.total ? Math.round(t.home / t.total * 100) : 0) + '% of the month</span></div>' +
        '<div class="mo-card"><span class="k">Spent</span><strong>' + rupees(t.spent) + '</strong>' +
          '<span class="c">' + t.count + (t.count === 1 ? ' entry' : ' entries') + '</span></div>' +
        '<div class="mo-card"><span class="k">Repeating bills</span><strong>' + rupees(t.bills) + '</strong>' +
          '<span class="c"><a href="admin.html?p=money-bills">manage</a></span></div>' +
        '<div class="mo-card"><span class="k">Loan EMI</span><strong>' + rupees(t.emi) + '</strong>' +
          '<span class="c"><a href="admin.html?p=money-loans">manage</a></span></div>' +
      '</div>' +

      '<div class="mo-head"><h3 class="mo-h">Spent in ' + esc(monthName(month)) + '</h3>' +
        '<button type="button" class="mo-btn" id="moAddEntry">Add an expense</button></div>' +
      statusBar() +
      '<datalist id="moCats">' + catOptions() + '</datalist>' +
      renderEntryList() +

      '<h3 class="mo-h">Due this month</h3>' +
      renderDueList(month) +

      '<h3 class="mo-h">Where it went</h3>' +
      (cats.length
        ? '<div class="mo-split">' + cats.map(function (c) {
            var v = t.byCat[c];
            return '<div class="mo-srow"><span class="n">' + esc(c) + '</span>' +
                   '<span class="b"><i style="width:' + (biggest ? Math.max(2, v / biggest * 100) : 0) + '%"></i></span>' +
                   '<span class="v">' + rupees(v) + '</span>' +
                   '<span class="p">' + (t.total ? Math.round(v / t.total * 100) : 0) + '%</span></div>';
          }).join('') + '</div>'
        : emptyNote('Nothing in this month yet.'));

    bindMonth();
  }

  // The list. Plain rows you can read down, with one row swapped for a form
  // when it is being edited.
  // Twelve months at a glance, so a future amount can be checked without
  // walking forward a month at a time. Only bills and instalments — a future
  // month has no recorded spending in it yet, and showing a total that mixed
  // the two would make this month look bigger than the ones after it.
  function renderCalendar() {
    var start = thisMonth();
    var cells = [], grand = 0;
    for (var i = 0; i < 12; i++) {
      var m = shiftMonth(start, i);
      var rows = dueItems(D, m).filter(function (r) { return !r.skipped; });
      var sum = rows.reduce(function (a, r) { return a + r.amount; }, 0);
      grand += sum;
      var unpaid = rows.filter(function (r) { return !r.paid; }).length;
      cells.push(
        '<button type="button" class="mo-cal' + (m === month ? ' on' : '') +
          (sum ? '' : ' quiet') + '" data-m="' + m + '">' +
          '<span class="mo-calm">' + esc(MONTH_NAMES[Number(m.slice(5, 7)) - 1].slice(0, 3)) +
            ' <i>' + m.slice(2, 4) + '</i></span>' +
          '<span class="mo-calv">' + (sum ? rupees(sum) : '—') + '</span>' +
          '<span class="mo-caln">' + (rows.length
            ? rows.length + (rows.length === 1 ? ' due' : ' due') +
              (unpaid && i === 0 ? ' · ' + unpaid + ' unpaid' : '')
            : 'nothing') + '</span>' +
        '</button>');
    }
    return '<div class="mo-calwrap">' +
      '<p class="mo-calhead"><b>' + rupees(grand) + '</b> falls due over the next twelve months — ' +
        'repeating bills and loan instalments only, not day-to-day spending. Tap a month to open it.</p>' +
      '<div class="mo-calgrid">' + cells.join('') + '</div></div>';
  }

  // ---- notifications --------------------------------------------------------
  //
  // A button rather than a tick-box, because turning this on is a decision with
  // a permission prompt attached, not a preference you flip in passing.
  //
  // Four states, and each one says something different, because "off" covers
  // three of them and helps with none: not supported by the browser at all,
  // never asked, refused (which JavaScript cannot undo — only the reader can,
  // in the site settings), and on.
  function notifyState() {
    if (typeof Notification === 'undefined') return 'unsupported';
    if (Notification.permission === 'denied') return 'blocked';
    if (Notification.permission !== 'granted') return 'ask';
    return settings.notify ? 'on' : 'off';
  }

  function renderNotify() {
    var st = notifyState();
    var soon = ready ? dueSoon(D, settings.remindDays) : [];
    var late = soon.filter(function (x) { return x.late; }).length;

    var button, note;
    if (st === 'unsupported') {
      button = '<button type="button" class="mo-btn mo-quiet" disabled>Not available here</button>';
      note = 'This browser cannot show notifications.';
    } else if (st === 'blocked') {
      button = '<button type="button" class="mo-btn mo-quiet" disabled>Blocked by the browser</button>';
      // Being specific matters: a page cannot re-ask once refused, and saying
      // "turn it on" without saying where is the same as saying nothing.
      note = 'Notifications were refused for this site. Only you can undo that — ' +
             'open the padlock beside the web address, find Notifications, and set it to Allow.';
    } else if (st === 'on') {
      button = '<button type="button" class="mo-btn" id="moNotifyOff">Notifications are on</button>' +
               '<button type="button" class="mo-x" id="moNotifyTest">Send a test</button>';
      note = 'You will get one alert a visit if something is due within ' +
             settings.remindDays + ' days.';
    } else {
      button = '<button type="button" class="mo-btn" id="moNotifyOn">Turn on notifications</button>';
      note = st === 'ask'
        ? 'The browser will ask your permission first.'
        : 'Off. Nothing will pop up.';
    }

    return '<div class="mo-notify' + (st === 'on' ? ' on' : '') + '">' +
      '<div class="mo-nleft">' +
        '<b>' + (st === 'on' ? 'Payment alerts are on' : 'Payment alerts') + '</b>' +
        '<span class="mo-sub">' + esc(note) + '</span>' +
        (ready && late
          ? '<span class="mo-sub mo-hol">' + late +
            (late === 1 ? ' payment is overdue right now' : ' payments are overdue right now') + '</span>'
          : (ready && soon.length
              ? '<span class="mo-sub">' + soon.length +
                (soon.length === 1 ? ' payment is' : ' payments are') + ' coming up</span>'
              : '')) +
      '</div>' +
      '<div class="mo-nright">' + button + '</div>' +
      '<p class="mo-remnote">A browser alert only appears while this page is open on this device. ' +
        'It cannot reach you by email, SMS, or on your phone when the page is closed.</p>' +
    '</div>';
  }

  function bindNotify(host) {
    if (!host) return;
    var on = host.querySelector('#moNotifyOn');
    if (on) on.onclick = function () {
      if (typeof Notification === 'undefined') return;
      var btn = this;
      btn.disabled = true;
      btn.textContent = 'Asking…';
      Promise.resolve(Notification.requestPermission()).then(function (p) {
        if (p === 'granted') {
          settings.notify = true;
          notified = false;
          saveSettings();
          redrawNotify();
          maybeNotify();
        } else {
          settings.notify = false;
          saveSettings();
          redrawNotify();
        }
      }).catch(function () { redrawNotify(); });
    };

    var off = host.querySelector('#moNotifyOff');
    if (off) off.onclick = function () {
      settings.notify = false;
      saveSettings();
      redrawNotify();
    };

    // Proving it works matters more than promising it does. If the alert never
    // appears, better to find that out here than to miss an EMI trusting it.
    var test = host.querySelector('#moNotifyTest');
    if (test) test.onclick = function () {
      try {
        new Notification('Kerala Marine Supply', {
          body: 'This is a test. Payment alerts are working on this device.',
          tag: 'kms-money-test',
        });
        setStatus('Test alert sent. If nothing appeared, check this device’s ' +
                  'notification settings — the browser may be silenced.');
      } catch (e) {
        setStatus('The test alert could not be shown: ' + e.message, true);
      }
    };
  }

  // Both places that carry the control get redrawn together, so the two can
  // never show different answers.
  function redrawNotify() {
    ['moNotifyBar', 'moNotifyPanel'].forEach(function (id) {
      var host = el(id);
      if (!host) return;
      host.innerHTML = renderNotify();
      bindNotify(host);
    });
  }

  // What is about to be due, and what is already late.
  function renderRemind() {
    var soon = dueSoon(D, settings.remindDays);
    var late = soon.filter(function (x) { return x.late; });
    var opts = [0, 3, 5, 10, 15].map(function (n) {
      return '<option value="' + n + '"' + (n === settings.remindDays ? ' selected' : '') + '>' +
        (n === 0 ? 'On the day' : n + ' days before') + '</option>';
    }).join('');

    return '<div class="mo-remind' + (late.length ? ' bad' : (soon.length ? ' warn' : '')) + '">' +
      '<div class="mo-remhead">' +
        '<b>' + (late.length
          ? late.length + (late.length === 1 ? ' payment is overdue' : ' payments are overdue')
          : (soon.length ? soon.length + (soon.length === 1 ? ' payment is coming up' : ' payments are coming up')
                         : 'Nothing due in the next ' + settings.remindDays + ' days')) + '</b>' +
        '<span class="mo-remset">Remind me <select id="moRemDays">' + opts + '</select></span>' +
      '</div>' +
      '<div id="moNotifyPanel"></div>' +
      (soon.length
        ? '<ul class="mo-remlist">' + soon.map(function (x) {
            return '<li' + (x.late ? ' class="late"' : '') + '>' +
              '<span>' + esc(x.item.name) + '<span class="mo-sub">' + esc(x.item.what) + '</span></span>' +
              '<span>' + rupees(x.item.amount) + '</span>' +
              '<span>' + esc(prettyDate(x.item.when)) + ' · <b>' + esc(inDays(x.days)) + '</b></span>' +
            '</li>';
          }).join('') + '</ul>'
        : '') +
    '</div>';
  }

  function renderEntryList() {
    var rows = D.entries.filter(function (e) { return e.date.slice(0, 7) === month; });
    if (!rows.length && !(edit && edit.kind === 'entry')) {
      return emptyNote('No expenses recorded in this month yet.');
    }
    return '<ul class="mo-list">' + rows.map(function (e) {
      if (edit && edit.kind === 'entry' && edit.id === e.id) return entryForm(edit.draft, edit.isNew);
      return '<li class="mo-li" data-id="' + esc(e.id) + '">' +
        '<span class="mo-when">' + esc(prettyDate(e.date)) + '</span>' +
        '<span class="mo-what"><b>' + esc(e.category || 'Uncategorised') + '</b>' +
          (e.home ? '<span class="mo-tag">home</span>' : '') +
          (e.note ? '<span class="mo-sub">' + esc(e.note) + '</span>' : '') + '</span>' +
        '<span class="mo-for">' + esc(e.home ? 'House' : (ventureName(e.venture) || '—')) + '</span>' +
        '<span class="mo-amt">' + rupees(e.amount) + '</span>' +
        '<span class="mo-acts">' +
          '<button type="button" class="mo-x f-edit">Edit</button>' +
          '<button type="button" class="mo-x f-del">Delete</button>' +
        '</span>' +
      '</li>';
    }).join('') + '</ul>';
  }

  function entryForm(e, isNew) {
    return '<li class="mo-li mo-open" data-id="' + esc(e.id) + '">' +
      '<div class="mo-grid">' +
        '<label>Date<input type="date" class="f-date" value="' + esc(e.date) + '"></label>' +
        '<label>Amount<input type="text" inputmode="decimal" class="f-amt" value="' + (e.amount || '') + '" placeholder="0"></label>' +
        '<label>Category<input type="text" list="moCats" class="f-cat" value="' + esc(e.category) + '" placeholder="Fuel"></label>' +
        '<label>Venture' + ventureSelect(e.venture, 'f-ven') + '</label>' +
        '<label>Whose<select class="f-home">' +
          '<option value=""' + (e.home ? '' : ' selected') + '>Business</option>' +
          '<option value="1"' + (e.home ? ' selected' : '') + '>Home</option>' +
        '</select></label>' +
        '<label class="wide">What was it for<input type="text" class="f-note" value="' + esc(e.note) + '" placeholder="optional"></label>' +
      '</div>' +
      saveRow(isNew ? 'Save this expense' : 'Save changes') +
    '</li>';
  }

  // The bills and EMIs that fall in this month. Ticking one paid is the only
  // change available here — the amount belongs to the rule, not to the month,
  // so editing it here would change every month at once without saying so.
  function renderDueList(m) {
    var rows = dueItems(D, m);
    if (!rows.length) return emptyNote('No repeating bills or instalments fall in this month.');
    var now = today();
    return '<ul class="mo-list">' + rows.map(function (r) {
      var late = !r.paid && !r.skipped && r.when < now;
      return '<li class="mo-li' + (r.skipped ? ' mo-skipped' : '') +
             '" data-kind="' + r.kind + '" data-id="' + esc(r.id) + '">' +
        '<span class="mo-when">' + esc(prettyDate(r.when)) +
          (late ? '<span class="mo-late">overdue</span>' : '') + '</span>' +
        '<span class="mo-what"><b>' + esc(r.name) + '</b>' +
          (r.home ? '<span class="mo-tag">home</span>' : '') +
          '<span class="mo-sub">' + esc(r.what) + '</span></span>' +
        '<span class="mo-for">' + esc(r.home ? 'House' : (ventureName(r.venture) || '—')) + '</span>' +
        '<span class="mo-amt">' + rupees(r.amount) + '</span>' +
        '<span class="mo-acts">' +
          '<label class="mo-tick"><input type="checkbox" class="f-paid"' +
            (r.paid ? ' checked' : '') + (r.skipped ? ' disabled' : '') + '> paid</label>' +
          (r.kind === 'bill'
            ? '<label class="mo-tick"><input type="checkbox" class="f-skip"' +
              (r.skipped ? ' checked' : '') + '> not this month</label>'
            : '') +
        '</span>' +
      '</li>';
    }).join('') + '</ul>';
  }

  function bindMonth() {
    var host = el('moMonth');

    function goTo(m) {
      if (!leaveEdit()) return;
      month = m;
      var y = yearOf(m);
      if (y !== D.year) {
        years[D.year] = D.entries;   // keep the year being left
        load(y, function () { renderMonth(); paintTiles(); });
      } else {
        renderMonth(); paintTiles();
      }
    }

    el('moPrev').onclick = function () { goTo(shiftMonth(month, -1)); };
    el('moNext').onclick = function () { goTo(shiftMonth(month, 1)); };
    el('moNow').onclick = function () { goTo(thisMonth()); };
    el('moPick').onchange = function () {
      if (/^\d{4}-\d{2}$/.test(this.value)) goTo(this.value);
    };
    el('moCal').onclick = function () { showCal = !showCal; renderMonth(); };
    host.querySelectorAll('.mo-cal').forEach(function (b) {
      b.onclick = function () { goTo(b.getAttribute('data-m')); };
    });

    // ---- the reminder setting ----
    var days = el('moRemDays');
    if (days) days.onchange = function () {
      settings.remindDays = Math.max(0, Math.min(60, Number(this.value) || 0));
      saveSettings();
      notified = false;   // a wider window may bring something new into view
      renderMonth();
    };
    redrawNotify();

    el('moAddEntry').onclick = function () {
      if (!leaveEdit()) return;
      var d = (thisMonth() === month) ? today() : dueDate(month, 1);
      var e = { id: uid('e'), date: d, amount: 0, category: '', venture: '', home: false, note: '' };
      D.entries.unshift(e);
      years[D.year] = D.entries;
      edit = { kind: 'entry', id: e.id, draft: copy(e), isNew: true };
      renderMonth();
      var f = host.querySelector('.mo-open .f-amt');
      if (f) f.focus();
    };

    // Rows being read.
    host.querySelectorAll('.mo-li[data-id]:not(.mo-open)').forEach(function (li) {
      var id = li.getAttribute('data-id');
      var kind = li.getAttribute('data-kind');

      if (!kind) {
        var e = D.entries.filter(function (x) { return x.id === id; })[0];
        if (!e) return;
        li.querySelector('.f-edit').onclick = function () {
          if (!leaveEdit()) return;
          edit = { kind: 'entry', id: id, draft: copy(e), isNew: false };
          renderMonth();
        };
        li.querySelector('.f-del').onclick = function () {
          if (!leaveEdit()) return;
          if (!confirm('Delete this ' + rupees(e.amount) + ' expense? This cannot be undone.')) return;
          D.entries = D.entries.filter(function (x) { return x.id !== id; });
          years[D.year] = D.entries;
          commit('entries').catch(function () {});
          renderMonth(); paintTiles();
        };
        return;
      }

      // A bill, an instalment, or moratorium interest: the ticks only, and they
      // save at once.
      var list = kind === 'bill' ? D.bills : D.loans;
      var it = list.filter(function (x) { return x.id === id; })[0];
      if (!it) return;
      var paid = li.querySelector('.f-paid');
      if (paid) paid.onchange = function () {
        // Interest keeps its own list. Ticking it against `paid` would make
        // the first instalment look settled because the interest before it was.
        if (kind === 'interest') {
          if (!Array.isArray(it.intPaid)) it.intPaid = [];
          toggle(it.intPaid, month, this.checked);
        } else {
          toggle(it.paid, month, this.checked);
        }
        commit(kind === 'bill' ? 'bills' : 'loans')
          .then(function () { renderMonth(); paintTiles(); }, function () {});
      };
      var skip = li.querySelector('.f-skip');
      if (skip) skip.onchange = function () {
        toggle(it.skip, month, this.checked);
        if (this.checked) toggle(it.paid, month, false);
        commit('bills').then(function () { renderMonth(); paintTiles(); }, function () {});
      };
    });

    // The one row open as a form.
    var open = host.querySelector('.mo-open');
    if (open) bindEntryForm(open);
  }

  function bindEntryForm(box) {
    var d = edit.draft;
    function read() {
      d.date = box.querySelector('.f-date').value;
      d.amount = num(box.querySelector('.f-amt').value);
      d.category = box.querySelector('.f-cat').value.trim();
      d.venture = box.querySelector('.f-ven').value;
      d.home = !!box.querySelector('.f-home').value;
      d.note = box.querySelector('.f-note').value.trim();
    }
    box.querySelector('.f-save').onclick = function () {
      read();
      if (!d.date) { setStatus('Give the expense a date.', true); box.querySelector('.f-date').focus(); return; }
      if (!d.amount) { setStatus('Give the expense an amount.', true); box.querySelector('.f-amt').focus(); return; }
      if (yearOf(d.date.slice(0, 7)) !== D.year) {
        setStatus('That date is in ' + d.date.slice(0, 4) + ', and this book is ' + D.year +
                  '. Switch year first, then add it there.', true);
        return;
      }
      // Write the draft over the real record only now.
      var i = D.entries.findIndex(function (x) { return x.id === d.id; });
      if (i >= 0) D.entries[i] = copy(d);
      D.entries.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
      years[D.year] = D.entries;
      var wasNew = edit.isNew;
      edit = null;
      // Follow the expense to the month it was dated in, so a saved entry is
      // never invisible the moment it is saved.
      if (d.date.slice(0, 7) !== month) month = d.date.slice(0, 7);
      commit('entries').then(function () {
        if (wasNew) setStatus('Added ' + rupees(d.amount) + ' on ' + prettyDate(d.date) + '.');
      }, function () {});
      renderMonth(); paintTiles();
    };
    box.querySelector('.f-cancel').onclick = function () {
      if (edit.isNew) removeNew(edit);
      edit = null;
      setStatus('');
      renderMonth();
    };
  }

  // ---- page: loans ---------------------------------------------------------

  function renderLoans() {
    var host = el('moLoans');
    if (!host) return;
    if (!ready) { host.innerHTML = statusBar(); setStatus('Loading…'); return; }

    var now = thisMonth();
    var dueNow = 0, owed = 0, sanctioned = 0, got = 0, onHoliday = 0;
    D.loans.forEach(function (l) {
      if (loanInstalment(l, now) >= 0) dueNow += l.emi;
      owed += left(l);
      sanctioned += l.principal;
      got += released(l);
      if (inMoratorium(l, now)) onHoliday++;
    });

    host.innerHTML =
      '<div class="mo-cards">' +
        '<div class="mo-card mo-big"><span class="k">EMI due in ' + esc(monthName(now)) + '</span>' +
          '<strong>' + rupees(dueNow) + '</strong><span class="c">' + D.loans.length +
          (D.loans.length === 1 ? ' loan' : ' loans') + '</span></div>' +
        '<div class="mo-card"><span class="k">Still to repay</span><strong>' + rupees(owed) + '</strong>' +
          '<span class="c">instalments left × EMI, interest included</span></div>' +
        '<div class="mo-card"><span class="k">Released</span><strong>' + rupees(got) + '</strong>' +
          '<span class="c">' + (sanctioned
            ? 'of ' + rupees(sanctioned) + ' sanctioned' +
              (sanctioned - got > 0.005 ? ' · ' + rupees(sanctioned - got) + ' to come' : '')
            : 'no sanction amount entered') + '</span></div>' +
        (onHoliday ? '<div class="mo-card"><span class="k">In moratorium</span><strong>' + onHoliday +
          '</strong><span class="c">' + (onHoliday === 1 ? 'loan is' : 'loans are') +
          ' not paying an EMI yet</span></div>' : '') +
      '</div>' +
      '<p class="mo-caveat">These are the figures you enter. Nothing here is taken from a bank — ' +
        'check a statement before relying on it for a payment.' +
        (D.loans.some(function (l) { return l.repay === 'interest-only'; })
          ? ' <b>*</b> On an interest-only loan, “left to pay” includes the principal ' +
            'returned at the end, not just the interest payments.'
          : '') + '</p>' +
      '<div class="mo-head"><h3 class="mo-h">Loans</h3>' +
        '<button type="button" class="mo-btn" id="moAddLoan">Add a loan</button></div>' +
      statusBar() +
      (D.loans.length
        ? '<ul class="mo-list">' + D.loans.map(function (l) {
            return (edit && edit.kind === 'loan' && edit.id === l.id)
              ? loanForm(edit.draft, edit.isNew) : loanRow(l);
          }).join('') + '</ul>'
        : emptyNote('No loans added yet.'));

    bindLoans();
  }

  function loanRow(l) {
    var n = nextDue(l);
    var done = l.months ? Math.min(100, Math.round(l.paid.length / l.months * 100)) : 0;
    var late = n && n < today();
    var got = released(l);
    var now = thisMonth();
    var holiday = inMoratorium(l, now);
    var end = moratoriumEnds(l);

    // How much of the sanction has actually arrived. Shown whenever a sanction
    // has been entered, including when nothing has been released yet — "₹0 of
    // ₹40,00,000 released" is a fact worth seeing, and hiding it would read as
    // if the money were in hand.
    var releaseLine = l.principal
      ? '<span class="mo-sub"><b>' + rupees(got) + '</b> released of ' + rupees(l.principal) +
        (got > l.principal
          ? ' <span class="mo-late">over sanction</span>'
          : (l.principal - got > 0.005
              ? ' · ' + rupees(l.principal - got) + ' still to come' : ' · fully released')) +
        '</span>'
      : (got ? '<span class="mo-sub"><b>' + rupees(got) + '</b> released</span>' : '');

    return '<li class="mo-li mo-tall" data-id="' + esc(l.id) + '">' +
      '<span class="mo-what"><b>' + esc(l.lender || 'Untitled loan') + '</b>' +
        '<span class="mo-tag mo-kind">' + esc(l.kind || 'Term loan') + '</span>' +
        '<span class="mo-sub">' + esc(l.purpose || 'no purpose set') +
        (ventureName(l.venture) ? ' · ' + esc(ventureName(l.venture)) : '') +
        (l.months ? ' · ' + esc(termYears(l)) + ' (' + l.months + ' × ' + esc(cadence(l)) + ')' : '') + '</span>' +
        (l.repay === 'interest-only'
          ? '<span class="mo-sub mo-hol">Interest only — ' + rupees(l.principal) +
            ' principal still due at the end</span>' : '') +
        releaseLine +
        (holiday
          ? '<span class="mo-sub mo-hol">In moratorium until ' + esc(monthName(end)) +
            ' · no EMI yet, but interest is payable every month</span>'
          : (end ? '<span class="mo-sub">Moratorium ended ' + esc(monthName(end)) + '</span>' : '')) +
        (end && moratoriumTotal(l)
          ? '<span class="mo-sub">Moratorium interest <b>' + rupees(moratoriumTotal(l)) + '</b> in all · ' +
            (function () {
              var sch = moratoriumSchedule(l);
              var owed = sch.filter(function (r) { return !r.paid; })
                            .reduce(function (a, r) { return a + r.interest; }, 0);
              return owed > 0.005
                ? '<span class="mo-hol">' + rupees(owed) + ' of it still to pay</span>'
                : 'all paid';
            })() + '</span>'
          : '') +
        '<span class="mo-meter"><i style="width:' + done + '%"></i></span>' +
        '<span class="mo-sub"><b>' + l.paid.length + '</b> of ' + (l.months || '—') + ' paid · ' +
          'next ' + (n ? esc(prettyDate(n)) : 'nothing outstanding') +
          (late ? ' <span class="mo-late">overdue</span>' : '') + '</span>' +
      '</span>' +
      '<span class="mo-amt"><b>' + rupees(l.emi) + '</b>' +
        '<span class="mo-sub">' + esc(cadence(l)) + '</span>' +
        '<span class="mo-sub">' + rupees(left(l)) + ' left' +
          (l.repay === 'interest-only' ? ' *' : '') + '</span>' +
        (holiday
          ? '<span class="mo-sub">' + rupees(monthInterest(l, thisMonth())) + ' interest this month</span>' : '') +
      '</span>' +
      '<span class="mo-acts">' +
        '<button type="button" class="mo-x f-pay">Mark next EMI paid</button>' +
        '<button type="button" class="mo-x f-edit">Edit</button>' +
        '<button type="button" class="mo-x f-del">Delete</button>' +
      '</span>' +
    '</li>';
  }

  function loanForm(l, isNew) {
    var got = released(l);
    return '<li class="mo-li mo-open" data-id="' + esc(l.id) + '">' +
      '<div class="mo-grid">' +
        '<label>Lender<input type="text" class="f-lender" value="' + esc(l.lender) + '" placeholder="Kerala Financial Corporation"></label>' +
        '<label>Kind<select class="f-kind">' + kindOptions(l.kind) + '</select></label>' +
        '<label>What for<input type="text" class="f-purpose" value="' + esc(l.purpose) + '" placeholder="Boat yard"></label>' +
        '<label>Venture' + ventureSelect(l.venture, 'f-ven') + '</label>' +
        '<label>Amount sanctioned<input type="text" inputmode="decimal" class="f-principal" value="' + (l.principal || '') + '" placeholder="0"></label>' +
        '<label>Interest %, a year<input type="text" inputmode="decimal" class="f-rate" value="' + (l.rate || '') + '" placeholder="0"></label>' +
      '</div>' +

      // ---- the term ----
      '<h4 class="mo-sech">Term, moratorium and how it repays</h4>' +
      '<div class="mo-grid">' +
        '<label>Repayment<select class="f-repay">' +
          '<option value="emi"' + (l.repay === 'interest-only' ? '' : ' selected') + '>EMI — pays the balance down</option>' +
          '<option value="interest-only"' + (l.repay === 'interest-only' ? ' selected' : '') + '>Interest only — principal at the end</option>' +
        '</select></label>' +
        '<label>Instalment falls<select class="f-every">' + everyOptions(every(l)) + '</select></label>' +
        '<label>Loan starts<input type="month" class="f-start" value="' + esc(l.start || '') + '"></label>' +
        '<label>Moratorium, months<input type="number" min="0" max="120" class="f-mor" value="' + (l.moratorium || '') + '" placeholder="0"></label>' +
        '<label>Term, years<input type="number" min="0" max="50" step="0.5" class="f-years" value="" placeholder="e.g. 7"></label>' +
        '<label>Or number of instalments<input type="number" min="0" max="600" class="f-months" value="' + (l.months || '') + '" placeholder="e.g. 84"></label>' +
        '<label>Due on day<input type="number" min="1" max="31" class="f-day" value="' + l.dueDay + '"></label>' +
        '<label class="' + (l.start ? 'mo-derived' : '') + '">First instalment month' +
          '<input type="month" class="f-from" value="' + esc(l.from) + '"' + (l.start ? ' readonly' : '') + '></label>' +
      '</div>' +

      // ---- the payment ----
      '<h4 class="mo-sech">The instalment</h4>' +
      '<div class="mo-grid">' +
        '<label>Amount each time<input type="text" inputmode="decimal" class="f-emi" value="' + (l.emi || '') + '" placeholder="0"></label>' +
      '</div>' +
      '<div class="mo-row"><button type="button" class="mo-x" id="moCalcEmi">Work it out for me</button>' +
        '<label class="mo-tick"><input type="radio" name="mo-on-' + esc(l.id) + '" value="sanction" checked> ' +
          'on the sanction</label>' +
        '<label class="mo-tick"><input type="radio" name="mo-on-' + esc(l.id) + '" value="released"> ' +
          'on what has been released</label></div>' +
      '<p class="mo-facts"><span id="moCalcHint"></span></p>' +
      '<p class="mo-facts" id="moTermSum"></p>' +

      // ---- what has actually arrived ----
      '<h4 class="mo-sech">Amount released</h4>' +
      '<p class="mo-facts"><span>A sanction is a promise. Enter each release as it reaches ' +
        'the account — the loan then shows what has actually arrived against what was agreed.</span></p>' +
      '<div class="mo-rel" id="moRel">' +
        (l.releases && l.releases.length
          ? l.releases.map(releaseRow).join('')
          : '<p class="mo-empty mo-tight">Nothing released yet.</p>') +
      '</div>' +
      '<div class="mo-row"><button type="button" class="mo-x" id="moAddRel">Add a release</button>' +
        '<span class="mo-facts"><span id="moRelSum">' +
          (l.principal ? rupees(got) + ' of ' + rupees(l.principal) : rupees(got)) +
        '</span></span></div>' +

      '<div id="moIntSched">' + interestSchedule(l) + '</div>' +
      (l.paid.length ? '<p class="mo-facts"><span><b>' + l.paid.length + '</b> instalments are ticked paid on this loan</span></p>' : '') +
      saveRow(isNew ? 'Save this loan' : 'Save changes') +
    '</li>';
  }

  // Month by month through the moratorium: what had been released by then and
  // what the interest on it came to. This is the running answer to "how is it
  // going now" — and it is where the arithmetic can be checked rather than
  // taken on trust.
  function interestSchedule(l) {
    var sch = moratoriumSchedule(l);
    if (!sch.length) return '';
    if (!l.rate) {
      return '<h4 class="mo-sech">Interest through the moratorium</h4>' +
        '<p class="mo-facts"><span>Enter the interest rate to see it.</span></p>';
    }
    var now = thisMonth();
    var total = moratoriumTotal(l);
    return '<h4 class="mo-sech">Interest through the moratorium</h4>' +
      '<p class="mo-facts"><span>Charged on each release from the day it arrived, ' +
        'at ' + esc(String(l.rate)) + '% a year over 365 days — the way the bank works it out. ' +
        'Money not yet released costs nothing.</span></p>' +
      '<div class="scroll"><table class="mo-tbl mo-sched"><thead><tr>' +
        '<th>Month</th><th>Released by then</th><th>Interest</th><th>Due</th><th></th>' +
      '</tr></thead><tbody>' +
      sch.map(function (r) {
        return '<tr' + (r.month === now ? ' class="on"' : '') + '>' +
          '<td>' + esc(monthName(r.month)) + (r.month === now ? ' <b>· now</b>' : '') + '</td>' +
          '<td>' + rupees(r.released) + '</td>' +
          '<td><b>' + rupees(r.interest) + '</b></td>' +
          '<td>' + esc(prettyDate(r.due)) + '</td>' +
          '<td>' + (r.paid ? '<span class="mo-tag">paid</span>'
                           : (r.interest ? '<span class="mo-sub">not yet</span>' : '')) + '</td>' +
        '</tr>';
      }).join('') +
      '<tr class="tot"><td><b>Over the whole moratorium</b></td><td></td>' +
        '<td><b>' + rupees(total) + '</b></td><td colspan="2"></td></tr>' +
      '</tbody></table></div>' +
      '<p class="mo-facts"><span>Tick these off month by month in <b>The month</b>, ' +
        'where they appear beside the bills.</span></p>';
  }

  function releaseRow(r) {
    return '<div class="mo-relrow" data-rid="' + esc(r.id) + '">' +
      '<input type="date" class="r-date" value="' + esc(r.date) + '">' +
      '<input type="text" inputmode="decimal" class="r-amt" value="' + (r.amount || '') + '" placeholder="Amount">' +
      '<input type="text" class="r-note" value="' + esc(r.note || '') + '" placeholder="Stage 1, machinery… (optional)">' +
      '<button type="button" class="mo-x r-del" title="Remove this release">&times;</button>' +
    '</div>';
  }

  function bindLoans() {
    var host = el('moLoans');

    el('moAddLoan').onclick = function () {
      if (!leaveEdit()) return;
      var l = {
        id: uid('l'), lender: '', purpose: '', principal: 0, emi: 0, rate: 0,
        dueDay: 5, kind: 'Term loan', repay: 'emi', every: 1,
        start: '', moratorium: 0, from: thisMonth(), months: 0,
        releases: [], venture: '', paid: [], intPaid: [], note: '',
      };
      D.loans.unshift(l);
      edit = { kind: 'loan', id: l.id, draft: copy(l), isNew: true };
      renderLoans();
      var f = host.querySelector('.mo-open .f-lender');
      if (f) f.focus();
    };

    host.querySelectorAll('.mo-li[data-id]:not(.mo-open)').forEach(function (li) {
      var id = li.getAttribute('data-id');
      var l = D.loans.filter(function (x) { return x.id === id; })[0];
      if (!l) return;

      li.querySelector('.f-edit').onclick = function () {
        if (!leaveEdit()) return;
        edit = { kind: 'loan', id: id, draft: copy(l), isNew: false };
        renderLoans();
      };
      li.querySelector('.f-del').onclick = function () {
        if (!leaveEdit()) return;
        if (!confirm('Delete the ' + (l.lender || 'untitled') + ' loan and everything ticked paid on it?')) return;
        D.loans = D.loans.filter(function (x) { return x.id !== id; });
        commit('loans').catch(function () {});
        renderLoans(); paintTiles();
      };
      li.querySelector('.f-pay').onclick = function () {
        if (!l.from) { setStatus('Set the first EMI month on this loan before marking one paid.', true); return; }
        if (l.months && l.paid.length >= l.months) { setStatus('Every EMI on this loan is already paid.', true); return; }
        var m = shiftMonth(l.from, l.paid.length);
        toggle(l.paid, m, true);
        commit('loans').then(function () {
          setStatus('Marked ' + monthName(m) + ' paid on ' + (l.lender || 'that loan') + '.');
        }, function () {});
        renderLoans(); paintTiles();
      };
    });

    var open = host.querySelector('.mo-open');
    if (open) bindLoanForm(open);
  }

  function bindLoanForm(box) {
    var d = edit.draft;
    if (!Array.isArray(d.releases)) d.releases = [];

    function readReleases() {
      d.releases = [];
      box.querySelectorAll('.mo-relrow').forEach(function (row) {
        d.releases.push({
          id: row.getAttribute('data-rid'),
          date: row.querySelector('.r-date').value,
          amount: num(row.querySelector('.r-amt').value),
          note: row.querySelector('.r-note').value.trim(),
        });
      });
    }

    function read() {
      d.lender = box.querySelector('.f-lender').value.trim();
      d.kind = box.querySelector('.f-kind').value;
      d.repay = box.querySelector('.f-repay').value === 'interest-only' ? 'interest-only' : 'emi';
      d.every = Math.max(1, Math.min(12, Number(box.querySelector('.f-every').value) || 1));
      d.purpose = box.querySelector('.f-purpose').value.trim();
      d.venture = box.querySelector('.f-ven').value;
      d.principal = num(box.querySelector('.f-principal').value);
      d.emi = num(box.querySelector('.f-emi').value);
      var r = Number(box.querySelector('.f-rate').value);
      d.rate = isFinite(r) && r >= 0 && r <= 100 ? Math.round(r * 100) / 100 : 0;
      var st = box.querySelector('.f-start').value;
      d.start = /^\d{4}-\d{2}$/.test(st) ? st : '';
      d.moratorium = Math.max(0, Math.min(120, Math.round(Number(box.querySelector('.f-mor').value) || 0)));
      d.months = Math.max(0, Math.min(600, Math.round(Number(box.querySelector('.f-months').value) || 0)));
      d.dueDay = Math.min(31, Math.max(1, Number(box.querySelector('.f-day').value) || 1));
      // With a start month and a moratorium, the first EMI is worked out — one
      // field decides the schedule, so there is no way for the two to disagree.
      var f = box.querySelector('.f-from').value;
      d.from = d.start ? firstEmi(d) : (/^\d{4}-\d{2}$/.test(f) ? f : '');
      readReleases();
    }

    // A running sentence under the term fields, so the moratorium is something
    // you can see the effect of rather than work out.
    function summarise() {
      read();
      var sum = box.querySelector('#moTermSum');
      if (sum) {
        var bits = [];
        var word = d.repay === 'interest-only' ? 'interest payments' : 'instalments';
        if (d.months) {
          bits.push('<span><b>' + esc(termYears(d)) + '</b> · ' + d.months + ' ' + word +
                    ' of ' + rupees(d.emi) + ', ' + esc(cadence(d)) + '</span>');
        }
        if (d.start && d.moratorium) {
          bits.push('<span>Moratorium ' + esc(monthName(d.start)) + ' to ' +
                    esc(monthName(moratoriumEnds(d))) + ' — <b>' + d.moratorium +
                    ' months</b> with nothing to pay</span>');
        }
        if (d.from) {
          var last = d.months ? shiftMonth(d.from, (d.months - 1) * every(d)) : '';
          bits.push('<span>First <b>' + esc(monthName(d.from)) + '</b>' +
                    (last ? ', last <b>' + esc(monthName(last)) + '</b>' : '') + '</span>');
        }
        if (d.repay === 'interest-only' && d.principal) {
          bits.push('<span class="mo-hol">The principal, <b>' + rupees(d.principal) +
                    '</b>, is still due at the end — it is counted in "left to pay"</span>');
        }
        if (d.months && d.emi && d.repay !== 'interest-only' && d.principal) {
          var paidOut = d.months * d.emi;
          bits.push('<span>Repaid in all <b>' + rupees(paidOut) + '</b> — ' +
                    rupees(Math.max(0, paidOut - d.principal)) + ' of it interest</span>');
        }
        if (d.start && d.moratorium && d.rate) {
          var tot = moratoriumTotal(d);
          bits.push(tot
            ? '<span class="mo-hol">Interest is still payable through the moratorium — <b>' +
              rupees(tot) + '</b> over the ' + d.moratorium + ' months, on what has been released</span>'
            : '<span>Interest through the moratorium will show here once a release is entered — ' +
              'it is charged on money that has actually arrived, not on the sanction</span>');
        }
        sum.innerHTML = bits.join('');
      }
      // What the calculator would say, offered but never applied on its own.
      var hint = box.querySelector('#moCalcHint');
      if (hint) {
        var basis = calcBasis();
        var on = basis === 'released' ? released(d) : d.principal;
        var want = calcPayment(Object.assign({}, d, { principal: on }));
        hint.innerHTML = !want
          ? esc(d.repay === 'interest-only'
              ? 'Needs an amount and the rate.'
              : 'Needs an amount, the rate and the number of instalments.') +
            (basis === 'released' && !on ? ' Nothing has been released yet.' : '')
          : ('On ' + rupees(on) + (basis === 'released' ? ' released' : ' sanctioned') +
             ', works out at <b>' + rupees(want) + '</b> ' + esc(cadence(d)) +
             (d.emi && Math.abs(d.emi - want) > 1
               ? ' — you have ' + rupees(d.emi) + '. Keep yours if that is what the bank says.'
               : ''));
      }
      var sched = box.querySelector('#moIntSched');
      if (sched) sched.innerHTML = interestSchedule(d);
      var rs = box.querySelector('#moRelSum');
      if (rs) {
        var got = released(d);
        rs.innerHTML = d.principal
          ? esc(rupees(got) + ' of ' + rupees(d.principal)) +
            (got > d.principal ? ' <span class="mo-late">over sanction</span>'
              : (d.principal - got > 0.005 ? esc(' · ' + rupees(d.principal - got) + ' still to come') : ' · fully released'))
          : esc(rupees(got) + ' released');
      }
      var fromField = box.querySelector('.f-from');
      if (fromField) {
        if (d.start) { fromField.value = d.from; fromField.readOnly = true; fromField.parentNode.classList.add('mo-derived'); }
        else { fromField.readOnly = false; fromField.parentNode.classList.remove('mo-derived'); }
      }
    }

    // Years and EMIs are two ways of saying the same thing, so each writes the
    // other. Typing 7 in one shows 84 in the other, and nobody has to multiply.
    var yearsField = box.querySelector('.f-years');
    var monthsField = box.querySelector('.f-months');
    // Years and instalments say the same thing, but only once you know how far
    // apart the instalments are: 7 years quarterly is 28 payments, not 84.
    function syncFromYears() {
      var y = Number(yearsField.value);
      var n = every(readEvery());
      if (isFinite(y) && y > 0) monthsField.value = Math.round(y * 12 / n);
      summarise();
    }
    function syncFromMonths() {
      var m = Math.round(Number(monthsField.value) || 0);
      var n = every(readEvery());
      var yrs = m * n / 12;
      yearsField.value = m && (m * n) % 6 === 0 ? yrs : '';
      summarise();
    }
    function readEvery() {
      return { every: Number(box.querySelector('.f-every').value) || 1 };
    }
    yearsField.oninput = syncFromYears;
    monthsField.oninput = syncFromMonths;
    syncFromMonths();   // fill the years box from whatever was stored

    ['.f-start', '.f-mor', '.f-emi', '.f-rate', '.f-principal', '.f-from', '.f-day',
     '.f-kind', '.f-repay'].forEach(function (sel) {
      var n = box.querySelector(sel);
      if (n) { n.oninput = summarise; n.onchange = summarise; }
    });
    // Changing the interval changes what the term means, so the years box has
    // to follow rather than quietly become wrong.
    box.querySelector('.f-every').onchange = syncFromMonths;

    // The calculator FILLS the field, it does not own it. The bank's figure is
    // the one that gets paid, and rounding rules differ between lenders — so
    // this is a starting point you can type over, not a lock.
    // Which amount to work the instalment on. A KFC loan is usually released in
    // stages, and until the last one lands the bank fixes the instalment on
    // what has actually gone out — so "on the sanction" is the plan and "on
    // what has been released" is how it is running now.
    function calcBasis() {
      var r = box.querySelector('input[name^="mo-on-"]:checked');
      return r ? r.value : 'sanction';
    }
    box.querySelectorAll('input[name^="mo-on-"]').forEach(function (r) {
      r.onchange = summarise;
    });

    box.querySelector('#moCalcEmi').onclick = function () {
      read();
      var basis = calcBasis();
      var on = basis === 'released' ? released(d) : d.principal;
      if (basis === 'released' && !on) {
        setStatus('Nothing has been released yet, so there is nothing to work it out on. ' +
                  'Add a release below, or work it out on the sanction.', true);
        return;
      }
      var want = calcPayment(Object.assign({}, d, { principal: on }));
      if (!want) {
        setStatus(d.repay === 'interest-only'
          ? 'Enter the amount and the interest rate first.'
          : 'Enter the amount, the interest rate and the number of instalments first.', true);
        return;
      }
      box.querySelector('.f-emi').value = want;
      summarise();
      setStatus('Worked out ' + rupees(want) + ' ' + cadence(d) + ' on ' + rupees(on) +
                (basis === 'released' ? ' released' : ' sanctioned') +
                '. Change it if the bank says otherwise.');
    };

    function bindReleaseRows() {
      box.querySelectorAll('.mo-relrow').forEach(function (row) {
        row.querySelector('.r-del').onclick = function () {
          row.parentNode.removeChild(row);
          if (!box.querySelectorAll('.mo-relrow').length) {
            box.querySelector('#moRel').innerHTML = '<p class="mo-empty mo-tight">Nothing released yet.</p>';
          }
          summarise();
        };
        row.querySelectorAll('input').forEach(function (i) { i.oninput = summarise; });
      });
    }
    bindReleaseRows();

    box.querySelector('#moAddRel').onclick = function () {
      var host = box.querySelector('#moRel');
      var blank = host.querySelector('.mo-empty');
      if (blank) host.innerHTML = '';
      host.insertAdjacentHTML('beforeend', releaseRow({ id: uid('r'), date: today(), amount: 0, note: '' }));
      bindReleaseRows();
      var last = host.querySelector('.mo-relrow:last-child .r-amt');
      if (last) last.focus();
      summarise();
    };

    summarise();

    box.querySelector('.f-save').onclick = function () {
      read();
      if (!d.lender) { setStatus('Who is the loan from?', true); box.querySelector('.f-lender').focus(); return; }
      if (!d.emi) { setStatus('What is the EMI each month?', true); box.querySelector('.f-emi').focus(); return; }
      if (!d.from) {
        setStatus(d.start ? 'Set the moratorium, or clear the start month and type the first EMI month.'
                          : 'Which month was the first EMI?', true);
        box.querySelector(d.start ? '.f-mor' : '.f-from').focus();
        return;
      }
      // A release with an amount but no date cannot be placed in time, and a
      // release dated before the loan starts is nearly always a typed year.
      var undated = d.releases.filter(function (r) { return r.amount && !r.date; })[0];
      if (undated) { setStatus('One of the releases has an amount but no date.', true); return; }
      var early = d.releases.filter(function (r) { return r.date && d.start && r.date.slice(0, 7) < d.start; })[0];
      if (early) {
        setStatus('A release is dated ' + prettyDate(early.date) + ', before the loan starts (' +
                  monthName(d.start) + '). Check the date.', true);
        return;
      }
      d.releases = d.releases.filter(function (r) { return r.amount || r.date; });
      // Fewer instalments than are already ticked paid would make "left to
      // pay" negative, and the server would refuse the save anyway.
      if (d.months && d.months < d.paid.length) {
        setStatus(d.paid.length + ' EMIs are already ticked paid on this loan, so it cannot have only ' +
                  d.months + '.', true);
        return;
      }
      var i = D.loans.findIndex(function (x) { return x.id === d.id; });
      if (i >= 0) D.loans[i] = copy(d);
      edit = null;
      commit('loans').catch(function () {});
      renderLoans(); paintTiles();
    };
    box.querySelector('.f-cancel').onclick = function () {
      if (edit.isNew) removeNew(edit);
      edit = null;
      setStatus('');
      renderLoans();
    };
  }

  // ---- page: repeating bills -----------------------------------------------

  function renderBills() {
    var host = el('moBills');
    if (!host) return;
    if (!ready) { host.innerHTML = statusBar(); setStatus('Loading…'); return; }

    var now = thisMonth();
    var live = D.bills.filter(function (b) { return billIn(b, now) && !has(b.skip, now); });
    var per = live.reduce(function (a, b) { return a + b.amount; }, 0);
    var homeNow = live.reduce(function (a, b) { return a + (b.home ? b.amount : 0); }, 0);
    // A year is NOT this month twelve times over — a bill every two months
    // lands six times, not twelve. Each bill contributes 12/every.
    var perYear = D.bills.reduce(function (a, b) {
      var running = !b.to || b.to >= now;
      return a + (running ? b.amount * 12 / every(b) : 0);
    }, 0);

    host.innerHTML =
      '<div class="mo-cards">' +
        '<div class="mo-card mo-big"><span class="k">Falling due in ' + esc(monthName(now)) + '</span>' +
          '<strong>' + rupees(per) + '</strong><span class="c">' + live.length + ' of ' +
          D.bills.length + ' bills</span></div>' +
        '<div class="mo-card"><span class="k">A year of them</span><strong>' + rupees(perYear) +
          '</strong><span class="c">each bill at its own interval</span></div>' +
        '<div class="mo-card"><span class="k">Business</span><strong>' + rupees(per - homeNow) +
          '</strong><span class="c">this month</span></div>' +
        '<div class="mo-card"><span class="k">Home</span><strong>' + rupees(homeNow) +
          '</strong><span class="c">this month</span></div>' +
      '</div>' +
      '<p class="mo-caveat">A bill entered here counts in every month between its first and its last, ' +
        'without being typed again. Leave the last month empty while it is still running.</p>' +
      '<div class="mo-head"><h3 class="mo-h">Repeating bills</h3>' +
        '<button type="button" class="mo-btn" id="moAddBill">Add a repeating bill</button></div>' +
      '<datalist id="moCats">' + catOptions() + '</datalist>' +
      statusBar() +
      (D.bills.length
        ? '<ul class="mo-list">' + D.bills.map(function (b) {
            return (edit && edit.kind === 'bill' && edit.id === b.id)
              ? billForm(edit.draft, edit.isNew) : billRow(b);
          }).join('') + '</ul>'
        : emptyNote('No repeating bills yet.'));

    bindBills();
  }

  function billRow(b) {
    var now = thisMonth();
    var state = !b.from ? 'No start month set'
      : (b.to && now > b.to) ? 'Ended ' + monthName(b.to)
      : (now < b.from) ? 'Starts ' + monthName(b.from)
      : 'Running since ' + monthName(b.from);
    var on = billIn(b, now) && !has(b.skip, now);
    return '<li class="mo-li mo-tall' + (on ? '' : ' mo-skipped') + '" data-id="' + esc(b.id) + '">' +
      '<span class="mo-what"><b>' + esc(b.name || 'Untitled bill') + '</b>' +
        (b.home ? '<span class="mo-tag">home</span>' : '') +
        '<span class="mo-sub">' + esc(b.category || 'no category') +
          (b.home ? ' · the house' : (ventureName(b.venture) ? ' · ' + esc(ventureName(b.venture)) : '')) +
          ' · <b>' + esc(cadence(b)) + '</b></span>' +
        '<span class="mo-sub">' + esc(state) + ' · due on the ' + b.dueDay + '</span>' +
        (b.paid.length || b.skip.length
          ? '<span class="mo-sub">' + b.paid.length + ' months ticked paid' +
            (b.skip.length ? ', ' + b.skip.length + ' skipped' : '') + '</span>' : '') +
      '</span>' +
      '<span class="mo-amt"><b>' + rupees(b.amount) + '</b>' +
        '<span class="mo-sub">' + (every(b) === 1 ? 'a month' : 'each time') + '</span>' +
        (every(b) > 1 ? '<span class="mo-sub">' + rupees(b.amount * 12 / every(b)) + ' a year</span>' : '') +
      '</span>' +
      '<span class="mo-acts">' +
        '<button type="button" class="mo-x f-edit">Edit</button>' +
        '<button type="button" class="mo-x f-del">Delete</button>' +
      '</span>' +
    '</li>';
  }

  function billForm(b, isNew) {
    return '<li class="mo-li mo-open" data-id="' + esc(b.id) + '">' +
      '<div class="mo-grid">' +
        '<label>What is it<input type="text" class="f-name" value="' + esc(b.name) + '" placeholder="Shop rent"></label>' +
        '<label>Amount a month<input type="text" inputmode="decimal" class="f-amt" value="' + (b.amount || '') + '" placeholder="0"></label>' +
        '<label>Category<input type="text" list="moCats" class="f-cat" value="' + esc(b.category) + '" placeholder="Rent"></label>' +
        '<label>Venture' + ventureSelect(b.venture, 'f-ven') + '</label>' +
        '<label>Due on day<input type="number" min="1" max="31" class="f-day" value="' + b.dueDay + '"></label>' +
        '<label>Comes<select class="f-every">' + everyOptions(every(b)) + '</select></label>' +
        '<label>Whose<select class="f-home">' +
          '<option value=""' + (b.home ? '' : ' selected') + '>Business</option>' +
          '<option value="1"' + (b.home ? ' selected' : '') + '>Home</option>' +
        '</select></label>' +
        '<label>First month<input type="month" class="f-from" value="' + esc(b.from) + '"></label>' +
        '<label>Last month<input type="month" class="f-to" value="' + esc(b.to) + '"></label>' +
      '</div>' +
      '<p class="mo-facts" id="moBillSum"></p>' +
      '<p class="mo-facts"><span>Leave the last month empty while the bill is still running.</span></p>' +
      saveRow(isNew ? 'Save this bill' : 'Save changes') +
    '</li>';
  }

  function bindBills() {
    var host = el('moBills');

    el('moAddBill').onclick = function () {
      if (!leaveEdit()) return;
      var b = {
        id: uid('b'), name: '', amount: 0, category: '', venture: '',
        dueDay: 1, every: 1, home: false, from: thisMonth(), to: '',
        paid: [], skip: [], note: '',
      };
      D.bills.unshift(b);
      edit = { kind: 'bill', id: b.id, draft: copy(b), isNew: true };
      renderBills();
      var f = host.querySelector('.mo-open .f-name');
      if (f) f.focus();
    };

    host.querySelectorAll('.mo-li[data-id]:not(.mo-open)').forEach(function (li) {
      var id = li.getAttribute('data-id');
      var b = D.bills.filter(function (x) { return x.id === id; })[0];
      if (!b) return;
      li.querySelector('.f-edit').onclick = function () {
        if (!leaveEdit()) return;
        edit = { kind: 'bill', id: id, draft: copy(b), isNew: false };
        renderBills();
      };
      li.querySelector('.f-del').onclick = function () {
        if (!leaveEdit()) return;
        if (!confirm('Delete "' + (b.name || 'this bill') + '"? It will stop counting in every month.')) return;
        D.bills = D.bills.filter(function (x) { return x.id !== id; });
        commit('bills').catch(function () {});
        renderBills(); paintTiles();
      };
    });

    var open = host.querySelector('.mo-open');
    if (open) bindBillForm(open);
  }

  function bindBillForm(box) {
    var d = edit.draft;
    function read() {
      d.name = box.querySelector('.f-name').value.trim();
      d.amount = num(box.querySelector('.f-amt').value);
      d.category = box.querySelector('.f-cat').value.trim();
      d.venture = box.querySelector('.f-ven').value;
      d.dueDay = Math.min(31, Math.max(1, Number(box.querySelector('.f-day').value) || 1));
      d.every = Math.max(1, Math.min(12, Number(box.querySelector('.f-every').value) || 1));
      d.home = !!box.querySelector('.f-home').value;
      var f = box.querySelector('.f-from').value;
      var t = box.querySelector('.f-to').value;
      d.from = /^\d{4}-\d{2}$/.test(f) ? f : '';
      d.to = /^\d{4}-\d{2}$/.test(t) ? t : '';
    }

    // Which months it will actually land in, spelled out. "Every 2 months from
    // March" is easy to agree to and hard to picture; the next three dates are
    // not.
    function summarise() {
      read();
      var n = box.querySelector('#moBillSum');
      if (!n) return;
      if (!d.from) { n.innerHTML = '<span>Set the first month to see when it falls due.</span>'; return; }
      var when = [], m = d.from, guard = 0;
      while (when.length < 3 && guard++ < 60) {
        if (billIn(d, m)) when.push(monthName(m));
        m = shiftMonth(m, 1);
        if (d.to && m > d.to) break;
      }
      n.innerHTML =
        '<span><b>' + esc(rupees(d.amount)) + '</b> ' + esc(cadence(d)) +
          (every(d) > 1 ? ' — ' + esc(rupees(d.amount * 12 / every(d))) + ' a year' : '') + '</span>' +
        (when.length ? '<span>Falls due in ' + esc(when.join(', ')) +
          (when.length === 3 ? '…' : '') + '</span>' : '') +
        '<span>' + (d.home ? 'Counted as the <b>house</b>' : 'Counted as the <b>business</b>') + '</span>';
    }
    ['.f-amt', '.f-every', '.f-home', '.f-from', '.f-to', '.f-day'].forEach(function (sel) {
      var n = box.querySelector(sel);
      if (n) { n.oninput = summarise; n.onchange = summarise; }
    });
    summarise();

    box.querySelector('.f-save').onclick = function () {
      read();
      if (!d.name) { setStatus('What is the bill for?', true); box.querySelector('.f-name').focus(); return; }
      if (!d.amount) { setStatus('How much is it each month?', true); box.querySelector('.f-amt').focus(); return; }
      if (!d.from) { setStatus('Which month does it start?', true); box.querySelector('.f-from').focus(); return; }
      // A bill ending before it starts appears in no month at all, which looks
      // exactly like a bill that failed to save.
      if (d.to && d.to < d.from) {
        setStatus('It ends (' + monthName(d.to) + ') before it starts (' + monthName(d.from) + ').', true);
        return;
      }
      var i = D.bills.findIndex(function (x) { return x.id === d.id; });
      if (i >= 0) D.bills[i] = copy(d);
      edit = null;
      commit('bills').catch(function () {});
      renderBills(); paintTiles();
    };
    box.querySelector('.f-cancel').onclick = function () {
      if (edit.isNew) removeNew(edit);
      edit = null;
      setStatus('');
      renderBills();
    };
  }

  // ---- styles --------------------------------------------------------------

  var CSS =
    '.mo-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:20px 0 4px}' +
    '.mo-bar input[type=month]{font:inherit;font-size:14px;font-weight:700;padding:8px 10px;' +
    '  border:2px solid var(--color-divider);background:var(--color-bg);color:var(--color-text)}' +
    '.mo-nav{font:inherit;font-size:15px;font-weight:700;line-height:1;padding:9px 14px;cursor:pointer;' +
    '  border:2px solid var(--color-divider);background:var(--color-bg);color:var(--color-text)}' +
    '.mo-nav:hover{border-color:var(--color-accent)}' +
    '.mo-today{font-size:12.5px}' +

    '.mo-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:20px 0 6px}' +
    '.mo-card{border:2px solid var(--color-divider);padding:14px 16px;background:var(--color-bg)}' +
    '.mo-card .k{display:block;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;' +
    '  color:var(--color-neutral-500)}' +
    '.mo-card strong{display:block;font-family:var(--font-heading);font-weight:800;font-size:22px;' +
    '  letter-spacing:-0.02em;margin-top:6px}' +
    '.mo-card .c{display:block;font-size:12px;color:var(--color-neutral-700);margin-top:5px}' +
    '.mo-big{border-color:var(--color-accent)}' +
    '.mo-big strong{font-size:28px;color:var(--color-accent-700)}' +
    '.mo-up{color:var(--color-accent-700);font-weight:700}' +
    '.mo-down{color:#2b7a4b;font-weight:700}' +
    '.mo-flat{color:var(--color-neutral-700)}' +

    '.mo-head{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;' +
    '  margin:32px 0 10px}' +
    '.mo-h{font-family:var(--font-heading);font-weight:800;font-size:16px;margin:0}' +
    '.mo-btn{font:inherit;font-size:13px;font-weight:700;padding:10px 18px;cursor:pointer;white-space:nowrap;' +
    '  border:2px solid var(--color-accent);background:var(--color-accent);color:#fff}' +
    '.mo-btn:hover{background:var(--color-accent-700);border-color:var(--color-accent-700)}' +
    '.mo-quiet{background:none;color:var(--color-accent-700);border-color:var(--color-divider)}' +
    '.mo-quiet:hover{background:var(--color-accent-100);border-color:var(--color-accent);color:var(--color-accent-700)}' +
    '.mo-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:14px}' +

    // ---- the list ----
    'ul.mo-list{list-style:none;margin:6px 0 0;padding:0;border-top:1px solid var(--color-divider)}' +
    '.mo-li{display:grid;grid-template-columns:120px minmax(0,1fr) 130px 130px auto;gap:14px;' +
    '  align-items:center;padding:11px 2px;border-bottom:1px solid var(--color-divider);font-size:13px}' +
    '.mo-tall{grid-template-columns:minmax(0,1fr) 150px auto}' +
    '.mo-when{font-weight:700;white-space:nowrap}' +
    '.mo-what{min-width:0}' +
    '.mo-what b{font-family:var(--font-heading);font-weight:800;font-size:13.5px;display:block}' +
    '.mo-sub{display:block;font-size:11.5px;color:var(--color-neutral-700);margin-top:2px}' +
    '.mo-for{color:var(--color-neutral-700);font-size:12px}' +
    '.mo-amt{text-align:right;font-weight:700;white-space:nowrap}' +
    '.mo-amt b{font-family:var(--font-heading);font-weight:800;font-size:15px}' +
    '.mo-amt .mo-sub{text-align:right;font-weight:400}' +
    '.mo-acts{display:flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:wrap}' +
    '.mo-skipped{opacity:.5}' +
    '.mo-late{display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.06em;' +
    '  text-transform:uppercase;color:var(--color-accent-700);background:var(--color-accent-100);' +
    '  padding:1px 6px;margin-left:6px}' +
    '.mo-tick{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;white-space:nowrap}' +
    '.mo-x{font:inherit;font-size:12px;font-weight:600;padding:5px 11px;cursor:pointer;white-space:nowrap;' +
    '  border:2px solid var(--color-divider);background:none;color:var(--color-accent-700)}' +
    '.mo-x:hover{border-color:var(--color-accent);background:var(--color-accent-100)}' +

    // ---- one row, open as a form ----
    '.mo-open{display:block;border:2px solid var(--color-accent);padding:16px 18px;' +
    '  background:var(--color-accent-100);margin:-1px 0}' +
    '.mo-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px 14px}' +
    '.mo-grid label{display:block;font-size:11px;font-weight:700;letter-spacing:.06em;' +
    '  text-transform:uppercase;color:var(--color-neutral-700)}' +
    '.mo-grid label.wide{grid-column:1/-1}' +
    '.mo-grid input,.mo-grid select{display:block;font:inherit;font-size:13px;padding:8px 10px;width:100%;' +
    '  margin-top:5px;text-transform:none;letter-spacing:0;font-weight:400;color:var(--color-text);' +
    '  border:2px solid var(--color-divider);background:var(--color-bg)}' +
    '.mo-grid input:focus,.mo-grid select:focus{outline:none;border-color:var(--color-accent)}' +
    '.mo-save{border-top:1px solid var(--color-neutral-300);padding-top:14px;margin-top:16px}' +
    '.mo-editing{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;' +
    '  color:var(--color-accent-700)}' +

    '.mo-meter{display:block;height:6px;background:var(--color-surface);' +
    '  border:1px solid var(--color-divider);margin:7px 0 5px;max-width:260px}' +
    '.mo-meter i{display:block;height:100%;background:var(--color-accent)}' +
    '.mo-facts{display:flex;flex-wrap:wrap;gap:6px 22px;margin:14px 0 0;font-size:12.5px;' +
    '  color:var(--color-neutral-800)}' +
    '.mo-facts b{font-family:var(--font-heading);font-weight:800}' +
    '.mo-sech{font-family:var(--font-heading);font-weight:800;font-size:12px;letter-spacing:.09em;' +
    '  text-transform:uppercase;color:var(--color-neutral-700);margin:22px 0 10px;' +
    '  padding-top:14px;border-top:1px solid var(--color-neutral-300)}' +
    // A derived field is shown, not typed. Making it look different from the
    // ones you can change is the difference between "why will this not edit"
    // and "of course, it is worked out".
    '.mo-derived input{background:var(--color-surface);color:var(--color-neutral-700);' +
    '  border-style:dashed;cursor:default}' +
    '.mo-hol{color:var(--color-accent-700);font-weight:700}' +
    'table.mo-sched{min-width:36rem}' +
    'table.mo-sched tr.on{background:var(--color-accent-100)}' +
    'table.mo-sched tr.tot td{border-top:2px solid var(--color-neutral-300);' +
    '  border-bottom:none;padding-top:10px}' +
    '.mo-tag{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.07em;' +
    '  text-transform:uppercase;padding:1px 7px;margin:3px 0 0;' +
    '  background:var(--color-surface);color:var(--color-neutral-700);' +
    '  border:1px solid var(--color-neutral-300)}' +
    '.mo-kind{background:var(--color-accent-100);color:var(--color-accent-700);' +
    '  border-color:var(--color-accent)}' +
    '.mo-relrow{display:grid;grid-template-columns:150px 130px minmax(0,1fr) auto;gap:8px;' +
    '  align-items:center;margin-bottom:8px}' +
    '.mo-relrow input{font:inherit;font-size:13px;padding:8px 10px;width:100%;' +
    '  border:2px solid var(--color-divider);background:var(--color-bg);color:var(--color-text)}' +
    '.mo-relrow input:focus{outline:none;border-color:var(--color-accent)}' +
    '.mo-relrow .r-del{padding:6px 12px;font-size:14px;line-height:1}' +
    '.mo-tight{padding:10px 14px;margin:0}' +
    '@media(max-width:700px){.mo-relrow{grid-template-columns:1fr 1fr;gap:6px}' +
    '  .mo-relrow .r-note{grid-column:1/-1}.mo-relrow input{font-size:16px}}' +

    '.mo-split{margin-top:6px}' +
    '.mo-srow{display:grid;grid-template-columns:minmax(110px,1.1fr) 2fr 110px 44px;gap:12px;' +
    '  align-items:center;padding:7px 0;border-bottom:1px solid var(--color-divider);font-size:13px}' +
    '.mo-srow .b{height:9px;background:var(--color-surface);border:1px solid var(--color-divider)}' +
    '.mo-srow .b i{display:block;height:100%;background:var(--color-accent);opacity:.75}' +
    '.mo-srow .v{text-align:right;font-weight:700}' +
    '.mo-srow .p{text-align:right;color:var(--color-neutral-700);font-size:12px}' +

    // ---- the twelve-month outlook ----
    '.mo-onnow{border-color:var(--color-accent);background:var(--color-accent-100);' +
    '  color:var(--color-accent-700)}' +
    '.mo-calwrap{border:2px solid var(--color-divider);padding:16px 18px;margin-top:14px;' +
    '  background:var(--color-bg)}' +
    '.mo-calhead{font-size:12.5px;color:var(--color-neutral-700);margin:0 0 14px;max-width:70ch}' +
    '.mo-calgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:8px}' +
    '.mo-cal{display:flex;flex-direction:column;gap:3px;text-align:left;font:inherit;cursor:pointer;' +
    '  border:2px solid var(--color-divider);background:var(--color-bg);padding:10px 11px;' +
    '  color:var(--color-text)}' +
    '.mo-cal:hover{border-color:var(--color-accent)}' +
    '.mo-cal.on{border-color:var(--color-accent);background:var(--color-accent-100)}' +
    '.mo-cal.quiet{opacity:.55}' +
    '.mo-calm{font-size:10.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;' +
    '  color:var(--color-neutral-500)}' +
    '.mo-calm i{font-style:normal;opacity:.7}' +
    '.mo-calv{font-family:var(--font-heading);font-weight:800;font-size:14px;letter-spacing:-0.01em}' +
    '.mo-caln{font-size:10.5px;color:var(--color-neutral-700)}' +

    // ---- the notification button ----
    '.mo-notify{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px 20px;align-items:center;' +
    '  border:2px solid var(--color-divider);border-left-width:5px;padding:14px 16px;' +
    '  margin:0 0 20px;background:var(--color-bg)}' +
    '.mo-notify.on{border-left-color:#2b7a4b}' +
    '.mo-nleft b{display:block;font-family:var(--font-heading);font-weight:800;font-size:14px}' +
    '.mo-nright{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end}' +
    '.mo-notify .mo-remnote{grid-column:1/-1;margin:0}' +
    '.mo-notify .mo-btn:disabled{opacity:.55;cursor:default;background:none;' +
    '  color:var(--color-neutral-700);border-color:var(--color-divider)}' +
    '@media(max-width:620px){.mo-notify{grid-template-columns:1fr}' +
    '  .mo-nright{justify-content:flex-start}}' +

    // ---- reminders ----
    '.mo-remind{border:2px solid var(--color-divider);border-left-width:5px;padding:14px 16px;' +
    '  margin-top:14px;background:var(--color-bg)}' +
    '.mo-remind.warn{border-left-color:var(--color-accent)}' +
    '.mo-remind.bad{border-left-color:var(--color-accent-700);background:var(--color-accent-100)}' +
    '.mo-remhead{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap}' +
    '.mo-remhead b{font-family:var(--font-heading);font-weight:800;font-size:14px}' +
    '.mo-remset{display:flex;align-items:center;gap:12px;font-size:12.5px;' +
    '  color:var(--color-neutral-700);flex-wrap:wrap}' +
    '.mo-remset select{font:inherit;font-size:12.5px;padding:5px 8px;' +
    '  border:2px solid var(--color-divider);background:var(--color-bg);color:var(--color-text)}' +
    'ul.mo-remlist{list-style:none;margin:12px 0 0;padding:0}' +
    'ul.mo-remlist li{display:grid;grid-template-columns:minmax(0,1fr) 120px 180px;gap:12px;' +
    '  align-items:center;padding:7px 0;border-top:1px solid var(--color-divider);font-size:13px}' +
    'ul.mo-remlist li span:nth-child(2){text-align:right;font-weight:700}' +
    'ul.mo-remlist li span:nth-child(3){text-align:right;color:var(--color-neutral-700);font-size:12px}' +
    'ul.mo-remlist li.late span:nth-child(3){color:var(--color-accent-700)}' +
    '.mo-remnote{font-size:11.5px;color:var(--color-neutral-700);margin:12px 0 0;max-width:64ch}' +
    '@media(max-width:700px){ul.mo-remlist li{grid-template-columns:1fr auto}' +
    '  ul.mo-remlist li span:nth-child(3){grid-column:1/-1;text-align:left}}' +

    '.mo-status{font-size:12.5px;color:var(--color-neutral-700);margin:12px 0 0;min-height:1.2em}' +
    '.mo-status.bad{color:var(--color-accent-700);font-weight:700}' +
    '.mo-empty{font-size:13px;color:var(--color-neutral-700);border:2px dashed var(--color-divider);' +
    '  padding:18px 16px;margin:6px 0 0}' +
    '.mo-caveat{font-size:12.5px;color:var(--color-neutral-700);max-width:62ch;margin:14px 0 0}' +

    '@media(max-width:860px){' +
    '  .mo-li,.mo-tall{grid-template-columns:minmax(0,1fr) auto;gap:6px 12px}' +
    '  .mo-when{grid-column:1/-1;font-size:12px;color:var(--color-neutral-700)}' +
    '  .mo-for{grid-column:1/-1;font-size:11.5px}' +
    '  .mo-acts{grid-column:1/-1;justify-content:flex-start;margin-top:6px}' +
    '  .mo-srow{grid-template-columns:1fr 92px 40px}' +
    '  .mo-srow .b{display:none}' +
    '}' +
    // iOS zooms the page in when a field under 16px is focused, and never
    // zooms back out. Every field here is a number or a date, which is exactly
    // when that is most disruptive.
    '@media(max-width:700px){' +
    '  .mo-grid input,.mo-grid select,.mo-bar input[type=month]{font-size:16px}' +
    '}';

  function injectCss() {
    if (document.getElementById('mo-css')) return;
    var st = document.createElement('style');
    st.id = 'mo-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  // ---- the one thing admin.html calls --------------------------------------

  var PAGES = {
    'money-month': renderMonth,
    'money-loans': renderLoans,
    'money-bills': renderBills,
  };

  window.KMS_MONEY = {
    show: function (key) {
      if (key !== 'money' && !PAGES[key]) return;
      // Moving between the pages abandons an open form, so it has to ask, and
      // it has to tidy up a half-added row that was never saved.
      if (edit && key !== current) {
        if (edit.isNew) removeNew(edit);
        edit = null;
      }
      current = key;
      injectCss();
      var draw = PAGES[key] || function () {};
      if (!ready) load(yearOf(month), function () { draw(); paintTiles(); redrawNotify(); });
      else { draw(); paintTiles(); redrawNotify(); }
    },
    // Exposed for the tests, and for anything that wants the arithmetic
    // without the page around it.
    _calc: {
      monthTotals: monthTotals, billIn: billIn, loanInstalment: loanInstalment,
      left: left, nextDue: nextDue, shiftMonth: shiftMonth, dueDate: dueDate,
      rupees: rupees, monthDiff: monthDiff, num: num,
      released: released, firstEmi: firstEmi, moratoriumEnds: moratoriumEnds,
      inMoratorium: inMoratorium, termYears: termYears,
      monthInterest: monthInterest, moratoriumSchedule: moratoriumSchedule,
      moratoriumTotal: moratoriumTotal, releasedBy: releasedBy,
      every: every, calcPayment: calcPayment, periodRate: periodRate, cadence: cadence,
      dueItems: dueItems, dueSoon: dueSoon, addDays: addDays, daysBetween: daysBetween, inDays: inDays,
    },
    _state: D,
    _settings: function () { return settings; },
  };

  // Load once at boot so the tile on the front screen can show this month's
  // total without the reader having to open anything first.
  function boot() {
    injectCss();
    load(yearOf(month), function () {
      paintTiles();
      if (current && PAGES[current]) PAGES[current]();
      redrawNotify();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
