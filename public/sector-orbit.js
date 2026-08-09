// Small circular orbit of the twelve ventures, for the marine-sector section.
//
// Twelve circles sit on a dashed ring with a red dot between each pair. The
// ring rotates so that one venture is always at the top, named in the middle.
// Scrolling the mouse wheel over it turns the ring one venture per gesture;
// clicking a circle opens that venture's page.
//
// Reads window.KMS_VENTURES (ventures-data.js) so the ring, the homepage cards
// and the venture pages can never disagree about what the twelve ventures are.
(function () {
  'use strict';

  var R = 142;              // ring radius
  var DOT = 50;             // circle diameter
  var DOT_ACTIVE = 64;
  var BOX = (R + DOT_ACTIVE / 2 + 6) * 2;   // square the ring needs
  var WHEEL_COOLDOWN = 320; // one venture per wheel gesture, not per tick
  var SPIN_MS = 620;

  var ICONS = {
    cart:   '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.5 3h2l2.7 13a2 2 0 0 0 2 1.6h9a2 2 0 0 0 2-1.6L20 8H6"/>',
    gear:   '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4L5.3 5.3"/>',
    calc:   '<rect x="5" y="2.5" width="14" height="19" rx="2"/><rect x="8" y="5.5" width="8" height="3.5"/><path d="M8.5 13h.01M12 13h.01M15.5 13h.01M8.5 17h.01M12 17h.01M15.5 17h.01"/>',
    crane:  '<path d="M3 16l1.6-4.5h14.8L21 16z"/><path d="M3 16q4.5 2.6 9 0t9 0"/><path d="M7 11.5V4h9M16 4l3.5 3"/>',
    fuel:   '<rect x="4" y="4" width="10" height="17" rx="1.5"/><rect x="6.5" y="6.5" width="5" height="4"/><path d="M14 10h4l2 3v6a2 2 0 0 1-4 0v-6"/><path d="M2.5 21h13"/>',
    ship:   '<path d="M3.5 16.5l1.7-5h13.6l1.7 5z"/><path d="M3.5 16.5q4.5 2.8 9 0t9 0"/><path d="M12 11.5V4l4 3z"/>',
    hook:   '<path d="M12 3v9"/><path d="M12 12c-3 0-5 1.8-5 4.2A3.8 3.8 0 0 0 15 17"/><circle cx="12" cy="3" r="1.4"/><path d="M9 6h6"/>',
    fish:   '<path d="M3 12q5-6 10.5-6T21 12q-2 6-7.5 6T3 12z"/><circle cx="16" cy="10.5" r="1" fill="currentColor" stroke="none"/><path d="M3 12L1 9M3 12l-2 3"/>',
    wrench: '<path d="M15.5 6.5a4.5 4.5 0 1 0 3.6 7.2L21 16l-3 3-2.3-2.3A4.5 4.5 0 0 0 15.5 6.5z"/><path d="M9.5 10L4 15.5 6.5 18 12 12.5"/>',
    prop:   '<circle cx="12" cy="12" r="2.4"/><path d="M12 9.6q-1.5-6 3.5-7.1 1.6 5.3-3.5 7.1zm0 4.8q1.5 6-3.5 7.1-1.6-5.3 3.5-7.1zm2.4 0q6 1.5 7.1-3.5-5.3-1.6-7.1 3.5zm-4.8 0Q3.6 15.9 2.5 10.9q5.3-1.6 7.1 3.5z"/>',
    truck:  '<rect x="2" y="7" width="12" height="10" rx="1"/><path d="M14 10h4l3.5 3.5V17H14z"/><circle cx="7" cy="19.5" r="1.6"/><circle cx="17.5" cy="19.5" r="1.6"/><path d="M6 10v4M4 12h4"/>',
    export: '<rect x="3" y="8" width="12" height="11" rx="1"/><path d="M3 12h12M8 8V5.5h5V8"/><path d="M17.5 12.5a5 5 0 1 1-3.5 8.2"/><path d="M17.5 15v3h3"/>',
  };

  var V = window.KMS_VENTURES || [];
  if (!V.length) return;
  var N = V.length;
  var STEP = 360 / N;
  var active = 0;

  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }
  function mod(n, m) { return ((n % m) + m) % m; }

  var host = document.getElementById('sector-orbit');
  if (!host) return;

  var CSS =
    // .so-fit is the element that occupies layout space; .so-wrap keeps its
    // true 360px geometry and is scaled down inside it. Scaling alone would
    // not help — a transform doesn't change the box the page reserves — so
    // .so-fit's height is set to the scaled height in JS.
    '.so-fit{width:100%;max-width:' + BOX + 'px;margin:0 auto;position:relative}' +
    '.so-wrap{position:relative;width:' + BOX + 'px;height:' + BOX + 'px;' +
    // pan-y, not none: a finger dragged up or down must still scroll the page.
    // Anything else turns this into a 360px-tall dead zone the reader can get
    // stuck in halfway down the homepage.
    '  touch-action:pan-y;user-select:none;transform-origin:top left}' +
    '.so-ring{position:absolute;inset:0;border-radius:50%;' +
    '  border:1px dashed var(--color-neutral-500,#a09b95);' +
    '  margin:' + (DOT_ACTIVE / 2 + 6) + 'px;opacity:.55}' +
    '.so-disc{position:absolute;inset:0;border-radius:50%;margin:' + (DOT_ACTIVE / 2 + 18) + 'px;' +
    '  background:radial-gradient(circle at 50% 45%,rgba(236,48,19,.045),rgba(236,48,19,0) 70%)}' +
    // One rotating layer holds every circle and dot; each circle is
    // counter-rotated by the same angle so the icons stay upright while the
    // ring turns underneath them.
    '.so-spin{position:absolute;inset:0;transition:transform ' + SPIN_MS + 'ms cubic-bezier(.33,.9,.25,1)}' +
    '.so-item{position:absolute;left:50%;top:50%;width:' + DOT + 'px;height:' + DOT + 'px;margin:' +
    '  ' + (-DOT / 2) + 'px 0 0 ' + (-DOT / 2) + 'px;border-radius:50%;background:#fff;border:none;padding:0;' +
    '  display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--color-accent,#ec3013);' +
    '  box-shadow:0 2px 8px rgba(32,30,29,.09),0 0 0 1px rgba(32,30,29,.07);' +
    '  transition:width ' + SPIN_MS + 'ms,height ' + SPIN_MS + 'ms,margin ' + SPIN_MS + 'ms,box-shadow .22s}' +
    '.so-item:hover{box-shadow:0 4px 14px rgba(32,30,29,.16),0 0 0 1px var(--color-accent,#ec3013)}' +
    '.so-item svg{width:24px;height:24px}' +
    '.so-item.on{width:' + DOT_ACTIVE + 'px;height:' + DOT_ACTIVE + 'px;margin:' +
    '  ' + (-DOT_ACTIVE / 2) + 'px 0 0 ' + (-DOT_ACTIVE / 2) + 'px;' +
    '  box-shadow:0 0 0 2px var(--color-accent,#ec3013),0 0 0 6px rgba(236,48,19,.12),0 6px 16px rgba(236,48,19,.20)}' +
    '.so-item.on svg{width:30px;height:30px}' +
    '.so-item:focus-visible{outline:2px solid var(--color-accent,#ec3013);outline-offset:3px}' +
    '.so-pip{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;' +
    '  background:var(--color-accent,#ec3013);opacity:.85}' +
    // Centre label: the ring is decorative without it — this is what tells you
    // which venture you are looking at.
    '.so-mid{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:' + (R * 1.25) + 'px;' +
    '  text-align:center}' +
    '.so-open{display:block;background:none;border:none;padding:0;font:inherit;color:inherit;cursor:pointer;' +
    '  width:100%}' +
    '.so-open:hover .so-name{color:var(--color-accent,#ec3013)}' +
    '.so-open:focus-visible{outline:2px solid var(--color-accent,#ec3013);outline-offset:6px}' +
    '.so-wave{color:var(--color-accent,#ec3013);font-size:20px;line-height:1;font-weight:700;opacity:.55}' +
    '.so-num{font-family:var(--font-heading,inherit);font-weight:800;font-size:11px;letter-spacing:.12em;' +
    '  color:var(--color-accent,#ec3013);margin-top:12px}' +
    '.so-name{font-family:var(--font-heading,inherit);font-weight:800;font-size:16px;line-height:1.2;' +
    '  letter-spacing:-0.015em;margin-top:5px;color:var(--color-text,#201e1d)}' +
    '.so-status{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;' +
    '  color:var(--color-neutral-500,#a09b95);margin-top:6px}' +
    '.so-hint{font-size:10px;letter-spacing:.12em;text-transform:uppercase;' +
    '  color:var(--color-neutral-500,#a09b95);margin-top:14px;white-space:nowrap;opacity:.9}' +
    '@media (prefers-reduced-motion:reduce){.so-spin,.so-item{transition:none !important}}';

  var style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  var fit = document.createElement('div');
  fit.className = 'so-fit';
  var wrap = document.createElement('div');
  wrap.className = 'so-wrap';
  wrap.innerHTML = '<div class="so-disc"></div><div class="so-ring"></div><div class="so-spin"></div>' +
    '<div class="so-mid"><button type="button" class="so-open">' +
    '<div class="so-wave">≈</div><div class="so-num"></div><div class="so-name"></div>' +
    '<div class="so-status"></div></button>' +
    '<div class="so-hint"></div></div>';
  fit.appendChild(wrap);
  host.appendChild(fit);

  // A phone has no wheel, so the desktop hint would be a lie there.
  var coarse = false;
  try { coarse = window.matchMedia('(pointer: coarse)').matches; } catch (e) {}
  wrap.querySelector('.so-hint').textContent =
    coarse ? 'Swipe sideways · tap to open' : 'Scroll · click to open';

  // Shrink to whatever width the column actually has, and reserve exactly the
  // height the shrunken ring occupies.
  function resize() {
    var avail = fit.clientWidth;
    if (!avail) return;
    var s = Math.min(1, avail / BOX);
    wrap.style.transform = s < 1 ? 'scale(' + s.toFixed(4) + ')' : 'none';
    fit.style.height = Math.round(BOX * s) + 'px';
  }
  resize();
  if (window.ResizeObserver) new ResizeObserver(resize).observe(fit);
  else window.addEventListener('resize', resize);

  var spin = wrap.querySelector('.so-spin');
  var midNum = wrap.querySelector('.so-num');
  var midName = wrap.querySelector('.so-name');
  var midStatus = wrap.querySelector('.so-status');
  var items = [];

  wrap.querySelector('.so-open').addEventListener('click', function () {
    location.href = 'venture.html?v=' + V[active].slug;
  });

  V.forEach(function (v, i) {
    // -90deg puts index 0 at the top of the ring.
    var a = (i * STEP - 90) * Math.PI / 180;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'so-item';
    b.setAttribute('aria-label', v.num + ' — ' + v.name);
    b.style.transform = 'translate(' + (Math.cos(a) * R).toFixed(1) + 'px,' + (Math.sin(a) * R).toFixed(1) + 'px)';
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round">' + (ICONS[v.icon] || '') + '</svg>';
    // A click opens that venture straight away. Turning the ring is what the
    // wheel, the arrow keys and dragging are for, so a click never needs to
    // mean "bring this one round first".
    b.addEventListener('click', function () {
      location.href = 'venture.html?v=' + v.slug;
    });
    // Hovering brings a venture to the top and names it in the middle, so you
    // can see what an icon is before committing to the click.
    b.addEventListener('pointerenter', function () { if (i !== active) go(i); });
    b.addEventListener('focus', function () { if (i !== active) go(i); });
    spin.appendChild(b);
    items.push(b);

    // Marker dot halfway to the next venture.
    var da = ((i + 0.5) * STEP - 90) * Math.PI / 180;
    var pip = document.createElement('span');
    pip.className = 'so-pip';
    pip.style.transform = 'translate(' + (Math.cos(da) * R).toFixed(1) + 'px,' + (Math.sin(da) * R).toFixed(1) + 'px)';
    spin.appendChild(pip);
  });

  // Turns accumulate rather than wrapping at 360, so going from the last
  // venture to the first keeps rotating forward instead of unwinding the
  // whole ring backwards.
  var turn = 0;

  function render() {
    spin.style.transform = 'rotate(' + (-turn * STEP) + 'deg)';
    items.forEach(function (el, i) {
      var on = i === active;
      el.classList.toggle('on', on);
      el.tabIndex = on ? 0 : -1;
      el.setAttribute('aria-current', on ? 'true' : 'false');
      // Undo the ring's rotation so icons stay upright.
      var a = (i * STEP - 90) * Math.PI / 180;
      el.style.transform =
        'translate(' + (Math.cos(a) * R).toFixed(1) + 'px,' + (Math.sin(a) * R).toFixed(1) + 'px) ' +
        'rotate(' + (turn * STEP) + 'deg)';
    });
    var v = V[active];
    midNum.textContent = v.num;
    midName.textContent = v.name.replace(/^Shalom /, '');
    midStatus.textContent = v.status;
  }

  function go(i) { turn += i - active; active = mod(i, N); render(); }
  function step(d) { turn += d; active = mod(active + d, N); render(); }

  var lastWheel = 0;
  wrap.addEventListener('wheel', function (e) {
    // Scoped to this element only — the page scrolls normally everywhere else.
    e.preventDefault();
    var now = Date.now();
    if (now - lastWheel < WHEEL_COOLDOWN) return;
    lastWheel = now;
    step(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  wrap.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); step(1); items[active].focus(); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); step(-1); items[active].focus(); }
  });

  // Touch: a SIDEWAYS swipe turns the ring. Up and down are left alone so the
  // page keeps scrolling normally through this section — the ring must never
  // trap a reader's thumb.
  var startX = null, startY = null, axis = null;
  wrap.addEventListener('pointerdown', function (e) {
    startX = e.clientX; startY = e.clientY; axis = null;
  });
  wrap.addEventListener('pointermove', function (e) {
    if (startX === null) return;
    var dx = e.clientX - startX, dy = e.clientY - startY;
    // Decide once which way this gesture is going, then stick with it.
    if (!axis && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (axis !== 'x') return;
    if (Math.abs(dx) >= 46) { step(dx < 0 ? 1 : -1); startX = e.clientX; }
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) {
    wrap.addEventListener(t, function () { startX = null; startY = null; axis = null; });
  });

  render();
})();
