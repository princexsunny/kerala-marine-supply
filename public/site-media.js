// Fills the homepage with the photos and video uploaded through /admin.html.
//
// Why this file exists: index.html was exported from a design tool and its
// picture areas are <image-slot> custom elements, which only ever loaded their
// content from a local .image-slots.state.json sidecar that the design tool
// wrote. That sidecar doesn't exist in production and the component's script
// isn't even loaded here, so every slot rendered as an empty box — photos saved
// in the admin went to Firebase and stopped there. This script closes that gap:
// it reads GET /api/media and puts real <img>/<video> elements on the page.
//
// Deliberately dependency-free and defensive: it runs on the public homepage,
// so a failure here must degrade to "no photos" and never break the rest of
// the page.
(function () {
  'use strict';

  // Why photos used to appear late, and what this does about it.
  //
  // Nothing could be drawn until three things had happened in sequence:
  // the page loaded, /api/media answered (on Render's free tier that can mean
  // waking a sleeping server), and only then did the image itself start
  // downloading. Three round trips before a single pixel.
  //
  // The payload is tiny and rarely changes, so it is kept in localStorage.
  // A repeat visit paints from that copy straight away and then quietly
  // refreshes in the background — so the wait happens once, not every load.
  var CACHE_KEY = 'kms.media.v1';

  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }   // private mode, quota, corrupt entry
  }
  function writeCache(media) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(media)); } catch (e) {}
  }

  // Open the connection to the image host early. Without this the browser only
  // starts DNS + TLS after the API replies, adding a further delay before the
  // first byte of the picture.
  function preconnect(url) {
    try {
      var origin = new URL(url, location.href).origin;
      if (origin === location.origin) return;
      if (document.querySelector('link[data-kms-pc="' + origin + '"]')) return;
      var l = document.createElement('link');
      l.rel = 'preconnect';
      l.href = origin;
      l.crossOrigin = '';
      l.setAttribute('data-kms-pc', origin);
      document.head.appendChild(l);
    } catch (e) {}
  }

  // Admin slot key -> the id the design tool gave that spot in index.html.
  // The redesigned homepage renamed its picture areas and dropped the three
  // strip photos, so the old kms-* ids no longer exist. Slots with no element
  // on the page are skipped, which keeps this safe if the design changes again.
  var SLOT_TO_ELEMENT = {
    hero: 'hero',
    founder: 'founder',
  };

  // How the replacement image is sized.
  //
  // These slots are direct children of the hero/founder grids and carry their
  // own dimensions (width:100%; aspect-ratio:4/3). An absolutely positioned
  // "fill the parent" image was therefore filling the whole GRID — covering
  // the headline and the buttons with the photograph. The replacement must
  // stay in the flow and inherit the slot's own box instead.
  function styleFor(slotEl) {
    var inline = slotEl.getAttribute('style') || '';
    var css = inline + ';display:block;object-fit:cover;transition:opacity .45s ease;';
    if (!/(^|;)\s*width\s*:/.test(inline)) css += 'width:100%;';
    // Without a height or a ratio the image would collapse; a ratio is the
    // better default because it survives a column resize.
    if (!/(^|;)\s*(height|aspect-ratio)\s*:/.test(inline)) css += 'aspect-ratio:4/3;';
    // The export offsets some slots (top:-55px), which needs a position to
    // resolve against.
    if (/(^|;)\s*(top|left|right|bottom)\s*:/.test(inline) && !/position\s*:/.test(inline)) {
      css += 'position:relative;';
    }
    return css;
  }

  // The hero shows the uploaded video when there is one, with the hero
  // PHOTOGRAPH as its poster frame. That means the picture is on screen the
  // instant it loads while the video is still buffering, instead of a black
  // rectangle — the video then starts over the top of it.
  function fillVideo(slotEl, video, posterUrl, slotKey) {
    var el = document.createElement('video');
    el.src = video.url;
    if (posterUrl) el.poster = posterUrl;
    el.muted = true;            // required for autoplay, and nothing should
    el.defaultMuted = true;     // start making noise at a visitor uninvited
    el.setAttribute('muted', '');
    el.loop = true;
    el.playsInline = true;
    el.setAttribute('playsinline', '');

    // No player chrome: this is hero artwork, not something to operate. The
    // control bar, the picture-in-picture button and the browser's own hover
    // overlay all get turned off, and pointer events are disabled so a stray
    // click can't pause it.
    el.controls = false;
    el.removeAttribute('controls');
    el.disablePictureInPicture = true;
    el.setAttribute('disablepictureinpicture', '');
    el.setAttribute('disableremoteplayback', '');
    el.setAttribute('controlslist', 'nodownload nofullscreen noremoteplayback noplaybackrate');

    // Buffer properly before starting, so it plays through rather than
    // stuttering on the first loop.
    el.preload = 'auto';

    var reduced = false;
    try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    el.autoplay = !reduced;
    if (!reduced) el.setAttribute('autoplay', '');

    // Background matches the page rather than black: with object-fit:cover
    // there should be no bars, and if a frame ever does show through, off-white
    // disappears into the layout where black would not.
    el.style.cssText = styleFor(slotEl) +
      'background:var(--color-neutral-200,#eceae7);pointer-events:none;';
    el.setAttribute('data-kms-slot', slotKey);

    // Fade in once there is a frame to show, the same way the photos do, so
    // it eases in instead of snapping from poster to video.
    el.style.opacity = '0';
    var reveal = function () { el.style.opacity = '1'; };
    el.addEventListener('loadeddata', reveal);
    el.addEventListener('canplay', reveal);
    el.addEventListener('error', reveal);
    setTimeout(reveal, 2500);   // never leave it stuck invisible

    var parent = slotEl.parentNode;
    if (!parent) return;
    parent.replaceChild(el, slotEl);

    // Autoplay can still be refused (data saver, battery saver). With no
    // controls there is nothing for the visitor to press, so fall back to the
    // poster image — which is the hero photograph, and looks intentional.
    if (!reduced && el.play) {
      var pr = el.play();
      if (pr && pr.catch) pr.catch(function () {});
    }
  }

  function fillPhoto(slotEl, url, slotKey) {
    var img = document.createElement('img');
    img.src = url;
    img.alt = '';
    // The hero sits at the top of the page, so it must load eagerly and with
    // priority; lazy-loading the most visible image on the site delayed the
    // very picture people were waiting for.
    var aboveFold = slotKey === 'hero';
    img.loading = aboveFold ? 'eager' : 'lazy';
    img.decoding = 'async';
    if (aboveFold) img.setAttribute('fetchpriority', 'high');

    // cssText replaces the whole style attribute, so it has to be set BEFORE
    // the opacity below — the other way round silently wiped the fade.
    img.style.cssText = styleFor(slotEl);
    img.setAttribute('data-kms-slot', slotKey);   // marks this slot as filled

    // Fade in once decoded, so it arrives rather than snapping into place.
    // A cached image can already be complete here, in which case there is
    // nothing to wait for and it should simply be visible.
    if (img.complete && img.naturalWidth) {
      img.style.opacity = '1';
    } else {
      img.style.opacity = '0';
      img.addEventListener('load', function () { img.style.opacity = '1'; });
      img.addEventListener('error', function () { img.style.opacity = '1'; });
      // Belt and braces: never leave a picture stuck invisible.
      setTimeout(function () { img.style.opacity = '1'; }, 2500);
    }

    var parent = slotEl.parentNode;
    if (!parent) return;
    parent.replaceChild(img, slotEl);
  }

  function buildVideoSection(video) {
    // Variable fallbacks: the page has moved between stylesheets before (the
    // old design-system vars vs the current --line/--accent set), so accept
    // either and end on a hard-coded colour that matches the brand.
    var section = document.createElement('section');
    section.id = 'kms-video-section';
    section.style.cssText =
      'border-bottom:1px solid var(--color-divider, var(--line, #e7e4e0))';

    var pad = document.createElement('div');
    pad.style.cssText = 'max-width:1280px;margin:0 auto;padding:72px 40px';

    var eyebrow = document.createElement('div');
    eyebrow.textContent = 'On the water';
    eyebrow.style.cssText =
      'font-size:12px;letter-spacing:0.16em;text-transform:uppercase;' +
      'color:var(--color-accent-700, var(--accent, #ec3013));font-weight:700;margin-bottom:24px';

    var el = document.createElement('video');
    el.src = video.url;
    el.controls = true;
    el.preload = 'metadata';
    el.playsInline = true;
    // No autoplay: it would need muting to be allowed at all, burns mobile
    // data without consent, and a marine-business homepage has no reason to
    // start making noise at a visitor.
    el.style.cssText =
      'width:100%;max-height:70vh;display:block;background:#000;border-radius:12px;' +
      'border:1px solid var(--color-divider, var(--line, #e7e4e0))';

    pad.appendChild(eyebrow);
    pad.appendChild(el);
    section.appendChild(pad);
    return section;
  }

  function placeVideo(video) {
    if (document.getElementById('kms-video-section')) return;
    var section = buildVideoSection(video);

    // Prefer just after the photo strip — the video belongs with the other
    // visual material rather than stranded at the bottom of the page.
    var anchorImg = document.querySelector('[data-kms-slot="founder"], image-slot#founder') ||
                    document.querySelector('[data-kms-slot="hero"], image-slot#hero');
    var anchorSection = anchorImg && anchorImg.closest ? anchorImg.closest('section') : null;

    if (anchorSection && anchorSection.parentNode) {
      anchorSection.parentNode.insertBefore(section, anchorSection.nextSibling);
      return;
    }
    // Fallbacks: before the footer, else at the end of the body.
    var footer = document.querySelector('footer');
    if (footer && footer.parentNode) {
      footer.parentNode.insertBefore(section, footer);
      return;
    }
    document.body.appendChild(section);
  }

  // Returns true once every slot the payload has content for has been filled.
  function apply(media) {
    var pending = 0;

    Object.keys(SLOT_TO_ELEMENT).forEach(function (slot) {
      var entry = media[slot];
      if (!entry || !entry.url) return;
      if (document.querySelector('[data-kms-slot="' + slot + '"]')) return;  // already filled

      // Matched by TAG as well as id, deliberately. index.html carries both
      // <section id="founder"> and <image-slot id="founder">, and
      // getElementById returns the section — which would replace the whole
      // founder section with the photograph.
      var el = document.querySelector('image-slot#' + SLOT_TO_ELEMENT[slot]);
      if (!el) {
        pending++; // not rendered yet — try again on the next mutation
        return;
      }
      try {
        // Hero: video wins if one has been uploaded, with the photo as poster.
        if (slot === 'hero' && media.video && media.video.url) {
          fillVideo(el, media.video, entry.url, slot);
        } else {
          fillPhoto(el, entry.url, slot);
        }
      } catch (e) {
        // One bad slot must not stop the others.
        if (window.console) console.warn('site-media: could not fill ' + slot, e);
      }
    });

    if (media.video && media.video.url) {
      try {
        // With no hero photo uploaded, the loop above never runs for 'hero',
        // so put the video straight into that slot here.
        var heroSlot = document.querySelector('image-slot#' + SLOT_TO_ELEMENT.hero);
        if (heroSlot && !document.querySelector('[data-kms-slot="hero"]')) {
          fillVideo(heroSlot, media.video, null, 'hero');
        } else if (!document.querySelector('[data-kms-slot="hero"]')) {
          pending++;                      // hero not rendered yet — retry
        }
        // Only fall back to a section of its own if the hero can't take it,
        // so the same clip never appears twice on the page.
        if (!document.querySelector('video[data-kms-slot="hero"]')) placeVideo(media.video);
      } catch (e) {
        if (window.console) console.warn('site-media: could not place video', e);
      }
    }

    return pending === 0;
  }

  // index.html is a self-unpacking bundle: it replaces the whole document with
  // the real page some time after load, so the slots usually do NOT exist when
  // this script first runs. Rather than guess at a delay, watch the DOM and
  // re-apply until everything the API gave us has landed.
  function applyWhenReady(media) {
    if (apply(media)) return;

    var observer = new MutationObserver(function () {
      if (apply(media)) done();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Stop watching eventually — an unfilled slot means the page changed shape
    // and no amount of waiting will help, and a permanent observer on the whole
    // document is a needless cost on every homepage visit.
    var timer = setTimeout(done, 15000);

    function done() {
      clearTimeout(timer);
      observer.disconnect();
    }
  }

  function start() {
    // Straight away, from the last known payload.
    var cached = readCache();
    if (cached && typeof cached === 'object') {
      Object.keys(cached).forEach(function (k) {
        if (cached[k] && cached[k].url) preconnect(cached[k].url);
      });
      applyWhenReady(cached);
    }

    // Then check for changes. Uploads are uniquely named, so a new photo is a
    // new URL and simply replaces the cached one on the next load.
    fetch('/api/media', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (media) {
        if (!media || typeof media !== 'object') return;
        writeCache(media);
        applyWhenReady(media);
      })
      .catch(function () {
        // Offline, server asleep, whatever — the cached photos still show.
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
