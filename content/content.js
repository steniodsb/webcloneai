'use strict';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'DETECT_FRAMEWORKS') {
    sendResponse({ ok: true, frameworks: detectFrameworks() });
    return false;
  }
  if (message.action === 'EXTRACT_PAGE') {
    extractPage()
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (message.action === 'SCROLL_INFO') {
    sendResponse({
      ok: true,
      totalHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      currentScroll: window.scrollY,
    });
    return false;
  }
  if (message.action === 'SCROLL_TO') {
    window.scrollTo({ top: message.y, behavior: 'instant' });
    setTimeout(() => sendResponse({ ok: true }), 350);
    return true;
  }
  if (message.action === 'SCROLL_TOP') {
    window.scrollTo({ top: 0, behavior: 'instant' });
    setTimeout(() => sendResponse({ ok: true }), 250);
    return true;
  }
});

// ── Framework Detection ──────────────────────────────────────────────────────

function detectFrameworks() {
  const found = [];

  // Tailwind CSS
  const twRe = /\b(flex|grid|gap-\d|p-\d|m-\d|py-|px-|my-|mx-|pt-|pb-|pl-|pr-|mt-|mb-|ml-|mr-|text-(?:sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|white|black|gray|blue|red|green|yellow|purple|pink|indigo|teal|sky)|bg-(?:white|black|transparent|gray|blue|red|green|yellow|purple|pink|indigo|teal|sky)|border-(?:0|2|4|gray|blue|red)|rounded(?:-|\s)|shadow(?:-|\s)|w-(?:\d|full|auto|screen)|h-(?:\d|full|screen)|items-|justify-|font-(?:bold|semibold|medium|normal|light)|leading-|tracking-|opacity-\d|z-\d|overflow-|transition(?:-|\s)|duration-|ease-|hover:|focus:|md:|lg:|xl:)/;
  const hasTailwindScript = !![...document.querySelectorAll('script[src], link[href]')].find(el =>
    (el.src || el.href || '').includes('tailwind')
  );
  const hasTailwindClasses = [...document.querySelectorAll('[class]')].slice(0, 150).some(el =>
    twRe.test(el.className || '')
  );
  if (hasTailwindScript || hasTailwindClasses) {
    found.push({ name: 'Tailwind', color: '#38BDF8', bg: '#0C4A6E' });
  }

  // Bootstrap
  const hasBootstrapLink = !![...document.querySelectorAll('link[href]')].find(el =>
    el.href.includes('bootstrap')
  );
  const hasBootstrapEl = !!document.querySelector('.container.row, .btn-primary, .navbar-brand, .col-md-');
  if (hasBootstrapLink || hasBootstrapEl || window.bootstrap) {
    found.push({ name: 'Bootstrap', color: '#9D60FB', bg: '#3B0764' });
  }

  // Material UI / MUI
  if (document.querySelector('[class*="MuiButton"], [class*="MuiTypography"], [class*="makeStyles-"], [class*="jss"]')) {
    found.push({ name: 'MUI', color: '#42A5F5', bg: '#0D2137' });
  }

  // Shadcn / Radix UI
  if (document.querySelector('[data-radix-popper-content-wrapper], [data-radix-scroll-area-viewport], [data-radix-collection-item], [class*="radix-"]')) {
    found.push({ name: 'shadcn/ui', color: '#E2E8F0', bg: '#1E293B' });
  }

  // Framer
  if (window.__framer_website || document.querySelector('[data-framer-component-type], [data-framer-page-id], [class*="framer-"]')) {
    found.push({ name: 'Framer', color: '#0055FF', bg: '#001A80' });
  }

  // Ant Design
  if (document.querySelector('[class*="ant-btn"], [class*="ant-input"], [class*="ant-layout"]')) {
    found.push({ name: 'Ant Design', color: '#1677FF', bg: '#001529' });
  }

  // Chakra UI
  if (document.querySelector('[class*="chakra-"]')) {
    found.push({ name: 'Chakra UI', color: '#48BB78', bg: '#1A3028' });
  }

  // Webflow
  if (document.querySelector('[data-wf-page], [data-wf-site]') || window.Webflow) {
    found.push({ name: 'Webflow', color: '#4353FF', bg: '#0D1140' });
  }

  // Next.js
  if (window.__NEXT_DATA__ || document.querySelector('#__NEXT_DATA__')) {
    found.push({ name: 'Next.js', color: '#FFFFFF', bg: '#2D2D2D' });
  }

  // Nuxt
  if (window.__nuxt__ || window.$nuxt) {
    found.push({ name: 'Nuxt', color: '#00DC82', bg: '#0A2B1A' });
  }

  // Vue (sem Nuxt)
  if (!found.some(f => f.name === 'Nuxt')) {
    if (window.Vue || document.querySelector('[data-v-app], [__vue_app__]') ||
        [...document.querySelectorAll('[class]')].some(el => /\bdata-v-/.test(el.outerHTML.slice(0, 200)))) {
      found.push({ name: 'Vue', color: '#42B883', bg: '#0D2B1A' });
    }
  }

  // React (sem Next.js)
  if (!found.some(f => f.name === 'Next.js')) {
    if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || document.querySelector('[data-reactroot]')) {
      found.push({ name: 'React', color: '#61DAFB', bg: '#0C2A35' });
    }
  }

  // Elementor (WordPress)
  if (document.querySelector('[data-elementor-type], .elementor-section, .elementor-widget')) {
    found.push({ name: 'Elementor', color: '#E2368F', bg: '#3A0A22' });
  }

  // Gsap / ScrollTrigger
  if (window.gsap || window.ScrollTrigger || document.querySelector('[data-gsap]')) {
    found.push({ name: 'GSAP', color: '#88CE02', bg: '#223300' });
  }

  // Svelte
  if (document.querySelector('[class*="svelte-"]')) {
    found.push({ name: 'Svelte', color: '#FF3E00', bg: '#3A0E00' });
  }
  // Astro
  if (document.querySelector('astro-island, [astro-island]') ||
      document.querySelector('meta[name="generator"][content*="Astro"]')) {
    found.push({ name: 'Astro', color: '#FF5D01', bg: '#3A1500' });
  }
  // Angular
  if (document.querySelector('[ng-version]') || window.ng) {
    found.push({ name: 'Angular', color: '#DD0031', bg: '#3A000C' });
  }
  // Gatsby
  if (document.querySelector('#___gatsby')) {
    found.push({ name: 'Gatsby', color: '#9D60FB', bg: '#2A0A4A' });
  }
  // WordPress
  if (document.querySelector('link[href*="wp-content"], link[href*="wp-includes"], meta[name="generator"][content*="WordPress"]')) {
    found.push({ name: 'WordPress', color: '#3858E9', bg: '#0A1540' });
  }
  // Shopify
  if (window.Shopify || document.querySelector('link[href*="cdn.shopify"], script[src*="shopify"]')) {
    found.push({ name: 'Shopify', color: '#95BF47', bg: '#1F3008' });
  }
  // Wix
  if (window.wixBiSession || document.querySelector('meta[name="generator"][content*="Wix"]')) {
    found.push({ name: 'Wix', color: '#FAAD4D', bg: '#3A2400' });
  }
  // Squarespace
  if (document.querySelector('meta[name="generator"][content*="Squarespace"]')) {
    found.push({ name: 'Squarespace', color: '#FFFFFF', bg: '#1A1A1A' });
  }
  // jQuery
  if (window.jQuery || (window.$ && window.$.fn && window.$.fn.jquery)) {
    found.push({ name: 'jQuery', color: '#0769AD', bg: '#08283A' });
  }
  // Alpine.js
  if (window.Alpine || document.querySelector('[x-data]')) {
    found.push({ name: 'Alpine.js', color: '#77C1D2', bg: '#16303A' });
  }
  // Three.js / WebGL
  if (window.THREE || document.querySelector('canvas[data-engine*="three"]')) {
    found.push({ name: 'Three.js', color: '#FFFFFF', bg: '#2D2D2D' });
  }
  // Swiper (carrossel)
  if (window.Swiper || document.querySelector('.swiper, .swiper-wrapper, .swiper-slide')) {
    found.push({ name: 'Swiper', color: '#0080FF', bg: '#001A3A' });
  }
  // AOS — Animate On Scroll
  if (window.AOS || document.querySelector('[data-aos]')) {
    found.push({ name: 'AOS', color: '#E6447B', bg: '#3A0E20' });
  }
  // Lenis / Locomotive — smooth scroll
  if (window.Lenis || document.querySelector('html.lenis, [data-scroll-container], [data-scroll]')) {
    found.push({ name: 'Smooth Scroll', color: '#C2A878', bg: '#2A2210' });
  }
  // Lottie
  if (window.lottie || document.querySelector('lottie-player, dotlottie-player, [class*="lottie"]')) {
    found.push({ name: 'Lottie', color: '#00DDB3', bg: '#003A30' });
  }

  return found;
}

