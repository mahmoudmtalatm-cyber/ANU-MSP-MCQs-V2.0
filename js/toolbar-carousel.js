/* ══════════════════════════════════════════════════════════════════════
   QUICK-ACCESS TOOLBAR — INFINITE "WHEEL" SCROLLING
   ──────────────────────────────────────────────────────────────────────
   On any screen wide enough to lay out every tile (Statistics, Retake
   Wrong, Custom Quizzes, Community, Backup, API Keys) side by side, the
   toolbar is left exactly as authored in index.html/styles.css — flat,
   centered, no scrolling.

   The moment the tiles genuinely don't fit, this module turns the row
   into an endless wheel instead of a plain scrollbar-style overflow:
     • the real tiles are padded out with one hidden copy of the set
       before them and one after, so there's always more row on either
       side to scroll into — tiles stay fully visible and fully opaque
       right up to the edge, and there's no scroll-snap either, so the
       row is free to stop at any position rather than being pulled to
       fixed "resting" points
     • a short, centered indicator pill under the toolbar tracks how far
       through the current lap the rider is; when that position wraps
       past the end of a lap it jumps straight to the other side rather
       than sliding across, the same instant "reappears from the other
       side" illusion the tiles themselves get from their clones
     • once the rider scrolls a full lap past either padding copy, the
       scroll position is silently rewound by exactly one lap — since the
       pattern repeats identically, the jump is invisible and the wheel
       just keeps turning
     • the moment tiles fit again (rotate the phone, resize the window),
       the clones are removed and the toolbar reverts to the flat layout

   The order of the tiles themselves is never touched — this only changes
   how the row behaves once it can no longer show everything at once.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const toolbar = document.getElementById('toolbar');
  if (!toolbar) return;

  const wrap = document.getElementById('toolbarWrap') || toolbar.parentElement;

  // The authoritative set of tiles, exactly as written in the HTML.
  // Clones are generated from this list on demand and never replace it.
  const originalTiles = Array.from(toolbar.children);
  if (originalTiles.length < 2) return; // nothing to loop with one tile

  const DESKTOP_BREAKPOINT = '(min-width: 720px)';

  let looping = false;
  let setWidth = 0;      // px width of exactly one lap (all tiles + gaps)
  let pendingFrame = null;

  function toolbarGap() {
    const cs = getComputedStyle(toolbar);
    return parseFloat(cs.columnGap || cs.gap) || 10;
  }

  // Width the tiles need to sit side by side, independent of whatever is
  // currently in the DOM (clones or not) — always measured from the
  // original tiles, so this is a stable, single source of truth.
  function naturalContentWidth() {
    const gap = toolbarGap();
    let width = 0;
    originalTiles.forEach((tile, i) => {
      width += tile.getBoundingClientRect().width;
      if (i > 0) width += gap;
    });
    return width;
  }

  // Space actually available for tiles inside the toolbar's own padding.
  function availableWidth() {
    const cs = getComputedStyle(toolbar);
    const paddingX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    return toolbar.clientWidth - paddingX;
  }

  /* ────────────────────────────────────────────────────────────────────
     SCROLL-POSITION INDICATOR
     A slim pill under the toolbar that mirrors how far through one lap
     the rider has scrolled. Entirely optional visually — if the markup
     isn't present (e.g. an older cached page shell) everything above
     still works fine, this module just quietly does nothing.
     ──────────────────────────────────────────────────────────────────── */
  const Indicator = (function () {
    const thumb = document.getElementById('toolbarIndicatorThumb');
    if (!thumb) return { show() {}, hide() {}, update() {} };

    let lastProgress = null;

    function show() { wrap.classList.add('toolbar-wrap--scrollable'); }
    function hide() {
      wrap.classList.remove('toolbar-wrap--scrollable');
      lastProgress = null;
    }

    function update() {
      if (!looping || setWidth <= 0) return;
      const widthPct = Math.max(0, Math.min(100, (availableWidth() / setWidth) * 100));
      // Position within the current lap, independent of which of the
      // three (lead / real / trail) copies the rider is physically over —
      // the pattern repeats identically, so this is a stable 0..1 value
      // that wraps from ~1 back to ~0 (or back again) once per lap.
      const progress = (((toolbar.scrollLeft - setWidth) % setWidth) + setWidth) % setWidth / setWidth;

      // A lap wrap shows up as a large jump in progress between two
      // consecutive updates (a gradual scroll only ever moves it a
      // little). Suspending the transition for exactly that one update
      // makes the thumb disappear off one edge of the track and
      // reappear on the other instantly, instead of visibly sliding all
      // the way across — mirroring how a tile's clone carries it
      // seamlessly from one edge to the other.
      const wrapped = lastProgress !== null && Math.abs(progress - lastProgress) > 0.5;
      if (wrapped) thumb.classList.add('toolbar-indicator__thumb--jump');

      const leftPct = progress * (100 - widthPct);
      thumb.style.width = widthPct + '%';
      thumb.style.left = leftPct + '%';
      lastProgress = progress;

      if (wrapped) {
        requestAnimationFrame(() => thumb.classList.remove('toolbar-indicator__thumb--jump'));
      }
    }

    return { show, hide, update };
  })();

  function buildLoop() {
    if (looping) return;
    looping = true;

    setWidth = naturalContentWidth() + toolbarGap();

    const before = document.createDocumentFragment();
    const after = document.createDocumentFragment();
    originalTiles.forEach((tile) => {
      const lead = tile.cloneNode(true);
      lead.setAttribute('aria-hidden', 'true');
      lead.tabIndex = -1;
      before.appendChild(lead);

      const trail = tile.cloneNode(true);
      trail.setAttribute('aria-hidden', 'true');
      trail.tabIndex = -1;
      after.appendChild(trail);
    });

    toolbar.insertBefore(before, toolbar.firstChild);
    toolbar.appendChild(after);
    toolbar.classList.add('toolbar--loop');

    // Land on the real (middle) lap.
    toolbar.scrollLeft = setWidth;
    toolbar.addEventListener('scroll', onScroll, { passive: true });

    Indicator.show();
    Indicator.update();
  }

  function onScroll() {
    Indicator.update();
    if (!looping || pendingFrame) return;
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = null;
      if (toolbar.scrollLeft > 0 && toolbar.scrollLeft < setWidth * 2) return;

      // Resolve the *exact* number of laps crossed (not just one) so a
      // fast fling still lands in a single clean, instant jump no matter
      // how hard or fast the rider scrolls.
      if (toolbar.scrollLeft <= 0) {
        const laps = Math.floor((setWidth - toolbar.scrollLeft) / setWidth) + 1;
        toolbar.scrollLeft += setWidth * laps;
      } else {
        const laps = Math.floor((toolbar.scrollLeft - setWidth * 2) / setWidth) + 1;
        toolbar.scrollLeft -= setWidth * laps;
      }
      Indicator.update();
    });
  }

  function teardownLoop() {
    if (!looping) return;
    looping = false;
    toolbar.removeEventListener('scroll', onScroll);
    if (pendingFrame) { cancelAnimationFrame(pendingFrame); pendingFrame = null; }
    toolbar.classList.remove('toolbar--loop');
    toolbar.innerHTML = '';
    originalTiles.forEach((tile) => toolbar.appendChild(tile));
    toolbar.scrollLeft = 0;
    Indicator.hide();
  }

  function sync() {
    // The desktop layout (see @media (min-width:720px) in styles.css)
    // centers and wraps the tiles instead of scrolling them at all — the
    // wheel is only ever appropriate below that breakpoint, and only once
    // the tiles actually fail to fit within it.
    if (window.matchMedia(DESKTOP_BREAKPOINT).matches) {
      teardownLoop();
      return;
    }
    const fits = naturalContentWidth() <= availableWidth() + 1; // rounding guard
    if (fits) {
      teardownLoop();
    } else if (looping) {
      // Already looping across a resize (e.g. a rotating tablet that
      // still doesn't fit) — re-measure the lap width, re-land on the
      // start of the middle lap for the new size, and refresh the
      // indicator's proportions, rather than tearing the whole loop down
      // and rebuilding it.
      setWidth = naturalContentWidth() + toolbarGap();
      toolbar.scrollLeft = setWidth;
      Indicator.update();
    } else {
      buildLoop();
    }
  }

  let resizeTimer = null;
  function scheduleSync() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(sync, 120);
  }

  window.addEventListener('resize', scheduleSync);
  window.addEventListener('orientationchange', scheduleSync);

  // Tile width depends on the rendered label text, so re-check once
  // webfonts (and the rest of the page) have actually finished loading.
  if (document.readyState === 'complete') {
    sync();
  } else {
    window.addEventListener('load', sync);
  }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(sync).catch(function () {});
  }
})();
