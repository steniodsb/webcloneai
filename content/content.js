'use strict';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'DETECT_FRAMEWORKS') {
    sendResponse({ ok: true, frameworks: detectFrameworks() });
    return false;
  }
  if (message.action === 'EXTRACT_PAGE') {
    _cloneOverlay.show();
    extractPage()
      .then(data => { _cloneOverlay.finish(); sendResponse({ ok: true, data }); })
      .catch(err => { _cloneOverlay.hide(); sendResponse({ ok: false, error: err.message }); });
    return true;
  }
  if (message.action === 'CLONE_PROGRESS') { _cloneOverlay.step(message.percent, message.message); return false; }
  if (message.action === 'CLONE_DONE')     { _cloneOverlay.finish(); return false; }
  if (message.action === 'CLONE_HIDE')     { _cloneOverlay.hide(); return false; }
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

  // 0. Estabilizar a página ANTES de capturar: rola tudo para disparar lazy-load
  //    de imagens e revelar animações on-scroll (AOS/GSAP), depois espera as
  //    imagens decodificarem. Sem isso, o DOM sai com placeholders e seções ocultas.
  _cloneOverlay.step(6, 'Escaneando e estabilizando a página…');
  await settlePage();

  // Snapshot fiel do DOM renderizado (JS neutralizado) — fallback visual estático
  const html = buildSnapshot(base);

  // HTML COMO O SERVIDOR ENTREGA (source original) — base do mirror rodável.
  // É o que os bundles JS esperam para bootar/hidratar corretamente.
  const servedHtml = await fetchServedHtml(base);

  // TODOS os recursos que a página realmente carregou (JS, CSS, fontes, imagens,
  // mídia, XHR/fetch) via Resource Timing + varredura do DOM.
  _cloneOverlay.step(38, 'Copiando a estrutura da página…');
  const resources = collectResources(base);
  _cloneOverlay.step(64, 'Mapeando ' + resources.length + ' recursos (JS, CSS, fontes)…');

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
  _cloneOverlay.step(82, 'Copiando ' + imageSet.size + ' imagens e mídias…');

  // Design specs computados, SVGs inline, SEO e responsividade
  const designSpec = extractDesignSpec();
  const svgs = extractSvgs();
  const seo = extractSeo();
  const responsive = extractResponsive();

  _cloneOverlay.step(94, 'Extraindo estilos, SVGs e SEO…');
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
    servedHtml,
    resources,
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

// Busca o HTML original entregue pelo servidor (antes do JS montar o DOM).
// É a base correta do mirror: os bundles bootam/hidratam a partir dele.
async function fetchServedHtml(url) {
  try {
    const r = await fetch(url, { credentials: 'include', cache: 'no-store' });
    if (r.ok) {
      const t = await r.text();
      if (/<html[\s>]/i.test(t)) return t;
    }
  } catch (_) {}
  return null; // popup faz fallback para o DOM renderizado
}

// Enumera TODOS os recursos carregados pela página. Resource Timing captura até
// os chunks JS/CSS e fontes que o DOM não referencia diretamente. initiatorType
// permite distinguir asset estático (localizar) de chamada de API (manter origem).
function collectResources(base) {
  const map = new Map(); // absUrl -> initiatorType
  const add = (u, type) => {
    if (!u) return;
    let a; try { a = new URL(u, base).href; } catch { return; }
    if (!/^https?:/i.test(a)) return;
    if (!map.has(a)) map.set(a, type || 'other');
  };

  try {
    for (const e of performance.getEntriesByType('resource')) add(e.name, e.initiatorType);
  } catch (_) {}

  for (const s of document.querySelectorAll('script[src]')) add(s.getAttribute('src'), 'script');
  for (const l of document.querySelectorAll('link[href]')) {
    const rel = (l.getAttribute('rel') || '').toLowerCase();
    if (/stylesheet|preload|modulepreload|icon|manifest|prefetch/.test(rel)) {
      add(l.getAttribute('href'), rel.includes('stylesheet') ? 'css' : 'link');
    }
  }
  for (const im of document.querySelectorAll('img')) {
    if (im.currentSrc) add(im.currentSrc, 'img');
    if (im.getAttribute('src')) add(im.getAttribute('src'), 'img');
  }
  for (const el of document.querySelectorAll('[srcset], [data-srcset]')) {
    const set = el.getAttribute('srcset') || el.getAttribute('data-srcset') || '';
    for (const p of set.split(',')) { const u = p.trim().split(/\s+/)[0]; if (u) add(u, 'img'); }
  }
  for (const v of document.querySelectorAll('video, audio, source, track')) {
    if (v.getAttribute('src')) add(v.getAttribute('src'), 'media');
    if (v.getAttribute('poster')) add(v.getAttribute('poster'), 'img');
  }

  return [...map.entries()].map(([url, type]) => ({ url, type }));
}

