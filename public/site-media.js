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
  var SLOT_TO_ELEMENT = {
    hero: 'kms-hero',
    photo1: 'kms-photo-1',
    photo2: 'kms-photo-2',
    photo3: 'kms-photo-3',
    founder: 'kms-founder',
  };

  // The hero photograph has a designed box in the original template: inset
  // 127px from the left of its container, 430x616. That inset is what created
  // the off-white gutter between the headline and the picture.
  //
  // Filling the slot with a plain inset:0 image (as every other slot wants)
  // stretched the photo across the whole column and swallowed that gutter —
  // dropping the usable gap from ~275px to ~50px. These are the template's own
  // numbers, restoring the composition it was exported with.
  var HERO_BOX = 'position:absolute;left:127px;top:-2px;width:430px;height:616px;' +
                 'object-fit:cover;display:block';
  var FILL_BOX = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block';
  // Below this the hero stacks into one column, where the inset would push the
  // photo off the side — so the plain fill is correct there.
  var WIDE = '(min-width: 901px)';

  function heroStyle() {
    var wide = true;
    try { wide = window.matchMedia(WIDE).matches; } catch (e) {}
    return wide ? HERO_BOX : FILL_BOX;
  }

  function fillPhoto(slotEl, url, slotKey) {
    // object-fit:cover keeps the aspect ratio and crops the overflow rather
    // than stretching the photo, which is what every one of these frames wants.
    var img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    var isHero = slotKey === 'hero';
    img.style.cssText = isHero ? heroStyle() : FILL_BOX;
    if (isHero) img.setAttribute('data-kms-hero', '');

    var parent = slotEl.parentNode;
    if (!parent) return;
    // If the wrapper has no positioning context the absolute placement would
    // escape to the page, so establish one. (Most already have it.)
    if (parent.nodeType === 1) {
      var pos = window.getComputedStyle(parent).position;
      if (pos === 'static') parent.style.position = 'relative';
    }
    parent.replaceChild(img, slotEl);
  }

  // Crossing the breakpoint has to swap the hero between its inset box and a
  // plain fill, or a resized window leaves the photo in the wrong one.
  function refreshHeroBox() {
    var img = document.querySelector('img[data-kms-hero]');
    if (img) img.style.cssText = heroStyle();
  }
  window.addEventListener('resize', refreshHeroBox);

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
    var anchorImg =
      document.getElementById('kms-photo-3') || document.getElementById('kms-photo-1');
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
      var el = document.getElementById(SLOT_TO_ELEMENT[slot]);
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
