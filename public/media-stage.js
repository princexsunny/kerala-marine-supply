// A picture area that can hold several photos and a video, and move between
// them without a flicker.
//
// One component, used in two places: the homepage hero (site-media.js) and the
// photo on each venture page (venture.html). They had grown separate,
// slightly-different copies of "put an image in this box", which is how the
// hero ended up with a fade and the venture pages without one.
//
// The rules it follows:
//   * Nothing is ever swapped in before it has decoded. A slide is preloaded
//     first and only then crossfaded to, so a slow photo delays the change
//     rather than showing a half-drawn or blank frame.
//   * The video plays first, once, then hands over to the photographs. It is
//     the thing worth seeing and it should not hold the hero for ever.
//   * It stops when it is not being watched — scrolled out of view, tab in the
//     background, or a finger/cursor resting on it. A slideshow running in a
//     hidden tab is pure battery.
//   * prefers-reduced-motion is honoured properly: no autoplay, no automatic
//     advance, no fade. The dots still work, so nothing becomes unreachable.
//
// Dependency-free and defensive on purpose: this runs on the public site, so
// any failure here has to degrade to "one still picture", never to a broken
// page.
(function () {
  'use strict';

  var FADE_MS = 600;
  var DEFAULT_INTERVAL = 6000;
  var STYLE_ID = 'kms-stage-css';

  function reducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }

  function injectCss() {
    if (document.getElementById(STYLE_ID)) return;
    var css =
      '.kms-stage{position:relative;overflow:hidden;background:var(--color-neutral-200,#eceae7)}' +
      '.kms-layer{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;' +
      '  opacity:0;transition:opacity ' + FADE_MS + 'ms ease}' +
      '.kms-layer.on{opacity:1}' +
      // The dots sit on a soft gradient rather than the photo itself: over a
      // bright sky white dots vanish, and a hard bar would cut the picture.
      // Above every layer, whatever the stacking counter has reached.
      '.kms-dots{position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:center;' +
      '  align-items:flex-end;gap:8px;padding:26px 12px 12px;z-index:9999;' +
      '  background:linear-gradient(to top,rgba(20,18,17,.42),rgba(20,18,17,0));' +
      '  opacity:1;transition:opacity .3s ease}' +
      '.kms-dot{position:relative;width:8px;height:8px;padding:0;border:none;border-radius:50%;' +
      '  cursor:pointer;background:rgba(255,255,255,.55);flex:none;' +
      '  transition:background .25s,width .25s;-webkit-tap-highlight-color:transparent}' +
      '.kms-dot:hover{background:rgba(255,255,255,.85)}' +
      '.kms-dot.on{background:#fff;width:20px;border-radius:4px}' +
      '.kms-dot:focus-visible{outline:2px solid #fff;outline-offset:3px}' +
      // A dot is 8px of ink but has to be a ~44px target for a thumb. The hit
      // area is grown with a pseudo-element so the dots stay visually small.
      '.kms-dot::after{content:"";position:absolute;top:-16px;bottom:-16px;left:-13px;right:-13px}' +
      '@media (prefers-reduced-motion:reduce){' +
      '  .kms-layer{transition:none}.kms-dot{transition:none}}';
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = css;
    document.head.appendChild(s);
  }

  // Load an image and resolve only once it has actually decoded, so the fade
  // never starts against an empty frame. Resolves (rather than rejects) on
  // failure: a broken photo should be skipped, not stop the slideshow.
  function preload(url) {
    return new Promise(function (resolve) {
      var img = new Image();
      var settled = false;
      var done = function (ok) {
        if (settled) return;
        settled = true;
        resolve(ok ? img : null);
      };
      img.onload = function () {
        if (img.decode) img.decode().then(function () { done(true); }, function () { done(true); });
        else done(true);
      };
      img.onerror = function () { done(false); };
      img.src = url;
      // Cached images can be complete before the handler is attached.
      if (img.complete && img.naturalWidth) done(true);
      // Never let one unreachable file stall the rotation for ever.
      setTimeout(function () { done(!!(img.complete && img.naturalWidth)); }, 8000);
    });
  }

  function buildVideo(url, posterUrl) {
    var el = document.createElement('video');
    el.src = url;
    if (posterUrl) el.poster = posterUrl;
    el.muted = true;            // required for autoplay, and nothing should
    el.defaultMuted = true;     // start making noise at a visitor uninvited
    el.setAttribute('muted', '');
    el.playsInline = true;
    el.setAttribute('playsinline', '');
    // No player chrome: this is artwork, not something to operate.
    el.controls = false;
    el.disablePictureInPicture = true;
    el.setAttribute('disablepictureinpicture', '');
    el.setAttribute('disableremoteplayback', '');
    el.setAttribute('controlslist', 'nodownload nofullscreen noremoteplayback noplaybackrate');
    el.preload = 'auto';
    el.className = 'kms-layer';
    el.style.pointerEvents = 'none';
    return el;
  }

  // opts:
  //   target      element to replace (an <image-slot>) or fill
  //   mode        'replace' (default) or 'fill'
  //   boxStyle    css text for the stage box itself
  //   items       [{url}]  photographs, in order
  //   video       {url} or null
  //   videoFirst  play the video once, then move on to the photos
  //   interval    ms between photos
  //   eager       load the first photo at high priority (use for the hero)
  //   name        used for the aria labels
  // Returns the stage element, or null if there was nothing to show.
  function mount(opts) {
    var items = (opts.items || []).filter(function (i) { return i && i.url; });
    var video = opts.video && opts.video.url ? opts.video : null;
    if (!items.length && !video) return null;

    injectCss();
    var reduced = reducedMotion();
    var interval = opts.interval || DEFAULT_INTERVAL;

    var stage = document.createElement('div');
    stage.className = 'kms-stage';
    stage.style.cssText = opts.boxStyle || '';
    // position must resolve for the absolutely-placed layers. Only forced when
    // the caller has not already positioned the box itself.
    if (!/position\s*:/.test(stage.style.cssText)) stage.style.position = 'relative';

    // The slide list. The video, when there is one, always goes first.
    var slides = [];
    if (video) slides.push({ type: 'video', url: video.url });
    items.forEach(function (it) { slides.push({ type: 'photo', url: it.url }); });

    var layers = new Array(slides.length);
    var index = -1;
    var timer = null;
    // Every show() takes a ticket. A preload that finishes after a newer
    // request has been made is discarded rather than applied, which is what
    // stops a slow photo landing on screen after you have already tapped past
    // it. An earlier version used a plain "busy" flag and dropped incoming
    // requests instead — that made a dot ignore your tap, and a short video
    // fail to hand over, for the whole length of a fade.
    var seq = 0;
    var skips = 0;      // consecutive unreachable slides, so a dead list ends
    // The incoming slide has to paint ON TOP of the outgoing one, or the fade
    // dips through the background colour on its way across instead of one
    // picture simply becoming the other. DOM order cannot be relied on for
    // that — layers are created in whatever order they finish preloading — so
    // each slide is raised as it is shown.
    var zTop = 1;
    var visible = true;
    var held = false;      // pointer or focus resting on the stage
    var destroyed = false;

    // ---- building one slide -------------------------------------------------

    function layerFor(i) {
      // 'failed' is a marker, not an element — returning it as-is is how a
      // broken photo reached the code that calls classList on it.
      if (layers[i] === 'failed') return Promise.resolve(null);
      if (layers[i]) return Promise.resolve(layers[i]);
      var s = slides[i];

      if (s.type === 'video') {
        // The first photograph makes a far better poster than a black frame:
        // it is on screen the instant it loads while the clip is still
        // buffering, and the video then starts over the top of it.
        var poster = items.length ? items[0].url : null;
        var v = buildVideo(s.url, poster);
        // Loop only when there is nothing to move on to.
        v.loop = slides.length === 1;
        v.addEventListener('ended', function () {
          if (slides.length > 1) next();
        });
        layers[i] = v;
        stage.insertBefore(v, stage.firstChild);
        return Promise.resolve(v);
      }

      return preload(s.url).then(function (loaded) {
        if (destroyed) return null;
        if (!loaded) { layers[i] = 'failed'; return null; }
        var img = document.createElement('img');
        img.className = 'kms-layer';
        img.src = s.url;
        img.alt = '';
        img.decoding = 'async';
        img.loading = (opts.eager && i <= 1) ? 'eager' : 'lazy';
        if (opts.eager && i === 0) img.setAttribute('fetchpriority', 'high');
        layers[i] = img;
        stage.insertBefore(img, stage.firstChild);
        return img;
      });
    }

    // ---- moving between slides ---------------------------------------------

    function show(i) {
      if (destroyed || i === index) return Promise.resolve();
      if (!slides[i]) return Promise.resolve();
      var my = ++seq;
      return layerFor(i).then(function (el) {
        if (destroyed || my !== seq) return;   // a newer request has overtaken this one
        if (!el || !el.classList) {
          // Unreachable photo: step over it. Bounded, so a slot where every
          // file has gone missing stops instead of spinning.
          if (slides.length > 1 && ++skips < slides.length) return show(mod(i + 1, slides.length));
          return;
        }
        skips = 0;
        var prev = index >= 0 ? layers[index] : null;
        index = i;
        // Force a frame between insertion and the class change, or the browser
        // may batch them and the element appears with no transition at all.
        requestAnimationFrame(function () {
          if (destroyed || my !== seq) return;
          el.style.zIndex = ++zTop;
          el.classList.add('on');
          if (prev && prev !== el && prev.classList) prev.classList.remove('on');
          if (prev && prev.tagName === 'VIDEO' && prev.pause) { try { prev.pause(); } catch (e) {} }
          paintDots();
          if (el.tagName === 'VIDEO' && !reduced && el.play) {
            try { el.currentTime = 0; } catch (e) {}
            var p = el.play();
            if (p && p.catch) p.catch(function () {
              // Autoplay refused (data saver, battery saver). There are no
              // controls to press, so move on to the photographs instead of
              // sitting on a frozen frame.
              if (slides.length > 1) next();
            });
          }
          // Have the following photo ready before it is needed.
          if (slides.length > 1) layerFor(mod(i + 1, slides.length));
        });
      });
    }

    function mod(n, m) { return ((n % m) + m) % m; }
    function next() { show(mod(index + 1, slides.length)); }

    // ---- the timer ----------------------------------------------------------
    //
    // The video is not on a timer — it advances when it ends, however long it
    // happens to be. Only the photographs are timed.

    function tick() {
      if (destroyed || !visible || held) return;
      var current = slides[index];
      if (current && current.type === 'video') return;   // waits for 'ended'
      next();
    }

    function startTimer() {
      stopTimer();
      if (reduced || slides.length < 2) return;
      timer = setInterval(tick, interval);
    }
    function stopTimer() {
      if (timer) { clearInterval(timer); timer = null; }
    }

    function hold(on) {
      held = on;
      var v = layers[index];
      if (v && v.tagName === 'VIDEO' && v.pause && v.play) {
        try { on ? v.pause() : v.play(); } catch (e) {}
      }
    }

    // ---- dots ---------------------------------------------------------------

    var dots = null;
    if (slides.length > 1) {
      dots = document.createElement('div');
      dots.className = 'kms-dots';
      dots.setAttribute('role', 'tablist');
      dots.setAttribute('aria-label', (opts.name || 'Photographs') + ' — choose one');
      slides.forEach(function (s, i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'kms-dot';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-label',
          s.type === 'video' ? 'Video' : ('Photograph ' + (i + (video ? 0 : 1))));
        b.addEventListener('click', function () {
          stopTimer();
          show(i).then(startTimer);
        });
        dots.appendChild(b);
      });
      stage.appendChild(dots);
    }

    function paintDots() {
      if (!dots) return;
      for (var i = 0; i < dots.children.length; i++) {
        var on = i === index;
        dots.children[i].classList.toggle('on', on);
        dots.children[i].setAttribute('aria-selected', on ? 'true' : 'false');
      }
    }

    // ---- when to run --------------------------------------------------------

    stage.addEventListener('pointerenter', function () { hold(true); });
    stage.addEventListener('pointerleave', function () { hold(false); });
    stage.addEventListener('focusin', function () { hold(true); });
    stage.addEventListener('focusout', function () { hold(false); });

    document.addEventListener('visibilitychange', function () {
      visible = !document.hidden;
      var v = layers[index];
      if (v && v.tagName === 'VIDEO') {
        try { document.hidden ? v.pause() : (held ? null : v.play()); } catch (e) {}
      }
    });

    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          visible = e.isIntersecting && !document.hidden;
          var v = layers[index];
          if (v && v.tagName === 'VIDEO') {
            try { visible && !held ? v.play() : v.pause(); } catch (er) {}
          }
        });
      }, { threshold: 0.15 }).observe(stage);
    }

    // ---- attach -------------------------------------------------------------

    if (opts.mode === 'fill') {
      opts.target.appendChild(stage);
    } else {
      var parent = opts.target.parentNode;
      if (!parent) return null;
      parent.replaceChild(stage, opts.target);
    }

    // Reduced motion means the video will not autoplay, so opening on it would
    // leave a still frame that never moves and never advances. Start on the
    // first photograph instead; the video is still reachable from its dot.
    var first = (reduced && video && items.length) ? 1 : 0;
    show(first).then(startTimer);

    stage.kmsDestroy = function () {
      destroyed = true;
      stopTimer();
    };
    return stage;
  }

  window.KMSStage = { mount: mount, FADE_MS: FADE_MS };
})();