// ── Page Extraction ──────────────────────────────────────────────────────────

async function extractPage() {
  const base = window.location.href;
  const origin = window.location.origin;

  // Full rendered DOM
  const html = document.documentElement.outerHTML;

  // External stylesheet URLs
  const sheetUrls = [];
  for (const link of document.querySelectorAll('link[rel="stylesheet"][href]')) {
    const href = link.href;
    if (href && !href.startsWith('chrome-extension://')) sheetUrls.push(href);
  }

  // Inline style blocks
  const inlineStyles = [];
  for (const style of document.querySelectorAll('style')) {
    const text = style.textContent.trim();
    if (text) inlineStyles.push(text);
  }

  // CSS animations: extract @keyframes from all accessible sheets
  const keyframes = extractKeyframes();

  // CSS custom properties (design tokens)
  const designTokens = extractDesignTokens();

  // Asset URLs
  const imageSet = new Set();
  collectImageUrls(imageSet, base);

  // Mídias (vídeos, áudios, embeds)
  const media = collectMedia(imageSet, base);

  // Design specs computados, SVGs inline, SEO e responsividade
  const designSpec = extractDesignSpec();
  const svgs = extractSvgs();
  const seo = extractSeo();
  const responsive = extractResponsive();

  const meta = {
    title: document.title || 'Projeto Exportado',
    description: document.querySelector('meta[name="description"]')?.content || '',
    lang: document.documentElement.lang || 'pt-BR',
    url: base,
    origin,
    capturedAt: new Date().toISOString(),
    frameworks: detectFrameworks().map(f => f.name),
  };

  return {
    html,
    sheetUrls,
    inlineStyles,
    keyframes,
    designTokens,
    imageUrls: [...imageSet],
    media,
    designSpec,
    svgs,
    seo,
    responsive,
    meta,
  };
}