// ── Estabilização da página (lazy-load + reveal) ──────────────────────────────

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Rola a página inteira (para baixo e de volta) para forçar o carregamento de
// imagens lazy e disparar animações on-scroll, depois espera as imagens ficarem
// prontas. Ao final, restaura a posição original de scroll.
async function settlePage() {
  const startY = window.scrollY;
  try {
    const step = Math.max(200, Math.round(window.innerHeight * 0.9));
    const maxScrolls = 60; // trava de segurança para páginas muito longas
    let last = -1, i = 0;
    for (; i < maxScrolls; i++) {
      const h = document.documentElement.scrollHeight;
      const y = Math.min(i * step, h);
      window.scrollTo(0, y);
      await _sleep(120);
      if (y >= h - window.innerHeight || y === last) break;
      last = y;
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
    await _sleep(200);
    await waitForImages(2500);
  } catch (_) {
  } finally {
    window.scrollTo(0, startY);
    await _sleep(150);
  }
}

// Espera as <img> visíveis terminarem de decodificar (com timeout global).
function waitForImages(timeoutMs) {
  const imgs = [...document.images].filter(im => im.loading !== 'lazy' || im.getBoundingClientRect().top < document.documentElement.scrollHeight);
  const pending = imgs.filter(im => !im.complete || im.naturalWidth === 0);
  if (!pending.length) return Promise.resolve();
  return Promise.race([
    Promise.all(pending.map(im => new Promise(res => {
      im.addEventListener('load', res, { once: true });
      im.addEventListener('error', res, { once: true });
    }))),
    _sleep(timeoutMs),
  ]);
}

// ── Snapshot fiel do DOM (freeze) ─────────────────────────────────────────────

// Clona o DOM renderizado e o transforma num arquivo estático fiel:
//  • promove atributos lazy (data-src, data-srcset, data-bg) para os reais
//  • fixa o src escolhido pelo browser (currentSrc) para casar com o srcset
//  • remove <script> executável (mantém JSON-LD) — evita que o runtime do
//    framework re-hidrate e destrua o layout capturado
//  • remove integrity/crossorigin (senão o browser bloqueia CSS/JS reescrito)
//  • remove <base>, meta CSP e meta refresh (interferem no arquivo local)
function buildSnapshot(base) {
  // Mapeia o src REAL resolvido pelo browser para cada <img> ANTES de clonar
  // (currentSrc reflete a escolha de srcset/densidade e o lazy já carregado).
  const liveImgs = document.querySelectorAll('img');
  const srcById = new Map();
  liveImgs.forEach((im, i) => {
    im.setAttribute('data-wca-idx', String(i));
    if (im.currentSrc) srcById.set(String(i), im.currentSrc);
  });

  const root = document.documentElement.cloneNode(true);

  // Restaura o DOM vivo (remove o marcador temporário)
  liveImgs.forEach(im => im.removeAttribute('data-wca-idx'));

  // 1. Imagens: aplica o src real e promove atributos de lazy-load
  for (const img of root.querySelectorAll('img')) {
    const idx = img.getAttribute('data-wca-idx');
    img.removeAttribute('data-wca-idx');
    const real = idx && srcById.get(idx);
    const lazy = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') ||
                 img.getAttribute('data-original') || img.getAttribute('data-lazy');
    if (real) img.setAttribute('src', real);
    else if (lazy) img.setAttribute('src', lazy);
    const lazySet = img.getAttribute('data-srcset') || img.getAttribute('data-lazy-srcset');
    if (lazySet && !img.getAttribute('srcset')) img.setAttribute('srcset', lazySet);
    img.removeAttribute('loading');
    img.removeAttribute('data-src'); img.removeAttribute('data-lazy-src');
    img.removeAttribute('data-original'); img.removeAttribute('data-lazy');
  }

  // 2. <source> dentro de <picture>: promove data-srcset
  for (const s of root.querySelectorAll('picture source, video source, audio source')) {
    const ds = s.getAttribute('data-srcset');
    if (ds && !s.getAttribute('srcset')) s.setAttribute('srcset', ds);
    const dsrc = s.getAttribute('data-src');
    if (dsrc && !s.getAttribute('src')) s.setAttribute('src', dsrc);
  }

  // 3. Backgrounds via atributos lazy (data-bg, data-background, data-background-image)
  for (const el of root.querySelectorAll('[data-bg], [data-background], [data-background-image]')) {
    const bg = el.getAttribute('data-bg') || el.getAttribute('data-background') || el.getAttribute('data-background-image');
    if (bg && !/background-image/i.test(el.getAttribute('style') || '')) {
      const prev = el.getAttribute('style') || '';
      el.setAttribute('style', `${prev}${prev && !prev.trim().endsWith(';') ? ';' : ''}background-image:url('${bg}');`);
    }
  }

  // 4. Remove scripts executáveis (mantém JSON-LD e dados estruturados)
  for (const sc of root.querySelectorAll('script')) {
    const type = (sc.getAttribute('type') || '').toLowerCase();
    if (type === 'application/ld+json') continue;
    sc.remove();
  }

  // 5. Remove atributos que bloqueiam recursos reescritos localmente
  for (const el of root.querySelectorAll('[integrity]')) el.removeAttribute('integrity');
  for (const el of root.querySelectorAll('link[crossorigin], script[crossorigin]')) el.removeAttribute('crossorigin');

  // 6. Remove <base>, CSP e refresh que atrapalham o arquivo local
  for (const b of root.querySelectorAll('base')) b.remove();
  for (const m of root.querySelectorAll('meta[http-equiv]')) {
    const eq = (m.getAttribute('http-equiv') || '').toLowerCase();
    if (eq === 'content-security-policy' || eq === 'refresh') m.remove();
  }
  // Preloads/prefetch de JS não têm mais função num snapshot estático
  for (const l of root.querySelectorAll('link[rel="modulepreload"], link[rel="preload"][as="script"], link[rel="prefetch"]')) l.remove();

  return '<!DOCTYPE html>\n' + root.outerHTML;
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

  for (const img of document.querySelectorAll('img')) {
    if (img.currentSrc) add(img.currentSrc);
    if (img.getAttribute('src')) add(img.getAttribute('src'));
  }
  // Atributos de lazy-load comuns (src e srcset adiados)
  for (const el of document.querySelectorAll('[data-src], [data-lazy-src], [data-original], [data-lazy]')) {
    const u = el.getAttribute('data-src') || el.getAttribute('data-lazy-src') ||
              el.getAttribute('data-original') || el.getAttribute('data-lazy');
    if (u) add(u);
  }
  for (const el of document.querySelectorAll('[srcset], [data-srcset], [data-lazy-srcset]')) {
    const set = el.getAttribute('srcset') || el.getAttribute('data-srcset') || el.getAttribute('data-lazy-srcset') || '';
    for (const part of set.split(',')) {
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
  // Backgrounds computados (aplicados por classe CSS) dos elementos visíveis
  for (const el of [...document.querySelectorAll('body *')].slice(0, 2500)) {
    const bg = getComputedStyle(el).backgroundImage;
    if (bg && bg !== 'none' && bg.includes('url(')) {
      for (const m of bg.matchAll(/url\(['"]?([^'")\s]+)['"]?\)/g)) {
        if (!m[1].startsWith('data:')) add(m[1]);
      }
    }
  }
  // Atributos de background lazy
  for (const el of document.querySelectorAll('[data-bg], [data-background], [data-background-image]')) {
    const u = el.getAttribute('data-bg') || el.getAttribute('data-background') || el.getAttribute('data-background-image');
    if (u) add(u);
  }
  for (const link of document.querySelectorAll('link[rel*="icon"][href]')) add(link.href);
  const og = document.querySelector('meta[property="og:image"][content]');
  if (og) add(og.content);
}


// ── Overlay central de clonagem (Shadow DOM — isolado do CSS da página) ───────
const _cloneOverlay = (() => {
  let host, root, fill, pctEl, msgEl, creep, cur = 0, active = false;
  function guard(e) { e.preventDefault(); e.returnValue = ''; return ''; }
  function ensure() {
    if (host) return;
    host = document.createElement('div');
    host.id = '__wca_clone_overlay';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = [
      '<style>',
      ':host{all:initial}',
      '.ov{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(6,7,9,.72);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;animation:wcaFade .3s ease}',
      '@keyframes wcaFade{from{opacity:0}to{opacity:1}}',
      '.card{width:min(420px,90vw);background:linear-gradient(180deg,#0e1015,#0a0c10);border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:34px 32px;color:#fff;box-shadow:0 30px 80px rgba(0,0,0,.6);text-align:center}',
      '.spin{width:64px;height:64px;margin:0 auto 20px;border-radius:50%;background:conic-gradient(from 0deg,transparent 0 22%,#8a94a6,#eef1f5,transparent 80%);animation:wcaRot 1s linear infinite;-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 6px),#000 0);mask:radial-gradient(farthest-side,transparent calc(100% - 6px),#000 0)}',
      '@keyframes wcaRot{to{transform:rotate(360deg)}}',
      '.ttl{font-size:18px;font-weight:700;letter-spacing:-.3px;margin:0}',
      '.pct{font-size:40px;font-weight:700;letter-spacing:-1px;margin:8px 0 2px;background:linear-gradient(100deg,#8a94a6,#fff 55%,#c0c5ce);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}',
      '.bar{height:7px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden;margin:14px 0 12px}',
      '.fill{height:100%;width:0%;border-radius:99px;background:linear-gradient(90deg,#8a94a6,#eef1f5);transition:width .4s cubic-bezier(.3,.7,.3,1)}',
      '.msg{font-size:13.5px;color:rgba(255,255,255,.66);min-height:18px}',
      '.warn{margin-top:22px;padding:12px 14px;border-radius:12px;font-size:12.5px;line-height:1.5;background:rgba(232,180,90,.08);border:1px solid rgba(232,180,90,.28);color:#e8c07a}',
      '@media (prefers-reduced-motion: reduce){.spin{animation:none}}',
      '</style>',
      '<div class="ov"><div class="card">',
      '<div class="spin"></div>',
      '<div class="ttl">Clonando o site</div>',
      '<div class="pct">0%</div>',
      '<div class="bar"><div class="fill"></div></div>',
      '<div class="msg">Preparando…</div>',
      '<div class="warn">⚠️ Não feche nem saia desta aba até a clonagem terminar — isso interrompe a cópia do site.</div>',
      '</div></div>'
    ].join('');
    (document.body || document.documentElement).appendChild(host);
    fill = root.querySelector('.fill'); pctEl = root.querySelector('.pct'); msgEl = root.querySelector('.msg');
  }
  function paint() { if (fill) { fill.style.width = cur + '%'; pctEl.textContent = Math.round(cur) + '%'; } }
  function show() {
    ensure(); active = true; cur = 0; paint();
    window.addEventListener('beforeunload', guard);
    clearInterval(creep);
    creep = setInterval(() => { if (active && cur < 92) { cur = Math.min(92, cur + 0.4); paint(); } }, 400);
  }
  function step(pp, m) { if (typeof pp === 'number') { cur = Math.max(cur, Math.min(99, pp)); paint(); } if (m && msgEl) msgEl.textContent = m; }
  function finish() { active = false; clearInterval(creep); cur = 100; paint(); if (msgEl) msgEl.textContent = 'Pronto! Preparando o download…'; setTimeout(hide, 900); }
  function hide() { active = false; clearInterval(creep); window.removeEventListener('beforeunload', guard); if (host) { host.remove(); host = null; } }
  return { show, step, finish, hide };
})();
