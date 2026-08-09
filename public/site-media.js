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
    var css = inline + ';display:block;object-fit:cover;';
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

  function fillPhoto(slotEl, url, slotKey) {
    var img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.style.cssText = styleFor(slotEl);
    img.setAttribute('data-kms-slot', slotKey);   // marks this slot as filled

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
        fillPhoto(el, entry.url, slot);
      } catch (e) {
        // One bad slot must not stop the others.
        if (window.console) console.warn('site-media: could not fill ' + slot, e);
      }
    });

    if (media.video && media.video.url) {
      try {
        placeVideo(media.video);
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
    fetch('/api/media', { credentials: 'same-origin' })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (media) {
        if (media && typeof media === 'object') applyWhenReady(media);
      })
      .catch(function () {
        // Offline, server asleep, whatever — the page just shows no photos.
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