// ── Design specs computados (valores REAIS resolvidos pelo browser) ───────────

function rgbToHex(c) {
  if (!c) return null;
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return c;
  const parts = m[1].split(',').map(s => parseFloat(s.trim()));
  const [r, g, b, a] = parts;
  if (a !== undefined && a < 0.98) return c; // mantém rgba com transparência
  const h = (n) => Math.round(n).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}

function extractDesignSpec() {
  const colorCount = {};
  const addColor = (c) => {
    if (!c) return;
    const v = c.trim().toLowerCase();
    if (!v || v === 'rgba(0, 0, 0, 0)' || v === 'transparent' || v.includes('inherit')) return;
    colorCount[v] = (colorCount[v] || 0) + 1;
  };

  const els = [...document.querySelectorAll('body *')].slice(0, 3000);
  const shadows = new Set(), gradients = new Set(), radii = new Set();

  for (const el of els) {
    const cs = getComputedStyle(el);
    addColor(cs.backgroundColor);
    addColor(cs.color);
    addColor(cs.borderTopColor);
    if (cs.boxShadow && cs.boxShadow !== 'none') shadows.add(cs.boxShadow);
    const bg = cs.backgroundImage;
    if (bg && bg.includes('gradient')) gradients.add(bg);
    if (cs.borderRadius && cs.borderRadius !== '0px') radii.add(cs.borderRadius);
  }

  const palette = Object.entries(colorCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([c]) => rgbToHex(c));

  const typography = {};
  for (const sel of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'button']) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const cs = getComputedStyle(el);
    typography[sel] = {
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      color: rgbToHex(cs.color),
    };
  }

  return {
    palette: [...new Set(palette)],
    typography,
    shadows: [...shadows].slice(0, 8),
    gradients: [...gradients].slice(0, 8),
    radii: [...radii].slice(0, 8),
  };
}

// ── SVGs inline (ícones reutilizáveis) ────────────────────────────────────────

function extractSvgs() {
  const seen = new Set(), svgs = [];
  for (const svg of document.querySelectorAll('svg')) {
    const html = svg.outerHTML;
    if (html.length < 40 || html.length > 20000) continue;
    const key = html.replace(/\s+/g, '').slice(0, 240);
    if (seen.has(key)) continue;
    seen.add(key);
    svgs.push(html);
    if (svgs.length >= 40) break;
  }
  return svgs;
}

// ── SEO / meta tags ───────────────────────────────────────────────────────────

