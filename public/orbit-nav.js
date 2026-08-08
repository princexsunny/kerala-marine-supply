// Orbit navigation for the home-page hero — ADDITIVE ONLY.
//
// Nothing that already exists in the hero is moved, resized, restyled or
// removed. This script builds two new elements at runtime and places them in
// the empty off-white gutter between the hero text and the hero photograph:
//
//   1. a vertical rotary navigation — five circles threaded on a drawn curve,
//      each with a coloured icon and a caption beneath it, and
//   2. a media overlay sitting exactly over the hero photo's box, used to
//      crossfade in a different picture when a non-default item is active.
//
// The existing hero photo stays in the page untouched underneath; item 03
// (Shalom Boat Yard, the default) simply fades the overlay away to reveal it.
//
// Media comes from the same public endpoint the rest of the page already uses
// (GET /api/media — the pictures uploaded in /admin.html). Each item maps to
// an admin slot below; an empty slot falls back to the hero photograph. Both
// images and videos are supported: a slot whose contentType starts with
// "video/" renders as a muted, looping, inline <video>, paused when its item
// is not active.
(function () {
  'use strict';

  // ---- configuration -------------------------------------------------------

  var ITEMS = [
    // slot  : which /api/media entry supplies this item's picture or video.
    //         These are the "Hero orbit" slots in /admin.html.
    // colour: each category carries its own icon colour, as in the design.
    { num: '01', label: 'Coastline\nDevelopment', icon: 'waves',    slot: 'orbit1', color: '#12a594' },
    { num: '02', label: 'Deepwater\nPort',        icon: 'anchor',   slot: 'orbit2', color: '#1e4fa3' },
    { num: '03', label: 'Shalom\nBoat Yard',      icon: 'ship',     slot: 'hero',   color: '#ec3013' },
    { num: '04', label: 'Community\nImpact',      icon: 'people',   slot: 'orbit4', color: '#e8842a' },
    { num: '05', label: 'Our\nVentures',          icon: 'building', slot: 'orbit5', color: '#5b4fc4' },
  ];
  var DEFAULT_INDEX = 2;          // 03 — Shalom Boat Yard
  var HERO_SLOT = 'hero';

  var AUTO_MS = 2000;             // idle time before an automatic step
  var SPIN_MS = 700;              // orbit + active-item transition
  var FADE_MS = 700;              // media crossfade
  var WHEEL_COOLDOWN_MS = 450;    // one item per wheel gesture, not per tick
  var DRAG_STEP_PX = 48;          // vertical drag distance per item

  // Arc geometry. The active circle sits furthest LEFT and vertically centred;
  // the others swing away above and below along a parabola, each stepping
  // right. A parabola (not a true circle) keeps the horizontal spread to a
  // single number, so the curve can never grow wider than the strip.
  var ARC_SPREAD = 84;            // how far the outermost circles sit right of the active one
  var LEFT_PAD = 40;              // space kept left of the active circle's centre
  var STEP_Y = 112;               // vertical spacing between neighbours
  var DOT = 48;                   // circle diameter
  var DOT_ACTIVE = 66;

  // Strip sizing, measured from the real gap at runtime. It never hides for
  // want of space — it steps down through narrower forms instead.
  var NAV_FULL_W = 196;           // curve + circles + captions + "scroll to explore"
  var NAV_MID_W = 150;            // curve + circles + captions
  var NAV_TIGHT_W = 74;           // circles + curve only
  var NAV_GAP = 18;               // clear space kept between the strip and the photo

  var ICONS = {
    waves:    '<path d="M3 8.5q3-3.5 6 0t6 0 6 0"/><path d="M3 14q3-3.5 6 0t6 0 6 0"/><path d="M3 19.5q3-3.5 6 0t6 0 6 0"/>',
    anchor:   '<circle cx="12" cy="5" r="2.4"/><path d="M12 7.4V20"/><path d="M4.5 13.5C4.5 17 7.8 20 12 20s7.5-3 7.5-6.5"/><path d="M8.5 10h7"/>',
    ship:     '<path d="M4 15.5l1.7-5h12.6l1.7 5z"/><path d="M4 15.5q4 2.8 8 0t8 0"/><path d="M12 10.5V5l3.6 2.4z"/><path d="M6.5 19.5q5.5 2.5 11 0"/>',
    people:   '<circle cx="8.5" cy="9" r="2.4"/><circle cx="15.5" cy="9" r="2.4"/><path d="M4.5 18c0-2.4 1.8-4 4-4s4 1.6 4 4"/><path d="M11.8 15.6c.8-1 2.1-1.6 3.7-1.6 2.2 0 4 1.6 4 4"/>',
    building: '<rect x="4" y="8" width="7" height="12"/><rect x="13" y="4" width="7" height="16"/><path d="M6.5 11h2M6.5 14.5h2M15.5 7h2M15.5 10.5h2M15.5 14h2"/>',
  };

  // ---- state ---------------------------------------------------------------

  var active = DEFAULT_INDEX;
  var media = {};
  var autoTimer = null;
  var hovering = false;
  var reducedMotion = false;
  try {
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {}

  var nav, itemEls = [], overlay, overlayLayers = [null, null], overlayFront = 0;
  var curvePath = null, marker = null;
  var heroBox = null;
  var navWidth = 0;
  var lastPlacement = null;

  // ---- helpers -------------------------------------------------------------

  function mod(n, m) { return ((n % m) + m) % m; }

  function mediaFor(index) {
    var entry = media[ITEMS[index].slot];
    if (entry && entry.url) return entry;
    return media[HERO_SLOT] || null;
  }

  function isHeroMedia(index) {
    var m = mediaFor(index);
    var h = media[HERO_SLOT];
    return !m || (h && m.url === h.url);
  }

  // ---- placement -----------------------------------------------------------

  // The hero's own photograph — never one of the overlay's crossfade layers.
  // The overlay lives inside the hero too and its layers are <img>/<video>, so
  // a naive "first image in the hero" lookup would measure the overlay against
  // itself, feeding its own output back in on every reflow.
  function findPhoto() {
    var all = heroBox.querySelectorAll('img, video');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (overlay && overlay.contains(el)) continue;
      if (nav && nav.contains(el)) continue;
      var r = el.getBoundingClientRect();
      if (r.width > 40 && r.height > 40) return el;
    }
    var hr = heroBox.getBoundingClientRect();
    if (hr.width > 100 && hr.height > 100) return heroBox;
    return null;
  }

  // Right-hand edge of the actual text, not of the column holding it: the
  // column runs to the photograph but its content stops well short, and that
  // remainder is the whitespace the strip belongs in.
  function textContentRight(col) {
    var edge = col.getBoundingClientRect().left;
    var kids = col.querySelectorAll('h1, h2, p, a, span');
    for (var i = 0; i < kids.length; i++) {
      var r = kids[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0) edge = Math.max(edge, r.right);
    }
    return edge;
  }

  function place() {
    if (!nav || !heroBox) return;
    var host = heroBox.getBoundingClientRect();
    var photoEl = findPhoto();
    if (!photoEl) {
      lastPlacement = { shown: false, why: 'no photo element and hero box too small' };
      nav.style.visibility = 'hidden';
      return;
    }
    var photo = photoEl.getBoundingClientRect();
    if (!photo.width || !photo.height || !host.width) {
      lastPlacement = { shown: false, why: 'nothing laid out yet — will retry' };
      nav.style.visibility = 'hidden';
      return;
    }
    nav.style.visibility = '';

    var textCol = document.querySelector('.g-hero > div:first-child');
    var leftEdge = textCol ? textContentRight(textCol) : host.left;
    var gutter = photo.left - leftEdge;

    // Always anchored to the photograph: the strip's right edge sits NAV_GAP
    // left of the picture and grows leftward into the whitespace. Anchoring
    // this way is what guarantees it can never cover the photo.
    var width = gutter >= NAV_FULL_W + NAV_GAP ? NAV_FULL_W
              : gutter >= NAV_MID_W + NAV_GAP ? NAV_MID_W
              : NAV_TIGHT_W;

    var left = (photo.left - host.left) - NAV_GAP - width;

    navWidth = width;
    nav.style.width = Math.round(width) + 'px';
    nav.style.left = Math.round(left) + 'px';
    nav.classList.toggle('kms-orbit-mid', width === NAV_MID_W);
    nav.classList.toggle('kms-orbit-tight', width === NAV_TIGHT_W);

    lastPlacement = {
      shown: true, gutter: Math.round(gutter), width: width,
      form: width === NAV_FULL_W ? 'full' : (width === NAV_MID_W ? 'captions only' : 'circles only'),
      textRight: Math.round(leftEdge), photoLeft: Math.round(photo.left),
      stripSpans: Math.round(host.left + left) + '..' + Math.round(host.left + left + width),
      usedFallbackBox: photoEl === heroBox,
    };

    // Overlay tracks the photo's box exactly, clamped to the hero so a bad
    // measurement can never let it spill across the page.
    if (overlay) {
      var oW = Math.min(Math.round(photo.width), Math.round(host.width));
      var oH = Math.min(Math.round(photo.height), Math.round(host.height));
      var oL = Math.max(0, Math.min(Math.round(photo.left - host.left), Math.round(host.width) - oW));
      var oT = Math.max(0, Math.min(Math.round(photo.top - host.top), Math.round(host.height) - oH));
      overlay.style.left = oL + 'px';
      overlay.style.top = oT + 'px';
      overlay.style.width = oW + 'px';
      overlay.style.height = oH + 'px';
    }

    layout(false);
  }

  // ---- arc layout ----------------------------------------------------------

  // Horizontal offset for an item `dist` steps away from the active one.
  // Quadratic, so neighbours barely move and the outermost swing out fully.
  function arcX(dist) {
    return LEFT_PAD + ARC_SPREAD * (dist * dist) / 4;
  }

  function layout(animate) {
    var h = nav.clientHeight;
    if (!h) return;
    var cy = h / 2;
    var n = ITEMS.length;
    var stepY = Math.min(STEP_Y, (h - 150) / (n - 1));

    for (var i = 0; i < n; i++) {
      var el = itemEls[i];
      // Short way around the loop, so 05 -> 01 travels one step forward
      // rather than four steps backward.
      var off = mod(i - active + n / 2, n) - n / 2;
      var dist = Math.abs(off);
      var x = arcX(dist);
      var y = cy + off * stepY;
      var isActive = i === active;

      el.style.transition = (animate && !reducedMotion)
        ? 'transform ' + SPIN_MS + 'ms cubic-bezier(.33,.9,.25,1), opacity ' + SPIN_MS + 'ms ease'
        : 'none';
      // Centred on its own point, so the caption underneath stays centred too.
      el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) translate(-50%,-50%)';
      el.style.opacity = String(Math.max(0.45, 1 - dist * 0.18));
      el.style.zIndex = String(10 - Math.round(dist));
      el.classList.toggle('kms-orbit-active', isActive);
      el.setAttribute('aria-current', isActive ? 'true' : 'false');
      el.tabIndex = isActive ? 0 : -1;
    }

    // The thread the circles hang on: sample the same parabola past both ends
    // so the line runs on toward the chevrons instead of stopping dead.
    if (curvePath) {
      var d = '';
      for (var t = -2.55; t <= 2.55; t += 0.06) {
        var px = arcX(Math.abs(t));
        var py = cy + t * stepY;
        d += (d ? ' L' : 'M') + px.toFixed(1) + ',' + py.toFixed(1);
      }
      curvePath.setAttribute('d', d);
    }

    // Active marker: a small filled dot on the curve's right, with the caption
    // beside it. Only in the full-width form — there is no room otherwise.
    if (marker) {
      marker.style.transform = 'translate(' + (arcX(0) + DOT_ACTIVE / 2 + 10) + 'px,' + cy + 'px) translateY(-50%)';
    }
  }

  // ---- media overlay -------------------------------------------------------

  function buildLayer(entry) {
    var isVideo = entry.contentType && entry.contentType.indexOf('video/') === 0;
    var el;
    if (isVideo) {
      el = document.createElement('video');
      el.muted = true;            // audio must never autoplay
      el.loop = true;
      el.autoplay = true;
      el.playsInline = true;
      el.setAttribute('playsinline', '');
      el.src = entry.url;
    } else {
      el = document.createElement('img');
      el.src = entry.url;
      el.alt = '';
      el.decoding = 'async';
    }
    el.className = 'kms-orbit-media-layer';
    return el;
  }

  function showMedia(index) {
    var back = overlayLayers[1 - overlayFront];
    if (back && back.tagName === 'VIDEO') back.pause();

    if (isHeroMedia(index)) {
      overlay.style.opacity = '0';
      var front = overlayLayers[overlayFront];
      if (front && front.tagName === 'VIDEO') front.pause();
      return;
    }

    var next = buildLayer(mediaFor(index));
    var slot = 1 - overlayFront;
    if (overlayLayers[slot]) overlay.removeChild(overlayLayers[slot]);
    overlayLayers[slot] = next;
    overlay.appendChild(next);

    next.style.opacity = '0';
    next.style.transform = 'scale(1.02)';
    overlay.style.opacity = '1';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        next.style.opacity = '1';
        next.style.transform = 'scale(1)';
      });
    });

    var old = overlayLayers[overlayFront];
    overlayFront = slot;
    if (old) {
      setTimeout(function () {
        if (old.parentNode === overlay && old !== overlayLayers[overlayFront]) {
          if (old.tagName === 'VIDEO') old.pause();
          overlay.removeChild(old);
          for (var i = 0; i < 2; i++) if (overlayLayers[i] === old) overlayLayers[i] = null;
        }
      }, FADE_MS + 100);
    }
  }

  // ---- activation + auto-rotation ------------------------------------------

  function activate(index, animate) {
    index = mod(index, ITEMS.length);
    if (index === active) { resetAuto(); return; }
    active = index;
    layout(animate !== false);
    showMedia(index);
    resetAuto();
  }

  function step(dir) { activate(active + dir); }

  // One controlled timer. Every interaction funnels through resetAuto(), so a
  // stale timer can never fire just after the user has done something.
  function scheduleAuto() {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(function () {
      if (!hovering && !document.hidden) step(1);
      else scheduleAuto();
    }, AUTO_MS);
  }
  function resetAuto() { scheduleAuto(); }

  // ---- construction --------------------------------------------------------

  function chevron(dir) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'kms-orbit-chev kms-orbit-chev-' + (dir < 0 ? 'up' : 'down');
    b.setAttribute('aria-label', dir < 0 ? 'Previous' : 'Next');
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="' +
      (dir < 0 ? 'M5 15l7-7 7 7' : 'M5 9l7 7 7-7') + '"/></svg>';
    b.addEventListener('click', function () { step(dir); });
    return b;
  }

  function buildNav() {
    nav = document.createElement('nav');
    nav.className = 'kms-orbit';
    nav.setAttribute('aria-label', 'Hero highlights');

    // Curve first, so the circles sit on top of the line.
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'kms-orbit-curve');
    svg.setAttribute('aria-hidden', 'true');
    curvePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svg.appendChild(curvePath);
    nav.appendChild(svg);

    nav.appendChild(chevron(-1));

    for (var i = 0; i < ITEMS.length; i++) {
      (function (i) {
        var it = ITEMS[i];
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'kms-orbit-item';
        b.style.setProperty('--ic', it.color);
        b.setAttribute('aria-label', it.num + ' — ' + it.label.replace('\n', ' '));
        b.innerHTML =
          '<span class="kms-orbit-dot"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
          'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + ICONS[it.icon] + '</svg></span>' +
          '<span class="kms-orbit-cap">' + it.label.split('\n').map(function (l) {
            return '<span>' + l + '</span>';
          }).join('') + '</span>';
        b.addEventListener('click', function () { activate(i); });
        itemEls.push(b);
        nav.appendChild(b);
      })(i);
    }

    nav.appendChild(chevron(1));

    marker = document.createElement('span');
    marker.className = 'kms-orbit-marker';
    marker.setAttribute('aria-hidden', 'true');
    marker.innerHTML = '<span class="kms-orbit-marker-dot"></span>' +
      '<span class="kms-orbit-marker-txt">Scroll<br>to explore</span>';
    nav.appendChild(marker);

    // -- wheel: captured ONLY while the cursor is over the strip -------------
    var lastWheel = 0;
    nav.addEventListener('wheel', function (e) {
      e.preventDefault();       // scoped to this element; the page scrolls normally elsewhere
      var now = Date.now();
      if (now - lastWheel < WHEEL_COOLDOWN_MS) return;   // exactly one item per gesture
      lastWheel = now;
      step(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });

    nav.addEventListener('pointerenter', function () { hovering = true; });
    nav.addEventListener('pointerleave', function () { hovering = false; resetAuto(); });

    // -- drag / swipe --------------------------------------------------------
    var dragY = null, dragged = 0;
    nav.addEventListener('pointerdown', function (e) {
      dragY = e.clientY; dragged = 0;
      try { nav.setPointerCapture(e.pointerId); } catch (err) {}
    });
    nav.addEventListener('pointermove', function (e) {
      if (dragY === null) return;
      var dy = e.clientY - dragY;
      if (Math.abs(dy - dragged * DRAG_STEP_PX) >= DRAG_STEP_PX) {
        var dir = dy > dragged * DRAG_STEP_PX ? -1 : 1;   // drag down = previous
        dragged += (dir === -1 ? 1 : -1);
        step(dir);
      }
    });
    var endDrag = function () { dragY = null; dragged = 0; resetAuto(); };
    nav.addEventListener('pointerup', endDrag);
    nav.addEventListener('pointercancel', endDrag);

    // -- keyboard ------------------------------------------------------------
    nav.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); step(1); itemEls[active].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); itemEls[active].focus(); }
      else if (e.key === 'Enter' || e.key === ' ') {
        var idx = itemEls.indexOf(document.activeElement);
        if (idx !== -1) { e.preventDefault(); activate(idx); }
      }
    });

    return nav;
  }

  var CSS =
    '.kms-orbit{position:absolute;top:0;bottom:0;margin:0;padding:0;z-index:6;' +
    '  overflow:visible;background:none;border:none;touch-action:none}' +
    '.kms-orbit-curve{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}' +
    '.kms-orbit-curve path{fill:none;stroke:var(--color-neutral-400,#c9c5c0);stroke-width:1;' +
    '  stroke-linecap:round;opacity:.85}' +

    // Each item is centred on its own point; the caption sits beneath the
    // circle, so the strip's width is driven by caption width, not by a
    // circle-plus-label row.
    '.kms-orbit-item{position:absolute;left:0;top:0;display:flex;flex-direction:column;align-items:center;' +
    '  gap:9px;background:none;border:none;padding:0;margin:0;cursor:pointer;' +
    '  font-family:var(--font-body,inherit);will-change:transform,opacity}' +
    '.kms-orbit-dot{width:48px;height:48px;flex:none;border-radius:50%;background:#fff;' +
    '  box-shadow:0 2px 10px rgba(32,30,29,.10),0 0 0 1px rgba(32,30,29,.05);' +
    '  display:flex;align-items:center;justify-content:center;color:var(--ic,#6a6660);' +
    '  transition:width .35s,height .35s,box-shadow .35s}' +
    '.kms-orbit-dot svg{width:23px;height:23px}' +
    '.kms-orbit-cap{display:flex;flex-direction:column;align-items:center;line-height:1.25;text-align:center;' +
    '  font-size:11px;font-weight:600;color:var(--color-neutral-800,#4d4a45);white-space:nowrap}' +
    '.kms-orbit-item:focus-visible .kms-orbit-dot{outline:2px solid var(--color-accent,#ec3013);outline-offset:3px}' +

    // Active: bigger circle, red ring and glow, red caption.
    '.kms-orbit-active .kms-orbit-dot{width:66px;height:66px;color:var(--color-accent,#ec3013);' +
    '  box-shadow:0 0 0 2px var(--color-accent,#ec3013),0 0 0 9px rgba(236,48,19,.10),' +
    '  0 8px 22px rgba(236,48,19,.18)}' +
    '.kms-orbit-active .kms-orbit-dot svg{width:30px;height:30px}' +
    '.kms-orbit-active .kms-orbit-cap{color:var(--color-accent,#ec3013);font-weight:700}' +

    // Chevrons top and bottom, on the curve's line.
    '.kms-orbit-chev{position:absolute;left:' + LEFT_PAD + 'px;transform:translateX(-50%);' +
    '  background:none;border:none;padding:6px;cursor:pointer;color:var(--color-neutral-500,#a09b95);' +
    '  transition:color .2s}' +
    '.kms-orbit-chev:hover{color:var(--color-accent,#ec3013)}' +
    '.kms-orbit-chev svg{width:20px;height:20px;display:block}' +
    '.kms-orbit-chev-up{top:2px}' +
    '.kms-orbit-chev-down{bottom:2px}' +

    // "Scroll to explore", pinned beside the active circle.
    '.kms-orbit-marker{position:absolute;left:0;top:0;display:flex;align-items:center;gap:9px;' +
    '  pointer-events:none;white-space:nowrap}' +
    '.kms-orbit-marker-dot{width:7px;height:7px;border-radius:50%;background:var(--color-accent,#ec3013);flex:none}' +
    '.kms-orbit-marker-txt{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;' +
    '  color:var(--color-neutral-600,#8a857f);line-height:1.3}' +

    // Narrower forms: drop the marker, then the captions.
    '.kms-orbit-mid .kms-orbit-marker{display:none}' +
    '.kms-orbit-tight .kms-orbit-marker{display:none}' +
    '.kms-orbit-tight .kms-orbit-cap{display:none}' +
    '.kms-orbit-tight .kms-orbit-dot{width:38px;height:38px}' +
    '.kms-orbit-tight .kms-orbit-dot svg{width:19px;height:19px}' +
    '.kms-orbit-tight .kms-orbit-active .kms-orbit-dot{width:50px;height:50px}' +
    '.kms-orbit-tight .kms-orbit-active .kms-orbit-dot svg{width:24px;height:24px}' +

    '.kms-orbit-media{position:absolute;z-index:5;overflow:hidden;pointer-events:none;opacity:0;' +
    '  transition:opacity ' + FADE_MS + 'ms ease}' +
    '.kms-orbit-media-layer{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;' +
    '  transition:opacity ' + FADE_MS + 'ms ease,transform ' + (FADE_MS + 200) + 'ms ease}' +

    // The gutter only exists on the wide layout; below this the hero stacks.
    '@media (max-width:900px){.kms-orbit,.kms-orbit-media{display:none !important}}' +
    '@media (prefers-reduced-motion:reduce){.kms-orbit-item{transition:none !important}' +
    '  .kms-orbit-media,.kms-orbit-media-layer{transition:none !important}}';

  // ---- boot ----------------------------------------------------------------

  function mount(heroImg) {
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    overlay = document.createElement('div');
    overlay.className = 'kms-orbit-media';
    overlay.setAttribute('aria-hidden', 'true');

    heroBox = heroImg;
    if (getComputedStyle(heroImg).position === 'static') heroImg.style.position = 'relative';
    heroImg.appendChild(overlay);
    heroImg.appendChild(buildNav());
    place();

    // The photograph arrives asynchronously and the hero reflows on resize, so
    // re-measure rather than trusting the first reading.
    window.addEventListener('resize', place);
    try { new ResizeObserver(function () { place(); }).observe(heroImg); } catch (e) {}
    heroImg.addEventListener('load', function () { place(); }, true);

    var settle = 0;
    var settleTimer = setInterval(function () {
      place();
      if (lastPlacement && lastPlacement.shown) { clearInterval(settleTimer); return; }
      if (++settle > 120) clearInterval(settleTimer);   // ~30s ceiling
    }, 250);

    fetch('/api/media', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (m) {
        media = m && typeof m === 'object' ? m : {};
        // Preload the other items' pictures once idle, so the first crossfade
        // doesn't pop in over a half-loaded image.
        setTimeout(function () {
          ITEMS.forEach(function (it) {
            var e = media[it.slot];
            if (e && e.url && (!e.contentType || e.contentType.indexOf('video/') !== 0)) {
              var img = new Image(); img.src = e.url;
            }
          });
        }, 1200);
      })
      .catch(function () { media = {}; })
      .then(function () { scheduleAuto(); });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) resetAuto();
    });

    // Diagnostics: run kmsOrbit() in the console to see what was measured.
    window.kmsOrbit = function () { place(); return lastPlacement; };
  }

  // The home page is a self-unpacking bundle: the hero doesn't exist yet when
  // this script first runs. Watch for it, same pattern as site-media.js.
  function start() {
    var el = document.querySelector('.hero-img');
    if (el) { mount(el); return; }
    var obs = new MutationObserver(function () {
      var el = document.querySelector('.hero-img');
      if (el) { obs.disconnect(); clearTimeout(giveUp); mount(el); }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    var giveUp = setTimeout(function () { obs.disconnect(); }, 15000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
