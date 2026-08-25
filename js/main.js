/* =========================================================
   Site behaviour — shared
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  initPreloader();
  initNav();
  initLegalPages();   // run BEFORE reveal — must adjust DOM first
  initReveal();
  initSplitText();
  initParallaxHero();
  initCursorGlow();
  initMobileMenu();
  initLightbox();
  initMasonry();
  initCountUp();
});

/* ---------- Legal pages: strip generator inline styles ---------- */
function initLegalPages() {
  document.querySelectorAll(".legal-prose [style]").forEach(el => {
    el.removeAttribute("style");
  });
  // Some generators wrap everything in a stray <h1>. Demote to h2
  // to avoid duplicate H1s (we already have one in the hero).
  document.querySelectorAll(".legal-prose > h1, .legal-prose h1").forEach(h1 => {
    const h2 = document.createElement("h2");
    h2.innerHTML = h1.innerHTML;
    h1.replaceWith(h2);
  });
}

/* ---------- Preloader ---------- */
function initPreloader() {
  const pl = document.querySelector(".preloader");
  if (!pl) return;
  const fadeOut = () => pl.classList.add("gone");

  // If this page has a JS-built masonry gallery, wait for it to signal
  // that all images have finished loading. Otherwise fall back to the
  // normal window.load event.
  if (document.querySelector("[data-masonry]")) {
    document.addEventListener("masonry:ready", () => setTimeout(fadeOut, 200), { once: true });
    setTimeout(fadeOut, 8000); // generous failsafe for slow connections
  } else {
    window.addEventListener("load", () => setTimeout(fadeOut, 350));
    setTimeout(fadeOut, 2200); // failsafe
  }
}

/* ---------- Nav scroll state ---------- */
function initNav() {
  const nav = document.querySelector(".nav");
  if (!nav) return;
  const onScroll = () => {
    if (window.scrollY > 12) nav.classList.add("scrolled");
    else nav.classList.remove("scrolled");
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
}

/* ---------- Mobile menu ---------- */
function initMobileMenu() {
  const btn = document.querySelector(".menu-btn");
  const nav = document.querySelector(".nav");
  if (!btn || !nav) return;
  btn.addEventListener("click", () => {
    nav.classList.toggle("menu-open");
    btn.setAttribute("aria-expanded", nav.classList.contains("menu-open"));
  });
  nav.querySelectorAll(".nav-link").forEach(a =>
    a.addEventListener("click", () => nav.classList.remove("menu-open"))
  );
}

/* ---------- Scroll reveal ---------- */
function initReveal() {
  const els = document.querySelectorAll(".reveal");
  if (!els.length) return;

  const isWork      = document.body.classList.contains("page-work");
  const defaultOpts = { threshold: 0.12, rootMargin: "0px 0px -8% 0px" };
  const eagerOpts   = { threshold: 0.08, rootMargin: "0px 0px 8% 0px" };

  // Lazy lookup of `io` inside the callback — that way, after we
  // swap observers below, the new instance is used to unobserve.
  let io;
  const cb = (entries) => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        en.target.classList.add("in");
        io.unobserve(en.target);
      }
    });
  };

  // Start with the conservative threshold everywhere — anything
  // already in the viewport on load reveals, nothing below it does.
  io = new IntersectionObserver(cb, defaultOpts);
  els.forEach(el => io.observe(el));

  // On the work page, switch to the eager observer the moment the
  // user scrolls for the first time — any remaining .reveal element
  // is then re-checked under the looser rule.
  if (isWork) {
    window.addEventListener("scroll", () => {
      io.disconnect();
      io = new IntersectionObserver(cb, eagerOpts);
      document.querySelectorAll(".reveal:not(.in)").forEach(el => io.observe(el));
    }, { once: true, passive: true });
  }
}

/* ---------- Split text rise ---------- */
function initSplitText() {
  document.querySelectorAll("[data-split]").forEach(el => {
    const words = el.textContent.trim().split(/\s+/);
    el.innerHTML = words.map((w, i) =>
      `<span class="split-word"><span style="animation-delay:${i * 0.06}s">${w}</span></span>`
    ).join(" ");
  });
}

