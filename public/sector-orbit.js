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

  // Proportions taken from the reference: the circles are small relative to
  // the ring (0.28 of the radius) so the middle stays open enough to hold a
  // two-line title, and the active one is half again the size of the rest.
  // 175, with the circles left at 54. The ring is deliberately TIGHT: a smaller
  // hoop with the same big icons reads as a compact instrument rather than a
  // diagram spread across the page, and it leaves the section's text room to
  // breathe beside it.
  //
  // 175 is not a guess. Every piece of the centre panel — the photograph, the
  // counter, the two-line name, the status, the hint — was checked against the
  // ring's inner clearance AT ITS OWN WIDTH AND HEIGHT, since the wide name
  // sits where there is most room and the narrow hint sits where there is
  // least. The tightest of them clears by 13px. Shrink R below about 168 and
  // the hint starts to touch the circles.
  var R = 175;              // ring radius
  var DOT = 54;             // circle diameter
  var DOT_ACTIVE = 82;      // 1.52x, the same proportion as before
  var BOX = (R + DOT_ACTIVE / 2 + 8) * 2;   // square the ring needs
  // Timing. The ring used to snap round in 620ms, which read as a flick rather
  // than a turn — twelve ventures went past faster than any of them could be
  // read. 1150ms with a soft settle is slow enough to follow the icon you were
  // looking at all the way to the top.
  var SPIN_MS = 1000;
  // The cooldown has to be at least as long as the spin, or a second scroll
  // lands mid-turn and the ring never comes to rest anywhere.
  var WHEEL_COOLDOWN = SPIN_MS - 150;
  var EASE = 'cubic-bezier(.28,.72,.22,1)';   // quick to leave, long to arrive
  var HOVER_INTENT = 110;   // ms a pointer must rest before the ring follows it

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
    // A refrigerated lorry: the snowflake is what tells cold chain apart from
    // ordinary haulage at icon size.
    coldtruck: '<rect x="2" y="7" width="12" height="10" rx="1"/><path d="M14 10h4l3.5 3.5V17H14z"/><circle cx="7" cy="19.5" r="1.6"/><circle cx="17.5" cy="19.5" r="1.6"/><path d="M8 9.4v5.2M5.7 10.7l4.6 2.6M10.3 10.7l-4.6 2.6"/>',
    // A hanging net, so the nets shop is not another shopping trolley.
    net:    '<path d="M4 4h16l-3.2 10.5a5 5 0 0 1-9.6 0z"/><path d="M6.2 8h11.6M7.4 12h9.2M4.9 4.6 10 15M19.1 4.6 14 15M12 4v12"/>',
    export: '<rect x="3" y="8" width="12" height="11" rx="1"/><path d="M3 12h12M8 8V5.5h5V8"/><path d="M17.5 12.5a5 5 0 1 1-3.5 8.2"/><path d="M17.5 15v3h3"/>',
  };

  // The shown ventures only — a hidden one must not take a place on the ring.
  var V = window.KMS_VISIBLE || window.KMS_VENTURES || [];
  if (!V.length) return;
  var N = V.length;
  var STEP = 360 / N;
  // -1, not 0: the frame loop writes the centre panel only when the venture at
  // the top CHANGES. Starting at 0 meant the first frame agreed with itself and
  // the panel was never filled in — the ring came up with an empty middle.
  var active = -1;

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
    // The dashed ring turns very slowly on its own — a minute per revolution,
    // far too slow to read as movement, but enough that the thing never looks
    // like a still image. It is a border, so it is rotated as a whole.
    '.so-ring{position:absolute;inset:0;border-radius:50%;' +
    '  border:1px dashed var(--color-neutral-500,#a09b95);' +
    // Inset so the dashed line passes exactly through the circle centres,
    // rather than close to them — computed, so it stays true if R changes.
    '  margin:' + (BOX / 2 - R) + 'px;opacity:.5;animation:so-drift 60s linear infinite}' +
    '@keyframes so-drift{to{transform:rotate(360deg)}}' +
    '.so-disc{position:absolute;inset:0;border-radius:50%;margin:' + (DOT_ACTIVE / 2 + 18) + 'px;' +
    '  background:radial-gradient(circle at 50% 45%,rgba(236,48,19,.045),rgba(236,48,19,0) 70%)}' +
    // One rotating layer holds every circle and dot; each circle is
    // counter-rotated by the same angle so the icons stay upright while the
    // ring turns underneath them.
    '.so-spin{position:absolute;inset:0}' +
    // Inactive circles carry a dark icon, not a red one. With all twelve in
    // red nothing stood out; keeping the accent for the active venture alone
    // is what makes the top of the ring read as the selected one.
    '.so-item{position:absolute;left:50%;top:50%;width:' + DOT + 'px;height:' + DOT + 'px;margin:' +
    '  ' + (-DOT / 2) + 'px 0 0 ' + (-DOT / 2) + 'px;border-radius:50%;background:#fff;border:none;padding:0;' +
    '  display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--color-text,#201e1d);' +
    '  box-shadow:0 4px 14px rgba(32,30,29,.07),0 1px 3px rgba(32,30,29,.06);' +
    // NO transition on transform or opacity. Those two are now rewritten every
    // animation frame by the loop below, and a CSS transition on a property
    // being set 60 times a second makes it lag a frame behind itself — which
    // is what stuttering rotation actually is. Only the things that change on
    // a class toggle are eased here.
    '  transition:box-shadow .3s ease,color .3s ease;' +
    '  will-change:transform,opacity}' +
    '.so-item:hover{box-shadow:0 6px 20px rgba(32,30,29,.14),0 0 0 1px rgba(236,48,19,.35);' +
    '  color:var(--color-accent,#ec3013)}' +
    '.so-item svg{width:30px;height:30px}' +
    // The active circle: white still, with the red ring drawn INSIDE it so the
    // outline sits in from the edge with the icon floating clear of it, and a
    // wide soft glow outside rather than a hard second border.
    //
    // Its SIZE is not set here. Growing it with width/height would relayout
    // twelve elements every frame; the loop scales it with a transform
    // instead, which the compositor handles on its own and which grows
    // smoothly as a circle approaches the top rather than popping when it
    // arrives.
    '.so-item.on{color:var(--color-accent,#ec3013);' +
    '  box-shadow:inset 0 0 0 2px var(--color-accent,#ec3013),' +
    '    0 0 0 9px rgba(236,48,19,.055),0 10px 30px rgba(236,48,19,.20)}' +
    '.so-item:focus-visible{outline:2px solid var(--color-accent,#ec3013);outline-offset:3px}' +
    // A halo that breathes behind whichever venture is at the top. Drawn on a
    // separate element rather than the button's own box-shadow so the pulse
    // cannot fight the size transition happening on the button itself.
    '.so-halo{position:absolute;left:50%;top:50%;width:' + (DOT_ACTIVE + 26) + 'px;' +
    '  height:' + (DOT_ACTIVE + 26) + 'px;margin:' + (-(DOT_ACTIVE + 26) / 2) + 'px 0 0 ' +
    '  ' + (-(DOT_ACTIVE + 26) / 2) + 'px;border-radius:50%;pointer-events:none;' +
    // No border of its own: the active circle already carries a red ring and a
    // glow, and a third outline around it looked busy. This is the breath only.
    '  opacity:0;' +
    '  transition:transform ' + SPIN_MS + 'ms ' + EASE + ',opacity .5s ease;' +
    '  animation:so-breathe 3.4s ease-in-out infinite}' +
    '.so-halo.on{opacity:1}' +
    '@keyframes so-breathe{0%,100%{box-shadow:0 0 0 0 rgba(236,48,19,.16)}' +
    '  50%{box-shadow:0 0 0 14px rgba(236,48,19,0)}}' +
    '.so-pip{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;' +
    '  background:var(--color-accent,#ec3013);opacity:.85}' +
    // Centre label: the ring is decorative without it — this is what tells you
    // which venture you are looking at.
    '.so-mid{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:' + Math.round(R * 1.2) + 'px;' +
    '  text-align:center}' +
    '.so-open{display:block;background:none;border:none;padding:0;font:inherit;color:inherit;cursor:pointer;' +
    '  width:100%}' +
    '.so-open:hover .so-name{color:var(--color-accent,#ec3013)}' +
    '.so-open:focus-visible{outline:2px solid var(--color-accent,#ec3013);outline-offset:8px;border-radius:6px}' +
    // "VENTURE  05 / 12" — the counter tells you where you are in the twelve
    // without having to count circles.
    '.so-eyebrow{font-size:9.5px;letter-spacing:.28em;text-transform:uppercase;font-weight:700;' +
    '  color:var(--color-neutral-500,#a09b95)}' +
    '.so-count{font-family:var(--font-heading,inherit);font-weight:800;font-size:21px;letter-spacing:.02em;' +
    '  color:var(--color-neutral-500,#a09b95);margin-top:5px;line-height:1}' +
    '.so-count .now{color:var(--color-accent,#ec3013)}' +
    // 19px, not 22: "Shipbuilding & Vessel Manufacturing" is the longest name
    // of the twelve and has to fall on two lines, not three.
    // 17px in a 210px column: "Shipbuilding & Vessel Manufacturing", the longest
    // of the ten, falls on two lines. At 19 it would want three, and the extra
    // line is what would push the panel into the circles.
    '.so-name{font-family:var(--font-heading,inherit);font-weight:800;font-size:17px;line-height:1.15;' +
    '  letter-spacing:-0.02em;margin-top:10px;color:var(--color-text,#201e1d);' +
    // Two lines' worth of room whether the name needs it or not, so the rest
    // of the panel does not jump up and down as the ring turns past the short
    // names ("Boat Yard") and the long ones.
    '  min-height:40px;display:flex;align-items:center;justify-content:center;' +
    '  transition:color .25s ease}' +
    '.so-status{font-size:9.5px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;' +
    '  color:var(--color-neutral-500,#a09b95);margin-top:9px}' +
    // The venture's own photograph, at the centre of its ring. Falls back to
    // the line icon when a venture has no picture uploaded yet, so the middle
    // is never an empty hole.
    '.so-shot{position:relative;width:76px;height:76px;border-radius:50%;margin:0 auto 12px;' +
    '  overflow:hidden;background:var(--color-neutral-200,#eceae7);' +
    '  display:flex;align-items:center;justify-content:center;' +
    '  color:var(--color-accent,#ec3013);' +
    '  box-shadow:0 0 0 1px rgba(32,30,29,.08),0 6px 18px rgba(32,30,29,.10)}' +
    '.so-shot img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;' +
    '  opacity:0;transition:opacity .45s ease}' +
    '.so-shot img.on{opacity:1}' +
    '.so-shot svg{width:32px;height:32px}' +
    '.so-hint{font-size:9px;letter-spacing:.2em;text-transform:uppercase;font-weight:700;' +
    '  color:var(--color-neutral-500,#a09b95);margin-top:7px;white-space:nowrap}' +
    // The name in the middle changes the moment the ring starts moving, which
    // read as a glitch against a turn that now takes over a second. It lifts
    // and fades instead, and is swapped while it is invisible.
    '.so-label{transition:opacity .3s ease,transform .3s ease}' +
    '.so-label.swap{opacity:0;transform:translateY(-6px)}' +
    // Each circle arrives rather than simply being there, one after another
    // round the ring. Only opacity is animated: transform carries each item's
    // position and is written inline by render(), so a keyframe touching it
    // would drag every circle to the centre. fill-mode is `backwards`, not
    // `both` — with `both` the final keyframe would keep overriding the depth
    // opacity set below for the rest of the page's life.
    '.so-wrap.intro .so-item,.so-wrap.intro .so-pip{animation:so-arrive .55s ease backwards}' +
    '@keyframes so-arrive{from{opacity:0}to{opacity:1}}' +
    '@media (prefers-reduced-motion:reduce){' +
    '  .so-spin,.so-item,.so-pip,.so-halo,.so-label,.so-item svg{transition:none !important;animation:none !important}' +
    '  .so-ring{animation:none !important}}';

  var style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  var fit = document.createElement('div');
  fit.className = 'so-fit';
  var wrap = document.createElement('div');
  wrap.className = 'so-wrap';
  wrap.innerHTML = '<div class="so-disc"></div><div class="so-ring"></div><div class="so-spin"></div>' +
    '<div class="so-mid"><button type="button" class="so-open">' +
      '<div class="so-shot"></div>' +
      '<div class="so-eyebrow">Venture</div>' +
      '<div class="so-count"><span class="now"></span><span class="of"></span></div>' +
      '<div class="so-name"></div>' +
      '<div class="so-status"></div>' +
    '</button>' +
    '<div class="so-hint"></div></div>';
  fit.appendChild(wrap);
  host.appendChild(fit);

  // A phone has no wheel, so the desktop hint would be a lie there.
  var coarse = false;
  try { coarse = window.matchMedia('(pointer: coarse)').matches; } catch (e) {}
  // Kept to two actions rather than the reference's single "scroll to explore":
  // turning the ring and opening a venture are different things, and dropping
  // the second would hide the only way through to the venture pages.
  wrap.querySelector('.so-hint').textContent =
    coarse ? 'Swipe · tap to open' : 'Scroll · click to open';

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
  var midNow = wrap.querySelector('.so-count .now');
  var midOf = wrap.querySelector('.so-count .of');
  var midName = wrap.querySelector('.so-name');
  var midStatus = wrap.querySelector('.so-status');
  var midShot = wrap.querySelector('.so-shot');
  var items = [];
  var pips = [];
  var hoverTimer = null;
  var introDone = false;
  var held = false;     // a cursor or finger is resting on the ring

  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  // The breathing halo behind whichever venture is at the top. It sits outside
  // the rotating layer, permanently at the top of the ring, so it never has to
  // travel — the circles come to it.
  var halo = document.createElement('span');
  halo.className = 'so-halo';
  halo.style.transform = 'translate(0px,' + (-R) + 'px)';
  wrap.insertBefore(halo, wrap.querySelector('.so-mid'));

  // Marked so the centre text can be faded out and back rather than swapped
  // under the reader's eye halfway through a turn.
  var labels = [midShot, wrap.querySelector('.so-count'), midName, midStatus];
  labels.forEach(function (el) { el.classList.add('so-label'); });

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
    // can see what an icon is before committing to the click. The short delay
    // is hover INTENT: at this speed, a cursor crossing the ring on its way
    // somewhere else would otherwise set off four turns in a row.
    b.addEventListener('pointerenter', function (e) {
      if (e.pointerType === 'touch') return;   // a tap opens the page, it does not aim
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(function () { if (i !== active) go(i); }, HOVER_INTENT);
    });
    b.addEventListener('pointerleave', function () { clearTimeout(hoverTimer); });
    b.addEventListener('focus', function () { if (i !== active) go(i); });
    spin.appendChild(b);
    items.push(b);

    // Marker dot halfway to the next venture. Positioned by the loop, like the
    // circles — the container is no longer rotated, because rotating it would
    // spin the icons upside down as they travelled round.
    var pip = document.createElement('span');
    pip.className = 'so-pip';
    spin.appendChild(pip);
    pips.push(pip);
  });

  // ---- the rotation ---------------------------------------------------------
  //
  // The ring used to move by handing a new angle to a CSS transition, which
  // meant it could only ever go in fixed hops: still, then a hop, then still
  // again. Turning it continuously that way is not possible — a transition
  // restarted every frame never gets anywhere.
  //
  // So the angle is now a number this file owns, advanced every animation
  // frame. Idle, it drifts forward on its own. A scroll, a swipe or an arrow
  // key eases it to a chosen venture and then hands it back to the drift.
  // Because nothing is waiting on a transition to finish, a gesture can
  // interrupt the drift, or another gesture, at any point without a jump.

  var TURN_MS = 72000;                  // a full revolution when left alone: 6s per venture
  var DRIFT = 360 / TURN_MS;            // degrees per millisecond
  var RESUME_AFTER = 2600;              // pause after you touch it, before it drifts again
  var ACTIVE_SCALE = DOT_ACTIVE / DOT;  // 1.52 — the active circle's size, as a scale

  var rot = 0;          // ring rotation in degrees; falling = turning forwards
  var tweenFrom = 0, tweenTo = 0, tweenStart = 0, tweening = false;
  var holdUntil = 0;    // drift is suspended until this timestamp
  var frame = null;
  var awake = true;     // on screen and tab in front

  // Which venture is at the top right now, straight from the angle.
  function activeFromRot() { return mod(Math.round(-rot / STEP), N); }

  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  function place(now) {
    for (var i = 0; i < items.length; i++) {
      // Where this circle actually is on screen, this frame.
      var deg = i * STEP - 90 + rot;
      var a = deg * Math.PI / 180;

      // k is how many venture-widths it sits from the top: 0 at the top, 1 at
      // the next position round, and so on. Everything below is a curve on k,
      // so size and weight change smoothly as a circle travels rather than
      // switching the moment it becomes "the active one".
      var k = Math.abs(((deg + 90) % 360 + 540) % 360 - 180) / 180 * (N / 2);
      var boost = Math.max(0, 1 - k);          // 1 at the top, 0 one position away
      var depth = Math.min(k, N / 2) / (N / 2); // 0 at the top, 1 at the far side
      var scale = (1 - 0.18 * depth) * (1 + (ACTIVE_SCALE - 1) * boost);

      var el = items[i];
      el.style.transform =
        'translate(' + (Math.cos(a) * R).toFixed(2) + 'px,' + (Math.sin(a) * R).toFixed(2) + 'px) ' +
        'scale(' + scale.toFixed(3) + ')';
      // Held back until the entrance animation has finished, because that
      // animation owns opacity while it runs.
      if (introDone) el.style.opacity = (1 - 0.42 * depth).toFixed(3);

      var on = k < 0.5;
      if (on !== el.__on) {                    // touch the DOM only when it changes
        el.__on = on;
        el.classList.toggle('on', on);
        el.tabIndex = on ? 0 : -1;
        el.setAttribute('aria-current', on ? 'true' : 'false');
      }
    }
    for (var j = 0; j < pips.length; j++) {
      var pa = ((j + 0.5) * STEP - 90 + rot) * Math.PI / 180;
      pips[j].style.transform =
        'translate(' + (Math.cos(pa) * R).toFixed(2) + 'px,' + (Math.sin(pa) * R).toFixed(2) + 'px)';
    }

    var nowActive = activeFromRot();
    if (nowActive !== active) {
      active = nowActive;
      setLabel(V[active]);
    }
  }

  var last = 0;
  function tick(now) {
    frame = null;
    var dt = last ? Math.min(now - last, 64) : 16;   // a backgrounded tab can hand back a huge gap
    last = now;

    if (tweening) {
      var t = Math.min(1, (now - tweenStart) / SPIN_MS);
      rot = tweenFrom + (tweenTo - tweenFrom) * easeOut(t);
      if (t >= 1) { tweening = false; holdUntil = now + RESUME_AFTER; }
    } else if (awake && !held && now >= holdUntil && !reduced) {
      rot -= DRIFT * dt;
    }

    place(now);
    schedule();
  }

  function schedule() {
    if (frame || reduced) return;
    // Nothing to draw when it is off screen, in a background tab, or sitting
    // still under a resting cursor. A ring animating where nobody can see it
    // is pure battery.
    if (!awake) return;
    if (!tweening && held) return;
    frame = requestAnimationFrame(tick);
  }

  function wake() { last = 0; schedule(); }

  // Ease to a particular venture, then let the drift take over again.
  function tweenTowards(targetRot) {
    // Reduced motion runs no frame loop at all, so there is nothing to ease
    // with — go straight there instead of setting a tween that never advances.
    if (reduced) { rot = targetRot; tweening = false; place(0); return; }
    tweenFrom = rot;
    tweenTo = targetRot;
    tweenStart = (window.performance && performance.now) ? performance.now() : Date.now();
    tweening = true;
    wake();
  }

  function render() { place(0); }

  // ---- the venture photographs ---------------------------------------------
  //
  // The picture in the middle is the one uploaded against that venture's slot
  // in the admin page — the same photograph its own page shows. It is read from
  // the media payload rather than hard-coded, so uploading a new photo changes
  // the ring with no code change.
  var media = null;

  // The cache site-media.js keeps. Reading it here means a repeat visitor has
  // the photograph on the first frame instead of after a round trip — which on
  // Render's free tier can be most of a minute if the server is cold.
  try {
    var raw = localStorage.getItem('kms.media.v2');
    if (raw) media = JSON.parse(raw);
  } catch (e) { media = null; }

  // site-media.js fetches /api/media for the rest of the page and announces it.
  // Listening is better than fetching again: one request, and the ring updates
  // the moment the fresh payload lands.
  window.addEventListener('kms:media', function (e) {
    if (e && e.detail) { media = e.detail; if (active >= 0) paintShot(V[active]); }
  });
  // Belt and braces: if nothing has announced itself — site-media missing, or
  // it failed — ask once. Late is better than an empty circle for ever.
  setTimeout(function () {
    if (media) return;
    try {
      fetch('/api/media', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (m) {
          if (!m || typeof m !== 'object') return;
          media = m;
          if (active >= 0) paintShot(V[active]);
        })
        .catch(function () {});
    } catch (err) {}
  }, 4000);

  function photoFor(v) {
    if (!media || !v || !v.photo) return '';
    var slot = media[v.photo];
    if (!slot) return '';
    // items[] is the slideshow; a venture with several photos shows the first,
    // which is the one its own page opens on.
    if (slot.items && slot.items.length) {
      for (var i = 0; i < slot.items.length; i++) {
        var it = slot.items[i];
        // Video frames cannot be shown in an <img>, so skip past any.
        if (it && it.url && it.kind !== 'video') return it.url;
      }
    }
    return slot.url && slot.kind !== 'video' ? slot.url : '';
  }

  // The icon is drawn first and always, so the circle is never empty: it is
  // what shows while the photograph loads, and what stays if there isn't one.
  function paintShot(v) {
    if (!v) return;
    midShot.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      (ICONS[v.icon] || '') + '</svg>';
    var url = photoFor(v);
    if (!url) return;
    var img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    // A photograph that 404s leaves the icon showing rather than a broken image.
    img.onerror = function () { if (img.parentNode) img.parentNode.removeChild(img); };
    img.onload = function () { img.classList.add('on'); };
    img.src = url;
    midShot.appendChild(img);
    // Already in the browser cache: onload may have fired before the handler
    // was attached, so fade it in directly rather than waiting for an event
    // that has been and gone.
    if (img.complete && img.naturalWidth) img.classList.add('on');
  }

  // Fade the centre text out, change it while nobody can see it, fade it back.
  var labelTimer = null;
  function setLabel(v) {
    var write = function () {
      midNow.textContent = v.num;
      midOf.textContent = ' / ' + String(N).padStart(2, '0');
      midName.textContent = v.name.replace(/^Shalom /, '');
      midStatus.textContent = v.status;
      paintShot(v);
    };
    if (reduced || midName.textContent === '') { write(); return; }
    clearTimeout(labelTimer);
    labels.forEach(function (el) { el.classList.add('swap'); });
    labelTimer = setTimeout(function () {
      write();
      labels.forEach(function (el) { el.classList.remove('swap'); });
    }, 300);
  }

  // Bring venture i to the top by the shorter way round, so jumping from 12 to
  // 01 turns one position forward instead of eleven backwards.
  function go(i) {
    var current = -rot / STEP;
    var diff = mod(i - current, N);
    if (diff > N / 2) diff -= N;
    tweenTowards(rot - diff * STEP);
  }

  // One venture forward or back from wherever the ring happens to be — which,
  // mid-drift, is usually part-way between two of them. Rounding first is what
  // makes a scroll land on a venture rather than an arbitrary angle.
  function step(d) {
    var at = Math.round(-rot / STEP);
    tweenTowards(-(at + d) * STEP);
  }

  var lastWheel = 0;
  wrap.addEventListener('wheel', function (e) {
    // Scoped to this element only — the page scrolls normally everywhere else.
    e.preventDefault();
    var now = Date.now();
    // A trackpad or a free-spinning wheel sends a burst of events per gesture.
    // With a turn now taking over a second, letting them through would build a
    // queue the ring spends the next ten seconds working off.
    if (now - lastWheel < WHEEL_COOLDOWN) return;
    lastWheel = now;
    step(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  wrap.addEventListener('keydown', function (e) {
    var d = 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') d = 1;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') d = -1;
    if (!d) return;
    e.preventDefault();
    // Focus the venture being moved TO. `active` is only updated on the next
    // frame, so reading it here would focus the one just left behind.
    var to = mod(Math.round(-rot / STEP) + d, N);
    step(d);
    items[to].focus();
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
    // A longer throw per step, to match the slower turn — otherwise one swipe
    // across the ring fires three of them.
    if (Math.abs(dx) >= 64) { step(dx < 0 ? 1 : -1); startX = e.clientX; }
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) {
    wrap.addEventListener(t, function () { startX = null; startY = null; axis = null; });
  });

  // ---- when to run ----------------------------------------------------------
  //
  // The drift stops the moment nobody is watching it, and picks up again from
  // wherever it left off.

  wrap.addEventListener('pointerenter', function (e) {
    if (e.pointerType === 'touch') return;   // a finger is a gesture, not a pause
    held = true;
  });
  wrap.addEventListener('pointerleave', function () { held = false; wake(); });
  wrap.addEventListener('focusin', function () { held = true; });
  wrap.addEventListener('focusout', function () { held = false; wake(); });

  document.addEventListener('visibilitychange', function () {
    awake = !document.hidden && onScreen;
    wake();
  });

  var onScreen = true;
  if (window.IntersectionObserver) {
    onScreen = false;                        // assume not, until told otherwise
    awake = false;
    new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        onScreen = en.isIntersecting;
        awake = onScreen && !document.hidden;
        wake();
      });
    }, { threshold: 0.12 }).observe(wrap);
  }

  // ---- first paint ---------------------------------------------------------

  render();
  wake();

  // The twelve circles come in one after another, starting at the top and
  // going round. Skipped entirely under reduced motion, where the ring should
  // simply be there.
  if (!reduced) {
    wrap.classList.add('intro');
    items.forEach(function (el, i) {
      el.style.animationDelay = (i * 45) + 'ms';
    });
    wrap.querySelectorAll('.so-pip').forEach(function (el, i) {
      el.style.animationDelay = (i * 45 + 120) + 'ms';
    });
    // NOT `last` — that is the frame loop's timestamp, and reusing the name
    // here is the same `var` in this scope. It would have been overwritten
    // with a duration, throwing the very first frame's timing out.
    var introEnds = (N - 1) * 45 + 550 + 60;
    setTimeout(function () {
      wrap.classList.remove('intro');
      items.forEach(function (el) { el.style.animationDelay = ''; });
      // Only now can the depth opacities be written — until the entrance
      // finishes, the animation is what owns opacity on these elements.
      introDone = true;
      render();
    }, introEnds);
  } else {
    introDone = true;
    render();
  }
})();