function extractSeo() {
  const metas = {};
  for (const m of document.querySelectorAll('meta[property^="og:"], meta[name^="twitter:"], meta[name="description"], meta[name="keywords"], meta[name="robots"], meta[name="theme-color"], meta[name="author"]')) {
    const k = m.getAttribute('property') || m.getAttribute('name');
    const v = m.getAttribute('content');
    if (k && v) metas[k] = v;
  }
  const attr = (sel, a) => document.querySelector(sel)?.getAttribute(a) || null;
  const jsonld = [...document.querySelectorAll('script[type="application/ld+json"]')]
    .map(s => s.textContent.trim()).filter(Boolean).slice(0, 5);
  return {
    metas,
    canonical: attr('link[rel="canonical"]', 'href'),
    manifest: attr('link[rel="manifest"]', 'href'),
    appleIcon: attr('link[rel="apple-touch-icon"]', 'href'),
    jsonld,
  };
}

// ── Responsividade / dark mode (a partir das media queries) ───────────────────

function extractResponsive() {
  const breakpoints = new Set();
  let darkMode = false;
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules || []) {
        if (rule instanceof CSSMediaRule) {
          const mt = rule.conditionText || rule.media.mediaText || '';
          const bm = mt.match(/(?:min|max)-width:\s*\d+px/g);
          if (bm) bm.forEach(b => breakpoints.add(b.replace(/\s+/g, ' ')));
          if (/prefers-color-scheme:\s*dark/.test(mt)) darkMode = true;
        }
      }
    } catch (_) {}
  }
  return { breakpoints: [...breakpoints].slice(0, 20), darkMode };
}

// Coleta vídeos, áudios e embeds. Posters e mídias baixáveis vão para o `set`.
function collectMedia(set, base) {
  const abs = (u) => { try { return new URL(u, base).href; } catch { return null; } };
  const addable = (u) => { const a = abs(u); if (a && !a.startsWith('data:') && !a.startsWith('blob:')) { set.add(a); return a; } return a; };

  const videos = [];
  for (const v of document.querySelectorAll('video')) {
    const srcs = [];
    if (v.getAttribute('src')) srcs.push(addable(v.getAttribute('src')));
    for (const s of v.querySelectorAll('source[src]')) srcs.push(addable(s.getAttribute('src')));
    videos.push({
      src: srcs.filter(Boolean),
      poster: v.getAttribute('poster') ? addable(v.getAttribute('poster')) : null,
      autoplay: v.autoplay, loop: v.loop, muted: v.muted,
    });
  }

  const audios = [];
  for (const a of document.querySelectorAll('audio')) {
    const srcs = [];
    if (a.getAttribute('src')) srcs.push(addable(a.getAttribute('src')));
    for (const s of a.querySelectorAll('source[src]')) srcs.push(addable(s.getAttribute('src')));
    audios.push({ src: srcs.filter(Boolean), loop: a.loop });
  }

  const embeds = [];
  for (const f of document.querySelectorAll('iframe[src]')) {
    const u = abs(f.getAttribute('src'));
    if (u && /^https?:/.test(u)) embeds.push(u);
  }

  return { videos, audios, embeds };
}

function extractKeyframes() {
  const blocks = [];
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules || []) {
        if (rule instanceof CSSKeyframesRule) {
          blocks.push(rule.cssText);
        }
        // Also capture @keyframes inside @media
        if (rule instanceof CSSMediaRule) {
          for (const inner of rule.cssRules || []) {
            if (inner instanceof CSSKeyframesRule) blocks.push(inner.cssText);
          }
        }
      }
    } catch (_) {}
  }
  return [...new Set(blocks)];
}

function extractDesignTokens() {
  const tokens = {};
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules || []) {
        if (rule.style) {
          for (const prop of rule.style) {
            if (prop.startsWith('--')) {
              tokens[prop] = rule.style.getPropertyValue(prop).trim();
            }
          }
        }
      }
    } catch (_) {}
  }
  return tokens;
}

function collectImageUrls(set, base) {
  const add = (url) => {
    try {
      const r = new URL(url, base).href;
      if (!r.startsWith('data:') && !r.startsWith('blob:')) set.add(r);
    } catch (_) {}
  };

  for (const img of document.querySelectorAll('img[src]')) add(img.src);
  for (const el of document.querySelectorAll('[srcset]')) {
    for (const part of el.srcset.split(',')) {
      const u = part.trim().split(/\s+/)[0];
      if (u) add(u);
    }
  }
  for (const el of document.querySelectorAll('[style*="background"]')) {
    const attr = el.getAttribute('style') || '';
    for (const m of attr.matchAll(/url\(['"]?([^'")\s]+)['"]?\)/g)) {
      if (!m[1].startsWith('data:')) add(m[1]);
    }
  }
  for (const link of document.querySelectorAll('link[rel*="icon"][href]')) add(link.href);
  const og = document.querySelector('meta[property="og:image"][content]');
  if (og) add(og.content);
}
