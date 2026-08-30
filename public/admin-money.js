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

  function billIn(b, month) {
    if (!b.from || month < b.from) return false;
    if (b.to && month > b.to) return false;
    return true;
  }
  // Which instalment number this month is for a loan, or -1 if none is due.
  // A loan with months = 0 has not been told how long it runs, so it is treated
  // as still running rather than as finished — the alternative silently drops
  // it out of every month.
  function loanInstalment(l, month) {
    if (!l.from || month < l.from) return -1;
    var i = monthDiff(l.from, month);
    if (l.months && i >= l.months) return -1;
    return i;
  }
  function has(arr, m) { return (arr || []).indexOf(m) !== -1; }
  function toggle(arr, m, on) {
    var i = arr.indexOf(m);
    if (on && i === -1) arr.push(m);
    if (!on && i !== -1) arr.splice(i, 1);
    arr.sort();
  }

  // What a month costs: recorded spending, plus the bills that apply and were
  // not skipped, plus the EMIs due. Bills and EMIs count whether or not they
  // have been ticked as paid — an unpaid bill is still that month's cost.
  function monthTotals(D, month) {
    var out = { spent: 0, bills: 0, emi: 0, byCat: {}, count: 0 };
    function add(cat, amt) {
      out.byCat[cat || 'Uncategorised'] = (out.byCat[cat || 'Uncategorised'] || 0) + amt;
    }
    D.entries.forEach(function (e) {
      if (e.date.slice(0, 7) !== month) return;
      out.spent += e.amount; out.count++; add(e.category, e.amount);
    });
    D.bills.forEach(function (b) {
      if (!billIn(b, month) || has(b.skip, month)) return;
      out.bills += b.amount; add(b.category, b.amount);
    });
    D.loans.forEach(function (l) {
      if (loanInstalment(l, month) < 0) return;
      out.emi += l.emi; add('Loan EMI', l.emi);
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
    return Math.max(0, l.months - l.paid.length) * l.emi;
  }
  function nextDue(l) {
    if (!l.from) return '';
    var i = l.paid.length;
    if (l.months && i >= l.months) return '';
    return dueDate(shiftMonth(l.from, i), l.dueDay);
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
        ready = true;
        setStatus('');
        paintTiles();
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
    if (m) m.textContent = rupees(t.total) + ' this month';
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
      '</div>' +

      '<div class="mo-cards">' +
        '<div class="mo-card mo-big"><span class="k">Total for ' + esc(monthName(month)) + '</span>' +
          '<strong>' + rupees(t.total) + '</strong><span class="c">' + change + '</span></div>' +
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
          (e.note ? '<span class="mo-sub">' + esc(e.note) + '</span>' : '') + '</span>' +
        '<span class="mo-for">' + esc(ventureName(e.venture) || '—') + '</span>' +
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
        '<label class="wide">What was it for<input type="text" class="f-note" value="' + esc(e.note) + '" placeholder="optional"></label>' +
      '</div>' +
      saveRow(isNew ? 'Save this expense' : 'Save changes') +
    '</li>';
  }

  // The bills and EMIs that fall in this month. Ticking one paid is the only
  // change available here — the amount belongs to the rule, not to the month,
  // so editing it here would change every month at once without saying so.
  function renderDueList(m) {
    var rows = [];
    D.bills.forEach(function (b) {
      if (!billIn(b, m)) return;
      rows.push({
        kind: 'bill', id: b.id, name: b.name || 'Untitled bill',
        what: b.category || 'Bill', amount: b.amount,
        when: dueDate(m, b.dueDay), paid: has(b.paid, m), skipped: has(b.skip, m),
        venture: b.venture,
      });
    });
    D.loans.forEach(function (l) {
      var i = loanInstalment(l, m);
      if (i < 0) return;
      rows.push({
        kind: 'loan', id: l.id, name: l.lender || 'Untitled loan',
        what: 'EMI ' + (i + 1) + (l.months ? ' of ' + l.months : ''),
        amount: l.emi, when: dueDate(m, l.dueDay), paid: has(l.paid, m), skipped: false,
        venture: l.venture,
      });
    });
    if (!rows.length) return emptyNote('No repeating bills or EMIs fall in this month.');
    rows.sort(function (a, b) { return a.when.localeCompare(b.when); });

    var now = today();
    return '<ul class="mo-list">' + rows.map(function (r) {
      var late = !r.paid && !r.skipped && r.when < now;
      return '<li class="mo-li' + (r.skipped ? ' mo-skipped' : '') +
             '" data-kind="' + r.kind + '" data-id="' + esc(r.id) + '">' +
        '<span class="mo-when">' + esc(prettyDate(r.when)) +
          (late ? '<span class="mo-late">overdue</span>' : '') + '</span>' +
        '<span class="mo-what"><b>' + esc(r.name) + '</b><span class="mo-sub">' + esc(r.what) + '</span></span>' +
        '<span class="mo-for">' + esc(ventureName(r.venture) || '—') + '</span>' +
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

    el('moAddEntry').onclick = function () {
      if (!leaveEdit()) return;
      var d = (thisMonth() === month) ? today() : dueDate(month, 1);
      var e = { id: uid('e'), date: d, amount: 0, category: '', venture: '', note: '' };
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

      // A bill or an EMI: the ticks only, and they save at once.
      var list = kind === 'bill' ? D.bills : D.loans;
      var it = list.filter(function (x) { return x.id === id; })[0];
      if (!it) return;
      var paid = li.querySelector('.f-paid');
      if (paid) paid.onchange = function () {
        toggle(it.paid, month, this.checked);
        commit(kind === 'bill' ? 'bills' : 'loans').catch(function () {});
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
    var dueNow = 0, owed = 0;
    D.loans.forEach(function (l) {
      if (loanInstalment(l, now) >= 0) dueNow += l.emi;
      owed += left(l);
    });

    host.innerHTML =
      '<div class="mo-cards">' +
        '<div class="mo-card mo-big"><span class="k">EMI due in ' + esc(monthName(now)) + '</span>' +
          '<strong>' + rupees(dueNow) + '</strong><span class="c">' + D.loans.length +
          (D.loans.length === 1 ? ' loan' : ' loans') + '</span></div>' +
        '<div class="mo-card"><span class="k">Still to repay</span><strong>' + rupees(owed) + '</strong>' +
          '<span class="c">instalments left × EMI, interest included</span></div>' +
      '</div>' +
      '<p class="mo-caveat">These are the figures you enter. Nothing here is taken from a bank — ' +
        'check a statement before relying on it for a payment.</p>' +
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
    return '<li class="mo-li mo-tall" data-id="' + esc(l.id) + '">' +
      '<span class="mo-what"><b>' + esc(l.lender || 'Untitled loan') + '</b>' +
        '<span class="mo-sub">' + esc(l.purpose || 'no purpose set') +
        (ventureName(l.venture) ? ' · ' + esc(ventureName(l.venture)) : '') + '</span>' +
        '<span class="mo-meter"><i style="width:' + done + '%"></i></span>' +
        '<span class="mo-sub"><b>' + l.paid.length + '</b> of ' + (l.months || '—') + ' paid · ' +
          'next ' + (n ? esc(prettyDate(n)) : 'nothing outstanding') +
          (late ? ' <span class="mo-late">overdue</span>' : '') + '</span>' +
      '</span>' +
      '<span class="mo-amt"><b>' + rupees(l.emi) + '</b><span class="mo-sub">a month</span>' +
        '<span class="mo-sub">' + rupees(left(l)) + ' left</span></span>' +
      '<span class="mo-acts">' +
        '<button type="button" class="mo-x f-pay">Mark next EMI paid</button>' +
        '<button type="button" class="mo-x f-edit">Edit</button>' +
        '<button type="button" class="mo-x f-del">Delete</button>' +
      '</span>' +
    '</li>';
  }

  function loanForm(l, isNew) {
    return '<li class="mo-li mo-open" data-id="' + esc(l.id) + '">' +
      '<div class="mo-grid">' +
        '<label>Lender<input type="text" class="f-lender" value="' + esc(l.lender) + '" placeholder="Kerala Financial Corporation"></label>' +
        '<label>What for<input type="text" class="f-purpose" value="' + esc(l.purpose) + '" placeholder="Boat yard"></label>' +
        '<label>Venture' + ventureSelect(l.venture, 'f-ven') + '</label>' +
        '<label>Amount borrowed<input type="text" inputmode="decimal" class="f-principal" value="' + (l.principal || '') + '" placeholder="0"></label>' +
        '<label>EMI a month<input type="text" inputmode="decimal" class="f-emi" value="' + (l.emi || '') + '" placeholder="0"></label>' +
        '<label>Interest %<input type="text" inputmode="decimal" class="f-rate" value="' + (l.rate || '') + '" placeholder="0"></label>' +
        '<label>First EMI month<input type="month" class="f-from" value="' + esc(l.from) + '"></label>' +
        '<label>How many EMIs<input type="number" min="0" max="600" class="f-months" value="' + (l.months || '') + '" placeholder="e.g. 84"></label>' +
        '<label>Due on day<input type="number" min="1" max="31" class="f-day" value="' + l.dueDay + '"></label>' +
      '</div>' +
      (l.paid.length ? '<p class="mo-facts"><span><b>' + l.paid.length + '</b> instalments are ticked paid on this loan</span></p>' : '') +
      saveRow(isNew ? 'Save this loan' : 'Save changes') +
    '</li>';
  }

  function bindLoans() {
    var host = el('moLoans');

    el('moAddLoan').onclick = function () {
      if (!leaveEdit()) return;
      var l = {
        id: uid('l'), lender: '', purpose: '', principal: 0, emi: 0, rate: 0,
        dueDay: 5, from: thisMonth(), months: 0, venture: '', paid: [], note: '',
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
    function read() {
      d.lender = box.querySelector('.f-lender').value.trim();
      d.purpose = box.querySelector('.f-purpose').value.trim();
      d.venture = box.querySelector('.f-ven').value;
      d.principal = num(box.querySelector('.f-principal').value);
      d.emi = num(box.querySelector('.f-emi').value);
      var r = Number(box.querySelector('.f-rate').value);
      d.rate = isFinite(r) && r >= 0 && r <= 100 ? Math.round(r * 100) / 100 : 0;
      var f = box.querySelector('.f-from').value;
      d.from = /^\d{4}-\d{2}$/.test(f) ? f : '';
      d.months = Math.max(0, Math.min(600, Math.round(Number(box.querySelector('.f-months').value) || 0)));
      d.dueDay = Math.min(31, Math.max(1, Number(box.querySelector('.f-day').value) || 1));
    }
    box.querySelector('.f-save').onclick = function () {
      read();
      if (!d.lender) { setStatus('Who is the loan from?', true); box.querySelector('.f-lender').focus(); return; }
      if (!d.emi) { setStatus('What is the EMI each month?', true); box.querySelector('.f-emi').focus(); return; }
      if (!d.from) { setStatus('Which month was the first EMI?', true); box.querySelector('.f-from').focus(); return; }
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

    host.innerHTML =
      '<div class="mo-cards">' +
        '<div class="mo-card mo-big"><span class="k">Repeating bills this month</span>' +
          '<strong>' + rupees(per) + '</strong><span class="c">' + live.length + ' of ' +
          D.bills.length + ' running</span></div>' +
        '<div class="mo-card"><span class="k">A year of them</span><strong>' + rupees(per * 12) +
          '</strong><span class="c">at this month’s rate</span></div>' +
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
        '<span class="mo-sub">' + esc(b.category || 'no category') +
          (ventureName(b.venture) ? ' · ' + esc(ventureName(b.venture)) : '') + '</span>' +
        '<span class="mo-sub">' + esc(state) + ' · due on the ' + b.dueDay + '</span>' +
        (b.paid.length || b.skip.length
          ? '<span class="mo-sub">' + b.paid.length + ' months ticked paid' +
            (b.skip.length ? ', ' + b.skip.length + ' skipped' : '') + '</span>' : '') +
      '</span>' +
      '<span class="mo-amt"><b>' + rupees(b.amount) + '</b><span class="mo-sub">a month</span></span>' +
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
        '<label>First month<input type="month" class="f-from" value="' + esc(b.from) + '"></label>' +
        '<label>Last month<input type="month" class="f-to" value="' + esc(b.to) + '"></label>' +
      '</div>' +
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
        dueDay: 1, from: thisMonth(), to: '', paid: [], skip: [], note: '',
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
      var f = box.querySelector('.f-from').value;
      var t = box.querySelector('.f-to').value;
      d.from = /^\d{4}-\d{2}$/.test(f) ? f : '';
      d.to = /^\d{4}-\d{2}$/.test(t) ? t : '';
    }
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

    '.mo-split{margin-top:6px}' +
    '.mo-srow{display:grid;grid-template-columns:minmax(110px,1.1fr) 2fr 110px 44px;gap:12px;' +
    '  align-items:center;padding:7px 0;border-bottom:1px solid var(--color-divider);font-size:13px}' +
    '.mo-srow .b{height:9px;background:var(--color-surface);border:1px solid var(--color-divider)}' +
    '.mo-srow .b i{display:block;height:100%;background:var(--color-accent);opacity:.75}' +
    '.mo-srow .v{text-align:right;font-weight:700}' +
    '.mo-srow .p{text-align:right;color:var(--color-neutral-700);font-size:12px}' +

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
      if (!ready) load(yearOf(month), function () { draw(); paintTiles(); });
      else { draw(); paintTiles(); }
    },
    // Exposed for the tests, and for anything that wants the arithmetic
    // without the page around it.
    _calc: {
      monthTotals: monthTotals, billIn: billIn, loanInstalment: loanInstalment,
      left: left, nextDue: nextDue, shiftMonth: shiftMonth, dueDate: dueDate,
      rupees: rupees, monthDiff: monthDiff, num: num,
    },
    _state: D,
  };

  // Load once at boot so the tile on the front screen can show this month's
  // total without the reader having to open anything first.
  function boot() {
    injectCss();
    load(yearOf(month), function () {
      paintTiles();
      if (current && PAGES[current]) PAGES[current]();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
