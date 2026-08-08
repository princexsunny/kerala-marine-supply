// Orbit navigation for the home-page hero — ADDITIVE ONLY.
//
// Nothing that already exists in the hero is moved, resized, restyled or
// removed. This script builds two new elements at runtime and drops them into
// the empty gutter between the hero text and the hero photograph:
//
//   1. a vertical rotary navigation (5 items on a curved orbit), and
//   2. a media overlay sitting exactly over the hero photo's box, used to
//      crossfade in a different photo when a non-default item is active.
//
// The existing hero photo stays in the page untouched underneath; item 03
// (Boat yard, the default) simply fades the overlay away to reveal it.
//
// Media comes from the same public endpoint the rest of the page already
// uses (GET /api/media — the photos uploaded in /admin.html). Each item maps
// to an admin slot below; empty slots fall back to the default hero photo.
// Both images and videos are supported: a slot whose contentType starts with
// "video/" renders as a muted, looping, autoplaying inline <video>, paused
// whenever its item is not the active one.
(function () {
  'use strict';

  // ---- configuration -------------------------------------------------------

  var ITEMS = [
    // icon: minimalist line icon, drawn inline further down by ICONS[key].
    // slot: which /api/media entry supplies this item's picture or video.
    //       These are the dedicated "Hero orbit" slots in /admin.html, so each
    //       category's media is managed there alongside the other photos.
    //       An empty slot falls back to the existing hero photograph.
    { num: '01', label: 'Coastline', icon: 'waves',  slot: 'orbit1' },
    { num: '02', label: 'Deepwater', icon: 'anchor', slot: 'orbit2' },
    { num: '03', label: 'Boat yard', icon: 'ship',   slot: 'hero'   }, // default — the existing hero photo
    { num: '04', label: 'Community', icon: 'people', slot: 'orbit4' },
    { num: '05', label: 'Ventures',  icon: 'grid',   slot: 'orbit5' },
  ];
  var DEFAULT_INDEX = 2;          // 03 — Boat yard
  var HERO_SLOT = 'hero';         // the slot the untouched hero photo shows

  var AUTO_MS = 2000;             // idle time before an automatic step
  var SPIN_MS = 700;              // orbit + active-item transition
  var FADE_MS = 700;              // media crossfade
  var WHEEL_COOLDOWN_MS = 450;    // one item per wheel gesture, not per tick
  var DRAG_STEP_PX = 48;          // vertical drag distance per item

  // Geometry of the orbit. The centre sits far to the LEFT of the strip, so
  // the items trace a gentle arc that bows toward the photo — a rotary
  // selector, not a straight list. Angles are per-step around that centre.
  var RADIUS = 240;
  var STEP_DEG = 16.5;
  var CENTER_X = -150;            // px, relative to the nav strip's own box
  var NAV_W = 150;                // width of the strip the items are laid out in
  var NAV_GAP = 22;               // clear space between the strip and the photo

  var ICONS = {
    waves:  '<path d="M3 9q3-3.5 6 0t6 0 6 0"/><path d="M3 15q3-3.5 6 0t6 0 6 0"/>',
    anchor: '<circle cx="12" cy="5" r="2.4"/><path d="M12 7.4V20"/><path d="M4.5 13.5C4.5 17 7.8 20 12 20s7.5-3 7.5-6.5"/><path d="M9 10h6"/>',
    ship:   '<path d="M4 15l1.6-4.5h12.8L20 15z"/><path d="M4 15q4 2.6 8 0t8 0"/><path d="M12 10.5V5.5l3.4 2.2z"/>',
    people: '<circle cx="8.5" cy="9" r="2.4"/><circle cx="15.5" cy="9" r="2.4"/><path d="M4.5 18c0-2.4 1.8-4 4-4s4 1.6 4 4"/><path d="M11.8 15.6c.8-1 2.1-1.6 3.7-1.6 2.2 0 4 1.6 4 4"/>',
    grid:   '<rect x="4.5" y="4.5" width="6" height="6" rx="1"/><rect x="13.5" y="4.5" width="6" height="6" rx="1"/><rect x="4.5" y="13.5" width="6" height="6" rx="1"/><rect x="13.5" y="13.5" width="6" height="6" rx="1"/>',
  };

  // ---- state ---------------------------------------------------------------

  var active = DEFAULT_INDEX;
  var media = {};                 // /api/media payload: slot -> {url, contentType}
  var autoTimer = null;
  var hovering = false;
  var reducedMotion = false;
  try {
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {}

  var nav, itemEls = [], overlay, overlayLayers = [null, null], overlayFront = 0;
  var heroBox = null;   // the .hero-img container the strip is mounted into

  // ---- helpers -------------------------------------------------------------

  function mod(n, m) { return ((n % m) + m) % m; }

  function mediaFor(index) {
    var slot = ITEMS[index].slot;
    var entry = media[slot];
    if (entry && entry.url) return entry;
    return media[HERO_SLOT] || null; // fall back to the default hero photo
  }

  function isHeroMedia(index) {
    var m = mediaFor(index);
    var h = media[HERO_SLOT];
    // No media at all, or the same file as the untouched hero photo: show the
    // existing hero by fading the overlay out rather than duplicating it.
    return !m || (h && m.url === h.url);
  }

  // ---- placement -----------------------------------------------------------

  // Park the strip entirely to the LEFT of the photograph, in the off-white
  // gutter. The photo's real position is measured rather than assumed: the
  // hero is a design-tool export whose image is swapped at runtime by
  // site-media.js, so its inline geometry is not reliable. Measuring means
  // this stays correct whatever the photo ends up doing.
  function place() {
    if (!nav || !heroBox) return;
    var host = heroBox.getBoundingClientRect();
    var photoEl = heroBox.querySelector('img, video') || heroBox;
    var photo = photoEl.getBoundingClientRect();

    // Nothing laid out yet (photo still loading, hero hidden, zero-size box).
    // Placing against a degenerate measurement would fling the strip somewhere
    // arbitrary, so keep it hidden and wait for a real reading instead.
    if (!photo.width || !photo.height || !host.width) {
      nav.style.visibility = 'hidden';
      return;
    }
    nav.style.visibility = '';

    // Right edge of the strip sits NAV_GAP left of the photo's left edge.
    var left = (photo.left - host.left) - NAV_W - NAV_GAP;

    nav.style.width = NAV_W + 'px';
    nav.style.left = Math.round(left) + 'px';

    // Overlay tracks the photo's box exactly, so switched media matches its
    // size, position and crop rather than the template's original numbers.
    if (overlay) {
      overlay.style.left = Math.round(photo.left - host.left) + 'px';
      overlay.style.top = Math.round(photo.top - host.top) + 'px';
      overlay.style.width = Math.round(photo.width) + 'px';
      overlay.style.height = Math.round(photo.height) + 'px';
    }
  }

  // ---- orbit layout --------------------------------------------------------

  function layout(animate) {
    var h = nav.clientHeight;
    var cy = h / 2;
    for (var i = 0; i < ITEMS.length; i++) {
      var el = itemEls[i];
      // Offset from the active item, taken the short way around the loop so
      // 05 -> 01 animates one step forward, not four steps backward.
      var raw = i - active;
      var n = ITEMS.length;
      var off = mod(raw + n / 2, n) - n / 2;
      var a = off * STEP_DEG * Math.PI / 180;
      var x = CENTER_X + RADIUS * Math.cos(a);
      var y = cy + RADIUS * Math.sin(a);
      var isActive = i === active;
      var scale = isActive ? 1 : Math.max(0.72, 1 - Math.abs(off) * 0.16);
      el.style.transition = (animate && !reducedMotion)
        ? 'transform ' + SPIN_MS + 'ms cubic-bezier(.33,.9,.25,1), opacity ' + SPIN_MS + 'ms ease'
        : 'none';
      el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) translate(0,-50%) scale(' + scale + ')';
      el.style.opacity = String(Math.max(0.35, 1 - Math.abs(off) * 0.22));
      el.style.zIndex = String(10 - Math.abs(Math.round(off)));
      el.classList.toggle('kms-orbit-active', isActive);
      el.setAttribute('aria-current', isActive ? 'true' : 'false');
      el.tabIndex = isActive ? 0 : -1;
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
    if (back && back.tagName === 'VIDEO') back.pause(); // never leave a hidden video running

    if (isHeroMedia(index)) {
      // Reveal the untouched hero photo underneath.
      overlay.style.opacity = '0';
      var front = overlayLayers[overlayFront];
      if (front && front.tagName === 'VIDEO') front.pause();
      return;
    }

    var entry = mediaFor(index);
    var next = buildLayer(entry);
    var slot = 1 - overlayFront;
    if (overlayLayers[slot]) overlay.removeChild(overlayLayers[slot]);
    overlayLayers[slot] = next;
    overlay.appendChild(next);

    // Crossfade: new layer fades in over the old one, with the very subtle
    // settle-in scale the brief asks for (1.02 -> 1). Old layer is cleaned up
    // after the fade rather than at the start, so there is never a blank gap.
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
  // stale timer can never fire after the user has just done something.
  function scheduleAuto() {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(function () {
      // Paused while the cursor is over the nav — rotating the control the
      // user is aiming at is worse than pausing.
      if (!hovering && !document.hidden) step(1);
      else scheduleAuto();
    }, AUTO_MS);
  }
  function resetAuto() { scheduleAuto(); }

  // ---- construction --------------------------------------------------------

  function buildNav() {
    nav = document.createElement('nav');
    nav.className = 'kms-orbit';
    nav.setAttribute('aria-label', 'Hero highlights');

    for (var i = 0; i < ITEMS.length; i++) {
      (function (i) {
        var it = ITEMS[i];
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'kms-orbit-item';
        b.setAttribute('aria-label', it.num + ' — ' + it.label);
        b.innerHTML =
          '<span class="kms-orbit-dot"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
          'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + ICONS[it.icon] + '</svg></span>' +
          '<span class="kms-orbit-meta"><span class="kms-orbit-num">' + it.num + '</span>' +
          '<span class="kms-orbit-lbl">' + it.label + '</span></span>';
        b.addEventListener('click', function () { activate(i); });
        itemEls.push(b);
        nav.appendChild(b);
      })(i);
    }

    // -- wheel: captured ONLY while the cursor is over the nav itself --------
    var lastWheel = 0;
    nav.addEventListener('wheel', function (e) {
      e.preventDefault(); // scoped to this element; page scrolling elsewhere is untouched
      var now = Date.now();
      if (now - lastWheel < WHEEL_COOLDOWN_MS) return; // exactly one item per gesture
      lastWheel = now;
      step(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });

    nav.addEventListener('pointerenter', function () { hovering = true; });
    nav.addEventListener('pointerleave', function () { hovering = false; resetAuto(); });

    // -- drag / swipe: vertical, snaps one item per DRAG_STEP_PX -------------
    var dragY = null, dragged = 0;
    nav.addEventListener('pointerdown', function (e) {
      dragY = e.clientY; dragged = 0;
      try { nav.setPointerCapture(e.pointerId); } catch (err) {}
    });
    nav.addEventListener('pointermove', function (e) {
      if (dragY === null) return;
      var dy = e.clientY - dragY;
      if (Math.abs(dy - dragged * DRAG_STEP_PX) >= DRAG_STEP_PX) {
        var dir = dy > dragged * DRAG_STEP_PX ? -1 : 1; // drag down = previous
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
    // The strip occupies the hero's empty left gutter (the photo starts at
    // 127px). Positioned absolutely inside .hero-img, so nothing existing
    // moves to make room for it.
    '.kms-orbit{position:absolute;top:0;bottom:0;margin:0;padding:0;' +
    '  z-index:6;overflow:visible;background:none;border:none;cursor:default;touch-action:none}' +
    '.kms-orbit-item{position:absolute;left:0;top:0;display:flex;align-items:center;gap:9px;' +
    '  background:none;border:none;padding:4px;margin:0;cursor:pointer;font-family:var(--font-body,inherit);' +
    '  will-change:transform,opacity}' +
    '.kms-orbit-dot{width:40px;height:40px;flex:none;border-radius:50%;background:var(--color-bg,#fff);' +
    '  border:1.5px solid var(--color-neutral-300,#d8d4cf);display:flex;align-items:center;justify-content:center;' +
    '  color:var(--color-neutral-700,#6a6660);transition:border-color .25s,color .25s,box-shadow .25s}' +
    '.kms-orbit-dot svg{width:20px;height:20px}' +
    '.kms-orbit-meta{display:flex;flex-direction:column;align-items:flex-start;line-height:1.15;text-align:left}' +
    '.kms-orbit-num{font-size:10px;font-weight:700;letter-spacing:.08em;color:var(--color-neutral-600,#8a857f)}' +
    '.kms-orbit-lbl{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;' +
    '  color:var(--color-neutral-800,#4d4a45);white-space:nowrap}' +
    '.kms-orbit-item:focus-visible .kms-orbit-dot{outline:2px solid var(--color-accent,#ec3013);outline-offset:2px}' +
    '.kms-orbit-active .kms-orbit-dot{width:52px;height:52px;border:2px solid var(--color-accent,#ec3013);' +
    '  color:var(--color-accent,#ec3013);box-shadow:0 0 0 5px rgba(236,48,19,.08),0 6px 18px rgba(236,48,19,.14)}' +
    '.kms-orbit-active .kms-orbit-dot svg{width:24px;height:24px}' +
    '.kms-orbit-active .kms-orbit-num,.kms-orbit-active .kms-orbit-lbl{color:var(--color-accent,#ec3013)}' +
    // Media overlay: EXACTLY the hero photo's box (the same inline geometry
    // the template gives the hero video variant), so switched media has the
    // same size, position and cover behaviour as the photo it covers.
    '.kms-orbit-media{position:absolute;z-index:5;' +
    '  overflow:hidden;pointer-events:none;opacity:0;transition:opacity ' + FADE_MS + 'ms ease}' +
    '.kms-orbit-media-layer{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;' +
    '  transition:opacity ' + FADE_MS + 'ms ease,transform ' + (FADE_MS + 200) + 'ms ease}' +
    // The gutter only exists on the wide layout. Below it the hero stacks and
    // there is no empty strip, so the addition bows out entirely rather than
    // covering the headline or the photo. (Media reverts to the plain hero.)
    '@media (max-width:1099px){.kms-orbit,.kms-orbit-media{display:none !important}}' +
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
    layout(false);

    // The photo arrives asynchronously (site-media.js swaps it in after
    // fetching /api/media), and the hero reflows on resize -- so re-measure
    // rather than trusting the first reading.
    window.addEventListener('resize', place);
    var ro = null;
    try {
      ro = new ResizeObserver(function () { place(); });
      ro.observe(heroImg);
    } catch (e) {}
    var settle = 0;
    var settleTimer = setInterval(function () {
      place();
      if (++settle > 20) clearInterval(settleTimer);   // ~5s, then stop
    }, 250);

    fetch('/api/media', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (m) {
        media = m && typeof m === 'object' ? m : {};
        // Preload the other items' images once idle, so the first crossfade
        // doesn't pop in over a half-loaded picture.
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
