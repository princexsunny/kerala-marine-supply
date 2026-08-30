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

  // ---- state ---------------------------------------------------------------

  var D = { year: 0, entries: [], bills: [], loans: [], categories: [] };
  var month = thisMonth();
  var loaded = {};        // years already fetched, so switching back is instant
  var years = {};         // year -> entries, kept so a year switch does not lose the other
  var ready = false;
  var current = '';       // which of the pages is open

  function ventures() {
    return (window.KMS_VISIBLE || window.KMS_VENTURES || []).filter(function (v) { return !v.hidden; });
  }
  function ventureName(slug) {
    var v = ventures().filter(function (x) { return x.slug === slug; })[0];
    return v ? v.name.replace(/^Shalom /, '') : '';
  }

  // ---- saving --------------------------------------------------------------
  //
  // Debounced, and coalesced: a second change while a save is in flight queues
  // one more save rather than racing it. Typing an amount fires a change per
  // keystroke, and without this every one of them would be a request.
  var saving = { entries: false, bills: false, loans: false };
  var again = {};
  var timers = {};

  function setStatus(text, bad) {
    var n = el('moStatus');
    if (!n) return;
    n.textContent = text;
    n.style.color = bad ? 'var(--color-accent-700)' : 'var(--color-neutral-700)';
  }

  function save(what) {
    clearTimeout(timers[what]);
    timers[what] = setTimeout(function () { doSave(what); }, 650);
    setStatus('Saving…');
  }

  function doSave(what) {
    if (saving[what]) { again[what] = true; return; }
    saving[what] = true;

    var url, body;
    if (what === 'entries') {
      url = API + '/entries/' + D.year;
      body = { entries: D.entries };
    } else {
      url = API + '/' + what;
      body = { items: D[what] };
    }

    fetch(url, {
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
      .then(function () {
        saving[what] = false;
        if (again[what]) { again[what] = false; doSave(what); return; }
        setStatus('Saved ' + new Date().toLocaleTimeString('en-IN',
          { hour: '2-digit', minute: '2-digit' }));
      })
      .catch(function (err) {
        saving[what] = false;
        // The change is still on screen and still in memory — say what went
        // wrong rather than reverting under the reader and losing the typing.
        setStatus(err.message + ' Your change is still here; try again.', true);
      });
  }

  // A save that has not left yet must not be lost to a closed tab. keepalive
  // lets the request outlive the page.
  window.addEventListener('pagehide', function () {
    ['entries', 'bills', 'loans'].forEach(function (what) {
      if (!timers[what]) return;
      clearTimeout(timers[what]);
      var url = what === 'entries' ? API + '/entries/' + D.year : API + '/' + what;
      var body = what === 'entries' ? { entries: D.entries } : { items: D[what] };
      try {
        fetch(url, {
          method: 'PUT', keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin', body: JSON.stringify(body),
        });
      } catch (e) {}
    });
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

  function statusBar() {
    return '<p class="mo-status" id="moStatus"></p>';
  }

  function emptyNote(text) {
    return '<p class="mo-empty">' + esc(text) + '</p>';
  }

  // ---- page: the month -----------------------------------------------------

  function renderMonth() {
    var host = el('moMonth');
    if (!host) return;
    if (!ready) { host.innerHTML = statusBar(); setStatus('Loading…'); return; }

    var t = monthTotals(D, month);
    var prev = shiftMonth(month, -1);
    var pt = loaded[yearOf(prev)] ? monthTotals({ entries: years[yearOf(prev)] || [], bills: D.bills, loans: D.loans }, prev) : null;

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

    var html =
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

      // ---- add ----
      '<h3 class="mo-h">Add an expense</h3>' +
      '<div class="mo-add">' +
        '<input type="date" id="moDate" value="' + dueDate(month, new Date().getMonth() + 1 === Number(month.slice(5, 7)) && String(new Date().getFullYear()) === month.slice(0, 4) ? new Date().getDate() : 1) + '">' +
        '<input type="text" id="moAmt" inputmode="decimal" placeholder="Amount">' +
        '<input type="text" id="moCat" list="moCats" placeholder="Category">' +
        ventureSelect('', 'mo-v') +
        '<input type="text" id="moNote" placeholder="What was it for? (optional)">' +
        '<button type="button" class="mo-btn" id="moAdd">Add</button>' +
      '</div>' +
      '<datalist id="moCats">' + catOptions() + '</datalist>' +
      statusBar() +

      // ---- what was spent ----
      '<h3 class="mo-h">Spent in ' + esc(monthName(month)) + '</h3>' +
      renderEntryTable() +

      // ---- what repeats ----
      '<h3 class="mo-h">Due this month</h3>' +
      renderDueTable(month) +

      // ---- where it went ----
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

    host.innerHTML = html;
    bindMonth();
  }

  function renderEntryTable() {
    var rows = D.entries.filter(function (e) { return e.date.slice(0, 7) === month; });
    if (!rows.length) return emptyNote('No expenses recorded in this month yet.');
    return '<div class="scroll"><table class="mo-tbl">' +
      '<thead><tr><th>Date</th><th>Amount</th><th>Category</th><th>Venture</th><th>What for</th><th></th></tr></thead><tbody>' +
      rows.map(function (e) {
        return '<tr data-id="' + esc(e.id) + '">' +
          '<td><input type="date" class="f-date" value="' + esc(e.date) + '"></td>' +
          '<td><input type="text" inputmode="decimal" class="f-amt" value="' + e.amount + '"></td>' +
          '<td><input type="text" list="moCats" class="f-cat" value="' + esc(e.category) + '"></td>' +
          '<td>' + ventureSelect(e.venture, 'f-ven') + '</td>' +
          '<td><input type="text" class="f-note" value="' + esc(e.note) + '"></td>' +
          '<td class="r"><button type="button" class="mo-x" title="Delete this expense">Delete</button></td>' +
        '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  // The bills and EMIs that fall in this month. Ticking one paid is the only
  // edit available here — the amount belongs to the rule, not to the month, so
  // changing it here would be changing every month at once without saying so.
  function renderDueTable(m) {
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

    var today = new Date().toISOString().slice(0, 10);
    return '<div class="scroll"><table class="mo-tbl">' +
      '<thead><tr><th>Due</th><th>What</th><th>Amount</th><th>For</th><th>Paid</th><th></th></tr></thead><tbody>' +
      rows.map(function (r) {
        var late = !r.paid && !r.skipped && r.when < today;
        return '<tr data-kind="' + r.kind + '" data-id="' + esc(r.id) + '"' +
               (r.skipped ? ' class="mo-skipped"' : '') + '>' +
          '<td>' + prettyDate(r.when) +
            (late ? ' <span class="mo-late">overdue</span>' : '') + '</td>' +
          '<td><strong>' + esc(r.name) + '</strong><br><span class="mo-sub">' + esc(r.what) + '</span></td>' +
          '<td>' + rupees(r.amount) + '</td>' +
          '<td>' + esc(ventureName(r.venture) || '—') + '</td>' +
          '<td><label class="mo-tick"><input type="checkbox" class="f-paid"' +
            (r.paid ? ' checked' : '') + (r.skipped ? ' disabled' : '') + '> paid</label></td>' +
          '<td class="r">' + (r.kind === 'bill'
            ? '<label class="mo-tick"><input type="checkbox" class="f-skip"' +
              (r.skipped ? ' checked' : '') + '> not this month</label>'
            : '') + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function bindMonth() {
    var host = el('moMonth');

    function goTo(m) {
      month = m;
      var y = yearOf(m);
      if (y !== D.year) {
        // Keep the year we are leaving, so switching back does not refetch and
        // an unsaved edit in it is not thrown away.
        years[D.year] = D.entries;
        load(y, renderMonth);
      } else {
        renderMonth();
      }
      paintTiles();
    }

    el('moPrev').onclick = function () { goTo(shiftMonth(month, -1)); };
    el('moNext').onclick = function () { goTo(shiftMonth(month, 1)); };
    el('moNow').onclick = function () { goTo(thisMonth()); };
    el('moPick').onchange = function () { if (/^\d{4}-\d{2}$/.test(this.value)) goTo(this.value); };

    el('moAdd').onclick = function () {
      var date = el('moDate').value;
      var amt = num(el('moAmt').value);
      if (!date) { setStatus('Give the expense a date.', true); el('moDate').focus(); return; }
      if (!amt) { setStatus('Give the expense an amount.', true); el('moAmt').focus(); return; }
      if (yearOf(date.slice(0, 7)) !== D.year) {
        setStatus('That date is in ' + date.slice(0, 4) + '. Switch to that year first.', true);
        return;
      }
      D.entries.unshift({
        id: uid('e'), date: date, amount: amt,
        category: el('moCat').value.trim(),
        venture: host.querySelector('.mo-add .mo-v').value,
        note: el('moNote').value.trim(),
      });
      D.entries.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
      save('entries');
      // Jump to the month the expense was actually dated in, so an entry never
      // disappears the moment it is added.
      if (date.slice(0, 7) !== month) month = date.slice(0, 7);
      renderMonth();
      paintTiles();
      var f = el('moAmt'); if (f) f.focus();
    };

    // Editing an expense.
    host.querySelectorAll('.mo-tbl tr[data-id]').forEach(function (tr) {
      var id = tr.getAttribute('data-id');
      var kind = tr.getAttribute('data-kind');

      if (!kind) {
        var e = D.entries.filter(function (x) { return x.id === id; })[0];
        if (!e) return;
        var reRender = false;
        tr.querySelector('.f-date').onchange = function () {
          if (yearOf(this.value.slice(0, 7)) !== D.year) {
            setStatus('That date is in another year. Switch year and add it there.', true);
            this.value = e.date;
            return;
          }
          e.date = this.value; save('entries'); renderMonth(); paintTiles();
        };
        tr.querySelector('.f-amt').onchange = function () {
          e.amount = num(this.value); this.value = e.amount; save('entries'); paintTiles();
        };
        tr.querySelector('.f-cat').onchange = function () {
          e.category = this.value.trim(); save('entries');
        };
        tr.querySelector('.f-ven').onchange = function () { e.venture = this.value; save('entries'); };
        tr.querySelector('.f-note').onchange = function () { e.note = this.value.trim(); save('entries'); };
        tr.querySelector('.mo-x').onclick = function () {
          if (!confirm('Delete this ' + rupees(e.amount) + ' expense? This cannot be undone.')) return;
          D.entries = D.entries.filter(function (x) { return x.id !== id; });
          years[D.year] = D.entries;
          save('entries'); renderMonth(); paintTiles();
        };
        return;
      }

      // A bill or an EMI: only the ticks.
      var list = kind === 'bill' ? D.bills : D.loans;
      var it = list.filter(function (x) { return x.id === id; })[0];
      if (!it) return;
      var paid = tr.querySelector('.f-paid');
      if (paid) paid.onchange = function () {
        toggle(it.paid, month, this.checked);
        save(kind === 'bill' ? 'bills' : 'loans');
      };
      var skip = tr.querySelector('.f-skip');
      if (skip) skip.onchange = function () {
        toggle(it.skip, month, this.checked);
        if (this.checked) toggle(it.paid, month, false);
        save('bills'); renderMonth(); paintTiles();
      };
    });
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
      '<p class="mo-caveat">These are the figures you enter. Nothing here is taken from a bank — check ' +
        'a statement before relying on it for a payment.</p>' +
      '<div class="mo-row"><button type="button" class="mo-btn" id="moAddLoan">Add a loan</button></div>' +
      statusBar() +
      (D.loans.length ? D.loans.map(loanCard).join('') : emptyNote('No loans added yet.'));

    bindLoans();
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

  function loanCard(l) {
    var n = nextDue(l);
    var done = l.months ? Math.min(100, Math.round(l.paid.length / l.months * 100)) : 0;
    var today = new Date().toISOString().slice(0, 10);
    return '<div class="mo-item" data-id="' + esc(l.id) + '">' +
      '<div class="mo-grid">' +
        '<label>Lender<input type="text" class="f-lender" value="' + esc(l.lender) + '" placeholder="Kerala Financial Corporation"></label>' +
        '<label>What for<input type="text" class="f-purpose" value="' + esc(l.purpose) + '" placeholder="Boat yard"></label>' +
        '<label>Venture' + ventureSelect(l.venture, 'f-ven') + '</label>' +
        '<label>Amount borrowed<input type="text" inputmode="decimal" class="f-principal" value="' + l.principal + '"></label>' +
        '<label>EMI a month<input type="text" inputmode="decimal" class="f-emi" value="' + l.emi + '"></label>' +
        '<label>Interest %<input type="text" inputmode="decimal" class="f-rate" value="' + l.rate + '"></label>' +
        '<label>First EMI month<input type="month" class="f-from" value="' + esc(l.from) + '"></label>' +
        '<label>How many EMIs<input type="number" min="0" max="600" class="f-months" value="' + (l.months || '') + '"></label>' +
        '<label>Due on day<input type="number" min="1" max="31" class="f-day" value="' + l.dueDay + '"></label>' +
      '</div>' +
      '<div class="mo-meter"><i style="width:' + done + '%"></i></div>' +
      '<p class="mo-facts">' +
        '<span><b>' + l.paid.length + '</b> of ' + (l.months || '—') + ' paid</span>' +
        '<span>Left to pay <b>' + rupees(left(l)) + '</b></span>' +
        '<span>Next due <b>' + (n ? prettyDate(n) : 'nothing outstanding') + '</b>' +
          (n && n < today ? ' <span class="mo-late">overdue</span>' : '') + '</span>' +
      '</p>' +
      '<div class="mo-row">' +
        '<button type="button" class="mo-btn mo-quiet f-pay">Mark next EMI paid</button>' +
        '<button type="button" class="mo-btn mo-quiet f-unpay">Undo last</button>' +
        '<button type="button" class="mo-x f-del">Delete this loan</button>' +
      '</div>' +
    '</div>';
  }

  function bindLoans() {
    var host = el('moLoans');
    el('moAddLoan').onclick = function () {
      D.loans.unshift({
        id: uid('l'), lender: '', purpose: '', principal: 0, emi: 0, rate: 0,
        dueDay: 5, from: thisMonth(), months: 0, venture: '', paid: [], note: '',
      });
      save('loans'); renderLoans();
    };

    host.querySelectorAll('.mo-item').forEach(function (box) {
      var id = box.getAttribute('data-id');
      var l = D.loans.filter(function (x) { return x.id === id; })[0];
      if (!l) return;
      function on(sel, fn, redraw) {
        var n = box.querySelector(sel);
        if (n) n.onchange = function () { fn.call(n); save('loans'); if (redraw) renderLoans(); paintTiles(); };
      }
      on('.f-lender', function () { l.lender = this.value.trim(); });
      on('.f-purpose', function () { l.purpose = this.value.trim(); });
      on('.f-ven', function () { l.venture = this.value; });
      on('.f-principal', function () { l.principal = num(this.value); this.value = l.principal; });
      on('.f-emi', function () { l.emi = num(this.value); this.value = l.emi; }, true);
      on('.f-rate', function () { var n = Number(this.value); l.rate = isFinite(n) && n >= 0 && n <= 100 ? n : 0; this.value = l.rate; });
      on('.f-from', function () { l.from = /^\d{4}-\d{2}$/.test(this.value) ? this.value : ''; }, true);
      on('.f-day', function () { l.dueDay = Math.min(31, Math.max(1, Number(this.value) || 1)); this.value = l.dueDay; }, true);
      on('.f-months', function () {
        var n = Math.max(0, Math.round(Number(this.value) || 0));
        // Fewer instalments than are already ticked paid would make "left to
        // pay" negative and the server would refuse the save anyway.
        if (n && n < l.paid.length) {
          setStatus(l.paid.length + ' EMIs are already marked paid, so there cannot be ' + n + '.', true);
          this.value = l.months || '';
          return;
        }
        l.months = n;
      }, true);

      box.querySelector('.f-pay').onclick = function () {
        var m = l.from ? shiftMonth(l.from, l.paid.length) : '';
        if (!m) { setStatus('Set the first EMI month before marking one paid.', true); return; }
        if (l.months && l.paid.length >= l.months) { setStatus('All the EMIs on this loan are paid.', true); return; }
        toggle(l.paid, m, true); save('loans'); renderLoans(); paintTiles();
      };
      box.querySelector('.f-unpay').onclick = function () {
        if (!l.paid.length) { setStatus('Nothing is marked paid on this loan yet.', true); return; }
        l.paid.pop(); save('loans'); renderLoans(); paintTiles();
      };
      box.querySelector('.f-del').onclick = function () {
        if (!confirm('Delete the ' + (l.lender || 'untitled') + ' loan and everything marked paid on it?')) return;
        D.loans = D.loans.filter(function (x) { return x.id !== id; });
        save('loans'); renderLoans(); paintTiles();
      };
    });
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
      '<p class="mo-caveat">A bill entered here counts in every month between its first and last, ' +
        'without being typed again. Leave the last month empty while it is still running.</p>' +
      '<div class="mo-row"><button type="button" class="mo-btn" id="moAddBill">Add a repeating bill</button></div>' +
      '<datalist id="moCats">' + catOptions() + '</datalist>' +
      statusBar() +
      (D.bills.length ? D.bills.map(billCard).join('') : emptyNote('No repeating bills yet.'));

    bindBills();
  }

  function billCard(b) {
    var now = thisMonth();
    var state = !b.from ? 'No start month set'
      : (b.to && now > b.to) ? 'Ended ' + monthName(b.to)
      : (now < b.from) ? 'Starts ' + monthName(b.from)
      : 'Running since ' + monthName(b.from);
    return '<div class="mo-item" data-id="' + esc(b.id) + '">' +
      '<div class="mo-grid">' +
        '<label>What is it<input type="text" class="f-name" value="' + esc(b.name) + '" placeholder="Shop rent"></label>' +
        '<label>Amount a month<input type="text" inputmode="decimal" class="f-amt" value="' + b.amount + '"></label>' +
        '<label>Category<input type="text" list="moCats" class="f-cat" value="' + esc(b.category) + '"></label>' +
        '<label>Venture' + ventureSelect(b.venture, 'f-ven') + '</label>' +
        '<label>Due on day<input type="number" min="1" max="31" class="f-day" value="' + b.dueDay + '"></label>' +
        '<label>First month<input type="month" class="f-from" value="' + esc(b.from) + '"></label>' +
        '<label>Last month<input type="month" class="f-to" value="' + esc(b.to) + '" placeholder="still running"></label>' +
      '</div>' +
      '<p class="mo-facts"><span>' + esc(state) + '</span>' +
        '<span><b>' + b.paid.length + '</b> months ticked paid</span>' +
        (b.skip.length ? '<span><b>' + b.skip.length + '</b> months skipped</span>' : '') + '</p>' +
      '<div class="mo-row"><button type="button" class="mo-x f-del">Delete this bill</button></div>' +
    '</div>';
  }

  function bindBills() {
    var host = el('moBills');
    el('moAddBill').onclick = function () {
      D.bills.unshift({
        id: uid('b'), name: '', amount: 0, category: '', venture: '',
        dueDay: 1, from: thisMonth(), to: '', paid: [], skip: [], note: '',
      });
      save('bills'); renderBills();
    };

    host.querySelectorAll('.mo-item').forEach(function (box) {
      var id = box.getAttribute('data-id');
      var b = D.bills.filter(function (x) { return x.id === id; })[0];
      if (!b) return;
      function on(sel, fn, redraw) {
        var n = box.querySelector(sel);
        if (n) n.onchange = function () { fn.call(n); save('bills'); if (redraw) renderBills(); paintTiles(); };
      }
      on('.f-name', function () { b.name = this.value.trim(); });
      on('.f-amt', function () { b.amount = num(this.value); this.value = b.amount; }, true);
      on('.f-cat', function () { b.category = this.value.trim(); });
      on('.f-ven', function () { b.venture = this.value; });
      on('.f-day', function () { b.dueDay = Math.min(31, Math.max(1, Number(this.value) || 1)); this.value = b.dueDay; });
      on('.f-from', function () { b.from = /^\d{4}-\d{2}$/.test(this.value) ? this.value : ''; }, true);
      on('.f-to', function () {
        var v = /^\d{4}-\d{2}$/.test(this.value) ? this.value : '';
        // A bill ending before it starts appears in no month at all, which
        // looks exactly like a bill that failed to save.
        if (v && b.from && v < b.from) {
          setStatus('That is before the bill starts (' + monthName(b.from) + ').', true);
          this.value = b.to;
          return;
        }
        b.to = v;
      }, true);
      box.querySelector('.f-del').onclick = function () {
        if (!confirm('Delete "' + (b.name || 'this bill') + '"? It will stop counting in every month.')) return;
        D.bills = D.bills.filter(function (x) { return x.id !== id; });
        save('bills'); renderBills(); paintTiles();
      };
    });
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

    '.mo-h{font-family:var(--font-heading);font-weight:800;font-size:16px;margin:30px 0 10px}' +
    '.mo-add{display:grid;grid-template-columns:150px 130px 1fr 1fr 1.4fr auto;gap:8px;align-items:center}' +
    '.mo-add input,.mo-add select{font:inherit;font-size:13px;padding:9px 11px;width:100%;' +
    '  border:2px solid var(--color-divider);background:var(--color-bg);color:var(--color-text)}' +
    '.mo-add input:focus,.mo-add select:focus{outline:none;border-color:var(--color-accent)}' +
    '.mo-btn{font:inherit;font-size:13px;font-weight:700;padding:10px 18px;cursor:pointer;white-space:nowrap;' +
    '  border:2px solid var(--color-accent);background:var(--color-accent);color:#fff}' +
    '.mo-btn:hover{background:var(--color-accent-700);border-color:var(--color-accent-700)}' +
    '.mo-quiet{background:none;color:var(--color-accent-700);border-color:var(--color-divider)}' +
    '.mo-quiet:hover{background:var(--color-accent-100);border-color:var(--color-accent);color:var(--color-accent-700)}' +
    '.mo-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:14px}' +

    '.scroll{overflow-x:auto}' +
    'table.mo-tbl{width:100%;border-collapse:collapse;min-width:44rem}' +
    'table.mo-tbl th,table.mo-tbl td{padding:8px 10px;border-bottom:1px solid var(--color-divider);' +
    '  text-align:left;font-size:13px;vertical-align:middle}' +
    'table.mo-tbl thead th{font-size:11px;letter-spacing:.09em;text-transform:uppercase;' +
    '  color:var(--color-neutral-700);font-weight:700}' +
    'table.mo-tbl td.r{text-align:right}' +
    'table.mo-tbl input[type=text],table.mo-tbl input[type=date],table.mo-tbl select{' +
    '  font:inherit;font-size:13px;padding:6px 8px;width:100%;' +
    '  border:1px solid var(--color-divider);background:var(--color-bg);color:var(--color-text)}' +
    'table.mo-tbl input:focus,table.mo-tbl select:focus{outline:none;border-color:var(--color-accent)}' +
    '.mo-sub{font-size:11.5px;color:var(--color-neutral-700)}' +
    '.mo-skipped{opacity:.5}' +
    '.mo-late{font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;' +
    '  color:var(--color-accent-700);background:var(--color-accent-100);padding:1px 6px}' +
    '.mo-tick{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;white-space:nowrap}' +
    '.mo-x{font:inherit;font-size:12px;font-weight:600;padding:5px 11px;cursor:pointer;' +
    '  border:2px solid var(--color-divider);background:none;color:var(--color-accent-700)}' +
    '.mo-x:hover{border-color:var(--color-accent);background:var(--color-accent-100)}' +

    '.mo-split{margin-top:6px}' +
    '.mo-srow{display:grid;grid-template-columns:minmax(110px,1.1fr) 2fr 110px 44px;gap:12px;' +
    '  align-items:center;padding:7px 0;border-bottom:1px solid var(--color-divider);font-size:13px}' +
    '.mo-srow .b{height:9px;background:var(--color-surface);border:1px solid var(--color-divider)}' +
    '.mo-srow .b i{display:block;height:100%;background:var(--color-accent);opacity:.75}' +
    '.mo-srow .v{text-align:right;font-weight:700}' +
    '.mo-srow .p{text-align:right;color:var(--color-neutral-700);font-size:12px}' +

    '.mo-item{border:2px solid var(--color-divider);padding:16px 18px;margin-top:14px;background:var(--color-bg)}' +
    '.mo-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px 14px}' +
    '.mo-grid label{display:block;font-size:11px;font-weight:700;letter-spacing:.06em;' +
    '  text-transform:uppercase;color:var(--color-neutral-700)}' +
    '.mo-grid input,.mo-grid select{display:block;font:inherit;font-size:13px;padding:8px 10px;width:100%;' +
    '  margin-top:5px;text-transform:none;letter-spacing:0;font-weight:400;color:var(--color-text);' +
    '  border:2px solid var(--color-divider);background:var(--color-bg)}' +
    '.mo-grid input:focus,.mo-grid select:focus{outline:none;border-color:var(--color-accent)}' +
    '.mo-meter{height:7px;background:var(--color-surface);border:1px solid var(--color-divider);margin:14px 0 10px}' +
    '.mo-meter i{display:block;height:100%;background:var(--color-accent)}' +
    '.mo-facts{display:flex;flex-wrap:wrap;gap:6px 22px;margin:0;font-size:12.5px;color:var(--color-neutral-800)}' +
    '.mo-facts b{font-family:var(--font-heading);font-weight:800}' +

    '.mo-status{font-size:12.5px;color:var(--color-neutral-700);margin:12px 0 0;min-height:1.2em}' +
    '.mo-empty{font-size:13px;color:var(--color-neutral-700);border:2px dashed var(--color-divider);' +
    '  padding:18px 16px;margin:6px 0 0}' +
    '.mo-caveat{font-size:12.5px;color:var(--color-neutral-700);max-width:62ch;margin:14px 0 0}' +

    '@media(max-width:860px){' +
    '  .mo-add{grid-template-columns:1fr 1fr}' +
    '  .mo-add .mo-btn{grid-column:1/-1}' +
    '  .mo-srow{grid-template-columns:1fr 92px 40px}' +
    '  .mo-srow .b{display:none}' +
    '}' +
    // iOS zooms the page in when a field under 16px is focused, and never
    // zooms back out. Every field on these pages is a number or a date, which
    // is exactly when that is most disruptive.
    '@media(max-width:700px){' +
    '  .mo-add input,.mo-add select,.mo-grid input,.mo-grid select,' +
    '  table.mo-tbl input,table.mo-tbl select,.mo-bar input[type=month]{font-size:16px}' +
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
      rupees: rupees, monthDiff: monthDiff,
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