/* ---------- Parallax hero ---------- */
function initParallaxHero() {
  // Full-bleed heroes opt out: the scale/translate would crop the image
  // and drift out of sync with the fade mask on .hero-bg.
  const img = document.querySelector(".hero-bg img:not([data-no-parallax])");
  if (!img) return;
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      img.style.transform = `translate3d(0, ${y * 0.25}px, 0) scale(1.08)`;
      ticking = false;
    });
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
}

/* ---------- Cursor glow ---------- */
function initCursorGlow() {
  if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  const g = document.createElement("div");
  g.className = "cursor-glow";
  document.body.appendChild(g);

  let tx = window.innerWidth / 2, ty = window.innerHeight / 2;
  let cx = tx, cy = ty;

  window.addEventListener("mousemove", (e) => {
    tx = e.clientX; ty = e.clientY;
  });

  const tick = () => {
    cx += (tx - cx) * 0.12;
    cy += (ty - cy) * 0.12;
    g.style.transform = `translate3d(${cx}px, ${cy}px, 0) translate(-50%, -50%)`;
    requestAnimationFrame(tick);
  };
  tick();
}

/* ---------- Gallery EXIF metadata (lightbox captions) ---------- */
/* Module-scoped store, populated lazily by loadGalleryMetadata().
   Keys are the numeric file id ("001", "016", …). */
const galleryMetadata = {};
let galleryMetadataLoaded = false;

