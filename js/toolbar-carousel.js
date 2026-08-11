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
       side to scroll into
     • an edge mask fades each tile out smoothly as it nears the side of
       the bar, rather than clipping it mid-tile
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

    // Land on the real (middle) lap so there's always a full lap of
    // padding to scroll into on either side.
    toolbar.scrollLeft = setWidth;
    toolbar.addEventListener('scroll', onScroll, { passive: true });
  }

  function onScroll() {
    if (!looping || pendingFrame) return;
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = null;
      // Rewinding by exactly one lap the instant a lap is fully crossed
      // keeps the visible tiles identical before and after the jump, so
      // nothing appears to skip — the wheel simply keeps turning.
      if (toolbar.scrollLeft <= 0) {
        toolbar.scrollLeft += setWidth;
      } else if (toolbar.scrollLeft >= setWidth * 2) {
        toolbar.scrollLeft -= setWidth;
      }
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
    if (fits) teardownLoop();
    else buildLoop();
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
