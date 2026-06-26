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
    meta,
  };
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