async function loadGalleryMetadata(base = "imgs/photography_stack/") {
  if (galleryMetadataLoaded) return;
  galleryMetadataLoaded = true;
  const ingest = (arr) => arr.forEach(item => {
    const key = (item.SourceFile || "")
      .replace(/^\.\//, "")
      .replace(/\.[^.]+$/, "");
    if (key) galleryMetadata[key] = item;
  });

  // Primary path: metadata.js loaded via <script> tag set the global.
  // Works on file:// where fetch is blocked.
  if (Array.isArray(window.__galleryMetadata)) {
    ingest(window.__galleryMetadata);
    return;
  }

  // Fallback path: fetch metadata.json (http:// / GitHub Pages).
  try {
    const r = await fetch(`${base}metadata.json`);
    if (!r.ok) return;
    ingest(await r.json());
  } catch { /* file:// or 404 — caption falls back to counter */ }
}

/* Normalise a Canon lens-model string: drop the noisy " IS"/" USM"/
   " STM" suffixes (and their leading space, so no double spaces are
   left behind), and rewrite the "+ Extender RF1.4X" suffix as a
   compact "× 1.4 EXT" badge. */
function cleanLens(lens) {
  if (!lens) return "";
  return lens
    .replace(/ \+ Extender RF1\.4X/gi, " × 1.4 EXT")
    .replace(/ IS\b/g,  "")
    .replace(/ USM\b/g, "")
    .replace(/ STM\b/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/* Build the EXIF caption as HTML — TWO logical groups, each rendered
   on its own line by CSS (display: block):
     Line 1: camera + lens   (joined by " + ")
     Line 2: focal · f/X · shutter · ISO
   The caption is positioned at runtime by positionCaption() so its
   left edge is flush with the rendered image's bottom-left corner. */
function buildExifCaption(url) {
  const num = url.split("/").pop().replace(/\.[^.]+$/, "");
  const m = galleryMetadata[num];
  if (!m) return null;

  // GROUP 1: camera + lens
  // Skip the lens name on iPhone shots — the built-in lens labels
  // (e.g. "iPhone 15 Pro back triple camera 6.86mm f/1.78") are noisy
  // and offer no useful information beyond the camera body.
  const isIPhone = m.Model && /iphone/i.test(m.Model);
  const g1 = [];
  if (m.Model) g1.push(m.Model);
  if (m.LensModel && !isIPhone) {
    const lens = cleanLens(m.LensModel);
    if (lens) g1.push(lens);
  }

  // GROUP 2: focal + exposure triplet
  const g2 = [];
  if (m.FocalLength) {
    const f = parseFloat(m.FocalLength);
    if (Number.isFinite(f)) g2.push(`${f}mm`);
  }
  if (m.Aperture)     g2.push(`f/${m.Aperture}`);
  if (m.ExposureTime) g2.push(`${m.ExposureTime}s`);
  if (m.ISO)          g2.push(`ISO ${m.ISO}`);

  const parts = [];
  if (g1.length) parts.push(`<span class="cap-group">${g1.join(" + ")}</span>`);
  if (g2.length) parts.push(`<span class="cap-group">${g2.join(" · ")}</span>`);

  return parts.length ? parts.join("") : null;
}

/* ---------- Masonry reveal & gallery build ---------- */
/* Determine the photo count. Two paths:
   1) Fetch the `img_count` manifest written by rename.sh. Tiny HTTP
      request, instant — used on http:// and GitHub Pages.
   2) If fetch fails (e.g. opened directly via file://, where browsers
      block fetch as cross-origin), fall back to binary-search probing
      with <img> elements. Slower but works everywhere. */
async function fetchImageCount(base) {
  try {
    const r = await fetch(`${base}img_count`, { cache: "no-store" });
    if (r.ok) {
      const n = parseInt((await r.text()).trim(), 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  } catch { /* fetch unavailable (e.g. file://) — fall through to probe */ }
  return probeCountViaImage(base);
}

async function probeCountViaImage(base, ext = "avif", hardMax = 500) {
  const exists = (n) => new Promise(resolve => {
    const img = new Image();
    img.onload  = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = `${base}${String(n).padStart(3, "0")}.${ext}`;
  });
  let lo = 0, hi = 1;
  while (hi <= hardMax && (await exists(hi))) {
    lo = hi;
    hi *= 2;
  }
  hi = Math.min(hi, hardMax);
  if (hi === hardMax && (await exists(hardMax))) return hardMax;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (await exists(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

async function initMasonry() {
  const m = document.querySelector("[data-masonry]");
  if (!m) return;

  const base = m.dataset.base || "imgs/photography_stack/";
  const ext  = m.dataset.ext  || "avif";
  const maxDisplay = parseInt(m.dataset.maxDisplay, 10) || 30;

  // Kick off metadata fetch in parallel — it loads while we're still
  // resolving the count and shuffling.
  loadGalleryMetadata(base);

  // data-count override → manifest → 0 (giving up gracefully).
  const explicit = parseInt(m.dataset.count, 10);
  const totalImgs = explicit > 0 ? explicit : await fetchImageCount(base);
  if (totalImgs === 0) return;

  // Remember the last batch so a reload guarantees fresh photos.
  const LS_KEY = "gallery.lastSeen";
  let lastSeen = [];
  try { lastSeen = JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch {}

  // Build the available pool: everything except what was shown last time.
  // If we'd be left with too few photos, fall back to the full pool.
  const all = Array.from({ length: totalImgs }, (_, i) => i + 1);
  let pool = all.filter(n => !lastSeen.includes(n));
  if (pool.length < maxDisplay) pool = all.slice();

  // Fisher–Yates shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const order = pool.slice(0, maxDisplay);

  // Persist for the next reload
  try { localStorage.setItem(LS_KEY, JSON.stringify(order)); } catch {}

  // Reshuffle button → reload the page with a fresh selection
  const reshuffleBtn = document.querySelector(".gallery-shuffle");
  if (reshuffleBtn) reshuffleBtn.addEventListener("click", () => location.reload());

  // Build item DOM. Setting img.src already triggers the network load
  // even before the element is attached anywhere.
  const items = order.map((n) => {
    const num = String(n).padStart(3, "0");
    const a = document.createElement("a");
    a.className = "masonry-item";
    a.href = `${base}${num}.${ext}`;
    const img = document.createElement("img");
    img.src = `${base}${num}.${ext}`;
    img.alt = `Photograph #${num}`;
    img.draggable = false;
    a.appendChild(img);
    return a;
  });

  // Update banner now — doesn't depend on image loads.
  const countEl = document.querySelector("[data-count-out]");
  if (countEl) {
    countEl.textContent = totalImgs < 10
      ? String(totalImgs)
      : `${Math.floor(totalImgs / 10) * 10}+`;
  }

  // Wait for every image to load (or fail). Capture each item's aspect
  // ratio so we can balance columns by height instead of by count.
  const meta = await Promise.all(items.map(a => new Promise(resolve => {
    const img = a.querySelector("img");
    const finish = (ar) => resolve({ a, ar });
    if (img.complete && img.naturalWidth > 0) {
      finish(img.naturalHeight / img.naturalWidth);
    } else {
      img.addEventListener("load",
        () => finish(img.naturalHeight / img.naturalWidth),
        { once: true });
      img.addEventListener("error",
        () => finish(null),     // mark broken — will be skipped below
        { once: true });
    }
  })));
  const valid = meta.filter(x => x.ar !== null);

  const colCountFor = (w) => w <= 540 ? 1 : (w <= 900 ? 2 : 3);
  let currentCols = 0;

  // True masonry: every item goes into the currently shortest column.
  // We use aspect ratio (height ÷ width) as a proxy for "how much
  // vertical space this image will occupy" — exact since all columns
  // share the same width.
  const layout = () => {
    const cols = colCountFor(window.innerWidth);
    if (cols === currentCols) return;
    currentCols = cols;
    m.innerHTML = "";
    const tracks = Array.from({ length: cols }, () => {
      const c = document.createElement("div");
      c.className = "masonry-col";
      return c;
    });
    const heights = new Array(cols).fill(0);
    valid.forEach(({ a, ar }) => {
      let minIdx = 0;
      for (let i = 1; i < cols; i++) {
        if (heights[i] < heights[minIdx]) minIdx = i;
      }
      tracks[minIdx].appendChild(a);
      heights[minIdx] += ar;
    });
    // Reset cascade so each column animates top-to-bottom, in parallel
    tracks.forEach(track => {
      Array.from(track.children).forEach((child, ri) => {
        child.style.animationDelay = (Math.min(ri, 20) * 0.05) + "s";
      });
    });
    tracks.forEach(t => m.appendChild(t));
  };

  layout();
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    // layout() guards itself against same-col-count calls, so the URL
    // bar resize on iOS (which doesn't change width) is a no-op.
    resizeTimer = setTimeout(layout, 150);
  });

  // All images settled + layout placed → preloader can fade now.
  document.dispatchEvent(new Event("masonry:ready"));
}

/* ---------- Count-up stat numbers ---------- */
/* Shared by every page with [data-count] stat boxes (homepage,
   herbIQ). Scroll-triggered via IntersectionObserver, runs once per
   element, and short-circuits to the final value under
   prefers-reduced-motion. Decimal separator follows <html lang>. */
function initCountUp() {
  const els = document.querySelectorAll("[data-count]");
  if (!els.length) return;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isGerman = document.documentElement.lang === "de";
  const DEFAULT_POW = 5;
  const DUR = 1600;

  const localeFmt = new Intl.NumberFormat("de-DE");
  const render = (el, value) => {
    const valueSpan = el.querySelector(".count-value");
    if (!valueSpan) return;
    const decimals = parseInt(el.dataset.countDecimals || "0", 10);
    const fmt = el.dataset.countFormat;
    let body;
    if (fmt === "locale") body = localeFmt.format(Math.round(value));
    else if (decimals > 0) body = isGerman
      ? value.toFixed(decimals).replace(".", ",")
      : value.toFixed(decimals);
    else body = String(Math.round(value));
    valueSpan.textContent = body;
  };

  const animate = (el) => {
    const target = parseFloat(el.dataset.count);
    if (reduced) { render(el, target); el.classList.add("count-done"); return; }
    el.dataset.countAnimated = "1";
    const pow = parseFloat(el.dataset.countEasePow) || DEFAULT_POW;
    const ease = t => 1 - Math.pow(1 - t, pow);
    const start = performance.now();
    const step = (now) => {
      const t = Math.min((now - start) / DUR, 1);
      render(el, target * ease(t));
      if (t < 1) requestAnimationFrame(step);
      else el.classList.add("count-done");
    };
    requestAnimationFrame(step);
  };

  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      if (el.dataset.countAnimated) return; // run once
      animate(el);
      io.unobserve(el);
    });
  }, { threshold: 0.4 });

  els.forEach(el => io.observe(el));
}

/* ---------- Lightbox ---------- */
function initLightbox() {
  // If the page links into the photo stack, make sure metadata loads
  // so the lightbox can show EXIF captions on index too (the masonry
  // gallery already triggers this, this covers the gallery-preview).
  if (document.querySelector('a[href*="photography_stack"]')) {
    loadGalleryMetadata();
  }
  const trigger = (selector) => document.querySelectorAll(selector);
  // Build lightbox DOM
  const lb = document.createElement("div");
  lb.className = "lightbox";
  lb.innerHTML = `
    <button class="lightbox-close" aria-label="Close">&times;</button>
    <button class="lightbox-prev"  aria-label="Previous">&larr;</button>
    <button class="lightbox-next"  aria-label="Next">&rarr;</button>
    <img alt="">
    <div class="lightbox-caption"></div>
  `;
  document.body.appendChild(lb);

  const img = lb.querySelector("img");
  const cap = lb.querySelector(".lightbox-caption");

  let items = [];
  let idx = 0;

  const refreshItems = () =>
    items = Array.from(document.querySelectorAll("[data-lightbox], .masonry-item, .gallery-preview a"));

  // Safari (especially iOS) caches the backdrop-filter region of an
  // element. When the lightbox image changes, the prev/next/close
  // buttons keep showing the stale blur of the previous frame until
  // *something* invalidates them — typically a cursor move.
  // The most reliable invalidation: drop backdrop-filter to none for a
  // frame, then restore it. Safari then recomposites against the new
  // content underneath.
  const buttons = [".lightbox-close", ".lightbox-prev", ".lightbox-next"]
    .map(sel => lb.querySelector(sel))
    .filter(Boolean);

  const refreshBackdrops = () => {
    buttons.forEach(b => {
      b.style.webkitBackdropFilter = "none";
      b.style.backdropFilter = "none";
    });
    // Two RAFs so Safari actually paints the "none" state before
    // re-enabling — otherwise the change can get coalesced into a no-op.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        buttons.forEach(b => {
          b.style.webkitBackdropFilter = "";
          b.style.backdropFilter = "";
        });
      });
    });
  };

  // Anchor the caption to the image's bottom-left corner. The image is
  // centered in the viewport with max-width: 92vw / max-height: 86vh, so
  // its actual position depends on its aspect ratio and the viewport.
  // We measure the rendered <img> rect and place the caption just below
  // and flush with the image's left edge.
  const positionCaption = () => {
    if (!img.naturalWidth) return;
    const r = img.getBoundingClientRect();
    if (r.width < 1) return;
    cap.style.left   = `${r.left}px`;
    cap.style.top    = `${r.bottom + 14}px`;
    cap.style.bottom = "auto";
    cap.style.right  = "auto";
  };

  const show = (i) => {
    refreshItems();
    if (!items.length) return;
    idx = (i + items.length) % items.length;
    const el = items[idx];
    const src = el.getAttribute("href") || el.querySelector("img")?.getAttribute("src");
    img.src = src;
    // EXIF-driven caption if metadata is available, else the counter.
    const exif = buildExifCaption(src);
    if (exif) {
      cap.innerHTML = exif;
    } else {
      cap.textContent = `${String(idx + 1).padStart(2, "0")} / ${String(items.length).padStart(2, "0")}`;
    }
    lb.classList.add("open");
    document.body.style.overflow = "hidden";
    // img.decode() resolves when the new image is fully painted — works
    // for cached images too (the load event sometimes doesn't). Fallback
    // to "load" event if decode isn't supported.
    const afterReady = () => {
      refreshBackdrops();
      positionCaption();
    };
    if (typeof img.decode === "function") {
      img.decode().then(afterReady).catch(afterReady);
    } else {
      img.addEventListener("load", afterReady, { once: true });
    }
    // The lightbox opens with a brief scale(0.98)→1 transition; reposition
    // once it settles so the caption sits flush against the final rect.
    setTimeout(positionCaption, 550);
  };
  const close = () => {
    lb.classList.remove("open");
    document.body.style.overflow = "";
  };

  document.body.addEventListener("click", (e) => {
    const t = e.target.closest("[data-lightbox], .masonry-item, .gallery-preview a");
    if (!t) return;
    if (t.tagName === "A" && (t.dataset.noLightbox === "true")) return;
    e.preventDefault();
    refreshItems();
    show(items.indexOf(t));
  });

  lb.querySelector(".lightbox-close").addEventListener("click", close);
  lb.querySelector(".lightbox-prev").addEventListener("click", () => show(idx - 1));
  lb.querySelector(".lightbox-next").addEventListener("click", () => show(idx + 1));
  lb.addEventListener("click", (e) => { if (e.target === lb) close(); });

  document.addEventListener("keydown", (e) => {
    if (!lb.classList.contains("open")) return;
    if (e.key === "Escape")     close();
    if (e.key === "ArrowLeft")  show(idx - 1);
    if (e.key === "ArrowRight") show(idx + 1);
  });

  // Reposition the caption when the viewport (and therefore the
  // image's rendered rect) changes.
  window.addEventListener("resize", () => {
    if (lb.classList.contains("open")) positionCaption();
  }, { passive: true });
}
