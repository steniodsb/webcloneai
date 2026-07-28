'use strict';

const MAX_ASSET_SIZE   = 20 * 1024 * 1024;
const MAX_ASSETS       = 400;
const MAX_SCREENSHOTS  = 16;
const FETCH_TIMEOUT_MS = 35000;
const SCROLL_WAIT_MS   = 380;
const MAX_IMPORT_DEPTH = 4;

// ─── Utilitários de tela ─────────────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

function setLoginError(msg) {
  const el = document.getElementById('loginError');
  el.textContent = msg;
  el.classList.toggle('hidden', !msg);
}

// Estado de carregando dos botões: mexe em classe/label, nunca no textContent do
// botão (isso apagava o ícone e o spinner que vivem dentro dele).
function setBtnBusy(btn, busy, label) {
  if (!btn) return;
  btn.disabled = busy;
  btn.classList.toggle('is-busy', busy);
  const el = btn.querySelector('#loginLabel, #exportLabel');
  if (el && label) el.textContent = label;
}

// ─── Auth boot ───────────────────────────────────────────────────────────────

async function boot() {
  // 1. Verificar se há sessão válida
  let session;
  try {
    session = await WCA_Auth.getSession();
  } catch (e) {
    session = null;
  }

  if (!session) {
    showScreen('loginScreen');
    return;
  }

  // 2. Verificar assinatura
  let sub;
  try {
    sub = await WCA_Auth.checkSubscription(session.userId, session.accessToken, 'open');
  } catch (e) {
    // Sem conexão ou erro do Supabase — mostra tela de erro suave
    showScreen('loginScreen');
    setLoginError('Falha ao verificar assinatura. Verifique sua conexão.');
    return;
  }

  if (sub.status !== 'active') {
    showScreen('noSubScreen');
    return;
  }

  // 3. Acesso liberado
  showScreen('mainScreen');
  const userEmailEl = document.getElementById('userEmail');
  if (userEmailEl) {
    userEmailEl.textContent = session.email || '';
    document.getElementById('userBar')?.classList.remove('hidden');
  }
  new WebClonerAI();
}

// ─── Login form ───────────────────────────────────────────────────────────────

function initLoginScreen() {
  const loginBtn  = document.getElementById('loginBtn');
  const buyLink   = document.getElementById('buyLink');
  const forgotLink= document.getElementById('forgotLink');
  const emailInp  = document.getElementById('loginEmail');
  const pwdInp    = document.getElementById('loginPassword');

  async function doLogin() {
    const email    = emailInp.value.trim();
    const password = pwdInp.value;
    if (!email || !password) {
      setLoginError('Preencha e-mail e senha.');
      return;
    }
    setBtnBusy(loginBtn, true, 'ENTRANDO...');
    setLoginError('');
    try {
      const session = await WCA_Auth.signIn(email, password);
      const sub = await WCA_Auth.checkSubscription(session.userId, session.accessToken, 'open');
      if (sub.status !== 'active') {
        showScreen('noSubScreen');
        return;
      }
      showScreen('mainScreen');
      const userEmailEl = document.getElementById('userEmail');
      if (userEmailEl) {
        userEmailEl.textContent = session.email || '';
        document.getElementById('userBar')?.classList.remove('hidden');
      }
      new WebClonerAI();
    } catch (err) {
      const msg = err.message?.includes('Invalid login') || err.message?.includes('invalid_grant')
        ? 'E-mail ou senha incorretos.'
        : (err.message || 'Erro ao fazer login.');
      setLoginError(msg);
    } finally {
      setBtnBusy(loginBtn, false, 'ENTRAR');
    }
  }

  loginBtn.addEventListener('click', doLogin);
  pwdInp.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  emailInp.addEventListener('keydown', e => { if (e.key === 'Enter') pwdInp.focus(); });

  // Mostrar/ocultar senha — a senha enviada por e-mail tem 12 chars aleatórios
  const togglePwd = document.getElementById('togglePwd');
  togglePwd?.addEventListener('click', () => {
    const show = pwdInp.type === 'password';
    pwdInp.type = show ? 'text' : 'password';
    document.getElementById('eyeOpen')?.classList.toggle('hidden', show);
    document.getElementById('eyeOff')?.classList.toggle('hidden', !show);
    togglePwd.title = togglePwd.ariaLabel = show ? 'Ocultar senha' : 'Mostrar senha';
    pwdInp.focus();
  });

  emailInp.focus();

  buyLink.addEventListener('click', e => {
    e.preventDefault();
    chrome.tabs.create({ url: WCA_Auth.checkoutUrl });
  });

  forgotLink.addEventListener('click', e => {
    e.preventDefault();
    const base = WCA_Auth.checkoutUrl.replace('/checkout', '');
    chrome.tabs.create({ url: `${base}/recuperar-senha` });
  });
}

// ─── No-subscription screen ───────────────────────────────────────────────────

function initNoSubScreen() {
  document.getElementById('buyBtn')?.addEventListener('click', () => {
    chrome.tabs.create({ url: WCA_Auth.checkoutUrl });
  });
  document.getElementById('logoutNoSub')?.addEventListener('click', async () => {
    await WCA_Auth.signOut();
    showScreen('loginScreen');
    setLoginError('');
  });
}

// ─── Main screen — header actions ────────────────────────────────────────────

function initHeaderActions() {
  document.getElementById('tutoriaisBtn')?.addEventListener('click', () => {
    chrome.tabs.create({ url: WCA_Auth.membersUrl });
  });
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await WCA_Auth.signOut();
    showScreen('loginScreen');
    setLoginError('');
    document.getElementById('userBar')?.classList.add('hidden');
  });
}

// ─── Main cloner class ────────────────────────────────────────────────────────

class WebClonerAI {
  constructor() {
    this.zip       = null;
    this.urlMap    = new Map();
    this.tab       = null;

    this.$  = id => document.getElementById(id);
    this.exportBtn   = this.$('exportBtn');
    this.exportLabel = this.$('exportLabel');
    this.exportIcon  = this.$('exportIcon');
    this.urlText     = this.$('urlText');
    this.frameworksRow   = this.$('frameworksRow');
    this.frameworkBadges = this.$('frameworkBadges');
    this.stepsSection    = this.$('stepsSection');
    this.statusLine      = this.$('statusLine');

    this.steps = {
      dom:      this.$('stepDom'),
      shots:    this.$('stepShots'),
      zip:      this.$('stepZip'),
      download: this.$('stepDownload'),
    };

    this.exportBtn.addEventListener('click', () => this._run());
    initHeaderActions();
    this._init();
  }

  async _init() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      this.tab = tab;
      try {
        const u = new URL(tab.url);
        this.urlText.textContent = u.hostname + (u.pathname !== '/' ? u.pathname : '');
      } catch {
        this.urlText.textContent = tab.url || '—';
      }
      if (!tab.url?.startsWith('http')) return;
      try {
        const res = await chrome.tabs.sendMessage(tab.id, { action: 'DETECT_FRAMEWORKS' });
        if (res?.ok && res.frameworks?.length) {
          this._renderFrameworkBadges(res.frameworks);
        }
      } catch (_) {}
    } catch (_) {}
  }

  // ─── Overlay de progresso na página ────────────────────────────────────────
  // O content script desenha; o popup manda o progresso porque é ele que sabe
  // do trabalho pesado (baixar assets, screenshots, montar o ZIP).
  // Faixas: extração 0-15 · mirror 15-70 · screenshots 70-85 · zip 85-96 · download 96-100
  _progress(percent, message) {
    if (!this.tab?.id) return;
    chrome.tabs.sendMessage(this.tab.id, { action: 'CLONE_PROGRESS', percent, message })
      .catch(() => {});   // aba fechada/navegou — progresso é best-effort
  }

  _overlay(action, extra) {
    if (!this.tab?.id) return Promise.resolve();
    return chrome.tabs.sendMessage(this.tab.id, { action, ...extra }).catch(() => {});
  }

  // Porta viva enquanto a clonagem roda. Fechar o popup mata a orquestração —
  // a porta cai junto e a página avisa "Processo interrompido" na hora, em vez
  // de deixar a barra congelada até o watchdog.
  _openPort() {
    try {
      this._port = chrome.tabs.connect(this.tab.id, { name: 'wca-clone' });
      this._port.onDisconnect.addListener(() => { this._port = null; });
    } catch { this._port = null; }
  }

  _closePort(concluido) {
    if (!this._port) return;
    try {
      if (concluido) this._port.postMessage({ done: true });
      this._port.disconnect();
    } catch {}
    this._port = null;
  }

  _renderFrameworkBadges(frameworks) {
    if (!frameworks.length) return;
    this.frameworkBadges.innerHTML = '';
    for (const fw of frameworks) {
      const span = document.createElement('span');
      span.className = 'fw-badge';
      span.textContent = fw.name;
      span.style.color = fw.color;
      span.style.background = fw.bg + '99';
      span.style.borderColor = fw.color + '55';
      this.frameworkBadges.appendChild(span);
    }
    this.frameworksRow.classList.remove('hidden');
  }

  async _run() {
    // A revalidação de assinatura é uma ida à rede — sem esta trava, dois cliques
    // rápidos disparavam duas clonagens ao mesmo tempo.
    if (this._running) return;
    this._running = true;
    setBtnBusy(this.exportBtn, true, 'VERIFICANDO...');

    try {
      const session = await WCA_Auth.getSession();
      if (!session) { showScreen('loginScreen'); return this._endRun(); }
      const sub = await WCA_Auth.checkSubscription(session.userId, session.accessToken, 'export');
      if (sub.status !== 'active') { showScreen('noSubScreen'); return this._endRun(); }
    } catch {
      this._showStatus('Falha ao verificar a assinatura. Verifique sua conexão.', 'err');
      return this._endRun();
    }

    setBtnBusy(this.exportBtn, true, 'CAPTURANDO...');
    this._resetSteps();
    this.stepsSection.classList.remove('hidden');
    this._hideStatus();

    try {
      const tab = this.tab;
      if (!tab?.id) throw new Error('Nenhuma aba ativa encontrada.');
      if (!tab.url?.startsWith('http')) throw new Error('Só funciona em páginas http/https.');

      const doScreenshots = this.$('toggleScreenshots').checked;
      const doAssets      = this.$('toggleAssets').checked;

      this.zip       = new JSZip();
      this.urlMap    = new Map();   // URL absoluta → path local (/mirror/…)
      this._usedPaths = new Set();
      this._mirroredHosts = new Set(); // hosts com arquivos locais (rewrite de origem)

      // Step 1: capturar página (HTML servido + lista completa de recursos)
      this._stepActive('dom');
      const pageData = await this._extractPage(tab.id);
      this._openPort();   // a partir daqui, fechar o popup avisa a página

      // Base do mirror: o HTML COMO O SERVIDOR ENTREGA (os bundles JS bootam a
      // partir dele). Se não deu para buscar, cai no DOM renderizado.
      const baseHtml = pageData.servedHtml || pageData.html;
      if (!pageData.servedHtml) {
        console.warn('[WCA] HTML servido indisponível — usando DOM renderizado como base.');
      }

      // Espelhar TODOS os recursos estáticos (JS, CSS, fontes, imagens, mídia)
      let mirrorStats = { total: 0, text: 0 };
      if (doAssets) {
        this._progress(15, 'Preparando o download dos arquivos…');
        // Envia o Referer do site original durante o download — libera assets com
        // proteção anti-hotlink (CDNs que respondem 403 a Referer de terceiros).
        await this._setRefererRule(pageData.meta.origin);
        try {
          mirrorStats = await this._mirrorResources(pageData.resources || []);
        } finally {
          await this._clearRefererRule();
        }
      }
      this._stepDone('dom');

      // Step 2: Screenshots
      this._stepActive('shots');
      let shotsCount = 0;
      if (doScreenshots) {
        try {
          this._progress(70, 'Fotografando cada seção da página…');
          const shots = await this._captureScreenshots(tab.id, tab.windowId);
          const folder = this.zip.folder('screenshots');
          for (const { index, data } of shots) {
            folder.file(`section_${String(index).padStart(2,'0')}.jpg`, data, { base64: true });
          }
          shotsCount = shots.length;
        } catch (e) {
          console.warn('[WCA] Screenshots:', e.message);
        }
      }
      this._stepDone('shots');

      // Step 3: montar o pacote
      this._stepActive('zip');
      this._progress(85, 'Montando o pacote do site…');

      // index.html = HTML servido, com todas as URLs reescritas para o mirror
      // local e o JS PRESERVADO → roda idêntico com `npx serve`.
      this.zip.file('index.html', this._rewriteMirrorHtml(baseHtml, pageData.meta, true));

      // snapshot.html = fallback visual estático (DOM renderizado, sem JS)
      this.zip.file('snapshot.html', this._rewriteMirrorHtml(pageData.html, pageData.meta, false));

      this.zip.file('PROMPT.md', this._generatePrompt(pageData.meta, pageData, [], shotsCount));
      this.zip.file('README.md', this._generateReadme(pageData.meta, mirrorStats.total));
      this.zip.file('DESIGN.md', this._generateDesignDoc(pageData));

      // Relatório de diagnóstico: recursos que falharam no download e por quê
      this.zip.file('_MIRROR-REPORT.txt', this._generateMirrorReport(pageData, mirrorStats));

      // SVGs inline extraídos como arquivos reutilizáveis
      if (pageData.svgs?.length) {
        const iconsFolder = this.zip.folder('assets/icons');
        pageData.svgs.forEach((svg, i) => {
          let s = svg;
          if (!/xmlns=/i.test(s)) s = s.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
          iconsFolder.file(`icon_${i + 1}.svg`, s);
        });
      }

      // JSON-LD (schema.org) preservado
      if (pageData.seo?.jsonld?.length) {
        const ldFolder = this.zip.folder('assets/jsonld');
        pageData.seo.jsonld.forEach((j, i) => ldFolder.file(`schema_${i + 1}.json`, j));
      }
      this._stepDone('zip');

      // Step 4: Download
      this._stepActive('download');
      this._progress(96, 'Compactando o ZIP…');
      const blob = await this.zip.generateAsync({
        type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 },
      });
      const url = URL.createObjectURL(blob);
      const filename = 'pagecloner_' + this._slugify(pageData.meta.title) + '.zip';
      await chrome.downloads.download({ url, filename, saveAs: false });
      this._stepDone('download');

      this._closePort(true);
      this._overlay('CLONE_DONE');
      this._showStatus(`✓ ${filename} salvo com sucesso!`, 'ok');

    } catch (err) {
      console.error('[WCA]', err);
      this._closePort(true);   // o erro já explica; não é "popup fechado"
      this._overlay('CLONE_FAIL', { reason: err.message });
      this._showStatus(err.message, 'err');
    } finally {
      this._endRun();
    }
  }

  _endRun() {
    this._closePort(true);
    this._running = false;
    setBtnBusy(this.exportBtn, false, 'CLONAR E BAIXAR');
  }

  async _captureScreenshots(tabId, windowId) {
    const shots = [];
    await this._ensureContentScript(tabId);
    // O overlay cobre a tela inteira — sem tirá-lo da frente, ele apareceria em
    // TODOS os screenshots. Fica escondido durante a rolagem e volta no fim.
    await this._overlay('CLONE_MASK', { on: true });
    try {
      return await this._captureLoop(tabId, windowId, shots);
    } finally {
      await this._overlay('CLONE_MASK', { on: false });
    }
  }

  async _captureLoop(tabId, windowId, shots) {
    await chrome.tabs.sendMessage(tabId, { action: 'SCROLL_TOP' });
    await this._delay(500);
    const info = await chrome.tabs.sendMessage(tabId, { action: 'SCROLL_INFO' });
    const { totalHeight, viewportHeight } = info;
    const steps = Math.min(MAX_SCREENSHOTS, Math.ceil(totalHeight / viewportHeight));
    for (let i = 0; i < steps; i++) {
      await chrome.tabs.sendMessage(tabId, { action: 'SCROLL_TO', y: i * viewportHeight });
      await this._delay(SCROLL_WAIT_MS);
      const res = await new Promise(resolve => {
        chrome.runtime.sendMessage({ action: 'CAPTURE_TAB', windowId }, r =>
          resolve(r || { ok: false })
        );
      });
      if (res.ok) {
        shots.push({ index: i + 1, data: res.dataUrl.split(',')[1] });
        this._updateStepLabel('shots', `Screenshot ${i + 1}/${steps}`);
        this._progress(70 + Math.round(((i + 1) / steps) * 14), null);
      }
    }
    await chrome.tabs.sendMessage(tabId, { action: 'SCROLL_TOP' });
    return shots;
  }

  async _extractPage(tabId) {
    await this._ensureContentScript(tabId);
    const res = await chrome.tabs.sendMessage(tabId, { action: 'EXTRACT_PAGE' });
    if (!res?.ok) throw new Error(res?.error || 'Falha ao extrair a página.');
    return res.data;
  }

  async _ensureContentScript(tabId) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { action: 'DETECT_FRAMEWORKS' });
      if (res?.ok) return;
    } catch (_) {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content/content.js'] });
    }
  }

  async _fetchStylesheets(urls, origin) {
    const files = new Array(urls.length).fill(null);
    const CONCURRENT = 5;
    for (let i = 0; i < urls.length; i += CONCURRENT) {
      await Promise.all(
        urls.slice(i, i + CONCURRENT).map(async (url, j) => {
          const idx = i + j;
          const path = `styles/sheet_${idx + 1}.css`;
          this._updateStepLabel('dom', `CSS ${idx + 1}/${urls.length}`);
          try {
            let content = await this._fetchText(url);
            // Segue @import recursivamente e absolutiza todas as url() do arquivo
            content = await this._resolveCss(content, url, 0);
            this.urlMap.set(url, path);
            files[idx] = { url, path, content };
          } catch (_) {
            // Não adicionar arquivo vazio — omitir sheet com falha
            files[idx] = null;
          }
        })
      );
    }
    return files.filter(Boolean);
  }

  // Converte toda url(...) relativa para absoluta (relativa ao baseUrl da folha).
  // Assim o rewrite posterior (absoluto → path local) casa de forma consistente.
  _absolutizeCss(css, baseUrl) {
    return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, raw) => {
      const u = raw.trim();
      if (!u || /^(data:|blob:|#|https?:)/i.test(u)) {
        return u.startsWith('//') ? `url("https:${u}")` : m;
      }
      try { return `url("${new URL(u, baseUrl).href}")`; } catch { return m; }
    });
  }

  // Resolve @import (inline recursivo) e absolutiza url(). depth trava recursão.
  async _resolveCss(css, baseUrl, depth) {
    css = this._absolutizeCss(css, baseUrl);
    if (depth >= MAX_IMPORT_DEPTH) return css;

    const importRe = /@import\s+(?:url\(\s*)?["']?([^"')\s]+)["']?\s*\)?\s*([^;]*);/gi;
    const jobs = [];
    css.replace(importRe, (full, href, media) => {
      jobs.push({ full, href, media: (media || '').trim() });
      return full;
    });
    if (!jobs.length) return css;

    for (const job of jobs) {
      let abs;
      try { abs = new URL(job.href, baseUrl).href; } catch { continue; }
      try {
        const imported = await this._fetchText(abs);
        let resolved = await this._resolveCss(imported, abs, depth + 1);
        if (job.media) resolved = `@media ${job.media} {\n${resolved}\n}`;
        css = css.replace(job.full, `\n/* @import ${job.href} */\n${resolved}\n`);
      } catch {
        // Import inacessível — remove o @import para não apontar para o original
        css = css.replace(job.full, `/* import falhou: ${job.href} */`);
      }
    }
    return css;
  }

  _collectAssetUrls(pageData, cssFiles) {
    const set = new Set(pageData.imageUrls);
    const addFromCss = (css, base) => {
      for (const m of css.matchAll(/url\(['"]?([^'")\s]+)['"]?\)/g)) {
        const raw = m[1];
        if (raw.startsWith('data:') || raw.startsWith('#')) continue;
        try { set.add(new URL(raw, base).href); } catch (_) {}
      }
    };
    for (const { content, url } of cssFiles) addFromCss(content, url);
    for (const inline of pageData.inlineStyles) addFromCss(inline, pageData.meta.url);

    // Mídias pequenas (vídeo/áudio/poster) baixáveis
    const m = pageData.media || {};
    for (const v of (m.videos || [])) { (v.src || []).forEach(s => s && set.add(s)); if (v.poster) set.add(v.poster); }
    for (const a of (m.audios || [])) { (a.src || []).forEach(s => s && set.add(s)); }

    // Fontes primeiro — são poucas e críticas; nunca podem cair fora do limite.
    const isFont = (u) => /\.(woff2?|ttf|otf|eot)(\?|#|$)/i.test(u);
    const all = [...set];
    return [...all.filter(isFont), ...all.filter(u => !isFont(u))];
  }

  async _fetchAssets(urls) {
    const limited = urls.slice(0, MAX_ASSETS);
    const CONCURRENT = 5;
    let fetched = 0;
    for (let i = 0; i < limited.length; i += CONCURRENT) {
      await Promise.all(
        limited.slice(i, i + CONCURRENT).map(async (url, j) => {
          const idx = i + j;
          if (this.urlMap.has(url)) return;
          try {
            const { buffer, mimeType } = await this._fetchBinary(url);
            const ext = this._guessExt(url, mimeType);
            const isFont = /woff2?|ttf|eot|otf/.test(ext);
            const path = `assets/${isFont ? 'fonts' : 'images'}/asset_${idx + 1}.${ext}`;
            this.zip.file(path, buffer);
            this.urlMap.set(url, path);
            fetched++;
          } catch (_) {}
        })
      );
      this._updateStepLabel('zip', `Assets ${Math.min(i + CONCURRENT, limited.length)}/${limited.length}`);
    }
  }

  // ── Mirror: download + reescrita de todos os recursos ──────────────────────

  _hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
    return (h >>> 0).toString(36);
  }

  _hasStaticExt(url) {
    return /\.(js|mjs|cjs|css|woff2?|ttf|otf|eot|png|jpe?g|gif|webp|avif|svg|ico|bmp|mp4|webm|ogg|ogv|mov|m4v|mp3|wav|m4a|flac|wasm|map|riv|lottie|json|glb|gltf|hdr|ktx2|basis|drc|bin|xml|txt|atlas|vtt|srt)(\?|#|$)/i.test(url);
  }

  // Endpoints claramente dinâmicos: mantêm a URL original (dados ao vivo).
  _isDynamicApi(url) {
    return /\/(api|graphql|wp-json|rest|v\d+)\//i.test(url) || /\.(php|aspx?|jsp)(\?|#|$)/i.test(url);
  }

  // Assets estáticos são localizados; só APIs de dados ao vivo mantêm a origem.
  // Rive (.riv), Lottie e JSON de config contam como estáticos — são o que dá
  // vida a sites tipo Webflow+OFF+BRAND (animações, 3D, configs).
  _shouldLocalize(res) {
    const t = res.type;
    if (t === 'xmlhttprequest' || t === 'fetch' || t === 'beacon') {
      return this._hasStaticExt(res.url) && !this._isDynamicApi(res.url);
    }
    return true; // script, css, link, img, media, font, other…
  }

  _assetKind(url, type) {
    if (type === 'css' || /\.css(\?|#|$)/i.test(url)) return 'css';
    if (type === 'script' || /\.(m|c)?js(\?|#|$)/i.test(url)) return 'js';
    return 'binary';
  }

  // Deriva um caminho local preservando host + estrutura de pastas do original.
  // Decodifica percent-encoding (senão o servidor HTTP decodifica a URL e não
  // acha o arquivo salvo com %XX literal — ex.: fontes com vírgula no nome).
  _localPathFor(url) {
    let u; try { u = new URL(url); } catch { return null; }
    const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
    let segs = u.pathname.split('/').map(decode).filter(s => s && s !== '.' && s !== '..');
    let name = segs.join('/');
    if (name === '' || u.pathname.endsWith('/')) name += (name ? '/' : '') + 'index.html';
    if (u.search) {
      const h = this._hashStr(u.search);
      const slash = name.lastIndexOf('/');
      const dot = name.lastIndexOf('.');
      name = dot > slash ? `${name.slice(0, dot)}.q${h}${name.slice(dot)}` : `${name}.q${h}`;
    }
    // Remove chars ilegais em nome de arquivo no Windows (mantém vírgula/espaço)
    name = name.replace(/[<>:"|?*\x00-\x1f]/g, '_');
    const host = u.host.replace(/[^\w.\-]/g, '_');
    let full = `/mirror/${host}/${name}`;
    if (this._usedPaths.has(full)) {
      const dot = full.lastIndexOf('.');
      let n = 2, cand;
      do { cand = dot > full.lastIndexOf('/') ? `${full.slice(0, dot)}~${n}${full.slice(dot)}` : `${full}~${n}`; n++; }
      while (this._usedPaths.has(cand));
      full = cand;
    }
    this._usedPaths.add(full);
    return full;
  }

  // Faz os fetches de download enviarem Referer = site original, driblando
  // proteção anti-hotlink (403). Escopo mínimo: só requests do tipo xhr (que é
  // como o fetch do popup aparece) e apenas durante a janela de download.
  async _setRefererRule(origin) {
    try {
      if (!chrome.declarativeNetRequest?.updateSessionRules) return;
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [8801],
        addRules: [{
          id: 8801,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [{ header: 'referer', operation: 'set', value: origin.replace(/\/$/, '') + '/' }],
          },
          condition: { resourceTypes: ['xmlhttprequest', 'other'] },
        }],
      });
    } catch (e) {
      console.warn('[WCA] regra de Referer indisponível:', e.message);
    }
  }

  async _clearRefererRule() {
    try {
      await chrome.declarativeNetRequest?.updateSessionRules({ removeRuleIds: [8801] });
    } catch (_) {}
  }

  async _mirrorResources(resources) {
    const list = resources.filter(r => this._shouldLocalize(r)).slice(0, MAX_ASSETS);
    const textItems = [];
    const failures = [];
    // Concorrência baixa: muitos assets grandes (bundles JS de 1-2MB) saturam a
    // conexão e estouram o timeout se baixados em paralelo demais.
    const CONCURRENT = 3;
    for (let i = 0; i < list.length; i += CONCURRENT) {
      await Promise.all(list.slice(i, i + CONCURRENT).map(async (res) => {
        const url = res.url;
        if (this.urlMap.has(url)) return;
        const local = this._localPathFor(url);
        if (!local) return;
        const zipPath = local.replace(/^\//, '');
        const kind = this._assetKind(url, res.type);
        try {
          if (kind === 'css' || kind === 'js') {
            const text = await this._fetchText(url);
            this.urlMap.set(url, local);
            this._trackHost(url);
            textItems.push({ url, zipPath, kind, text });
          } else {
            const { buffer } = await this._fetchBinary(url);
            this.urlMap.set(url, local);
            this._trackHost(url);
            this.zip.file(zipPath, buffer);
          }
        } catch (e) {
          // Registra a falha para o relatório (mantém URL original no output)
          failures.push({ url, type: res.type || '?', error: (e && e.message) || String(e) });
        }
      }));
      const done = Math.min(i + CONCURRENT, list.length);
      this._updateStepLabel('dom', `Mirror ${done}/${list.length}`);
      // 15 → 68: o grosso do tempo é aqui (centenas de arquivos)
      this._progress(15 + Math.round((done / list.length) * 53),
                     `Copiando arquivo ${done} de ${list.length} (JS, CSS, fontes, imagens)…`);
    }
    this._progress(69, `Reescrevendo ${textItems.length} arquivos de código…`);
    // 2ª passada: reescrever CSS/JS com o mapa completo de URLs
    for (const it of textItems) {
      const out = it.kind === 'css'
        ? this._rewriteMirrorCss(it.text, it.url)
        : this._rewriteMirrorJs(it.text, it.url);
      this.zip.file(it.zipPath, out);
    }
    return { total: this.urlMap.size, text: textItems.length, attempted: list.length, failures };
  }

  // Substitui todas as URLs conhecidas (absolutas → path local) no texto.
  _applyUrlMap(text) {
    const sorted = [...this.urlMap.entries()].sort((a, b) => b[0].length - a[0].length);
    for (const [orig, local] of sorted) text = text.split(orig).join(local);
    return text;
  }

  _trackHost(url) {
    try { this._mirroredHosts.add(new URL(url).host); } catch (_) {}
  }

  // Reescreve a ORIGEM dos hosts espelhados (https://host → /mirror/host) em
  // JS/CSS. Essencial: bundles montam URLs de assets em runtime concatenando uma
  // base ("https://cdn.io/gl" + "/model.glb") — sem isso, o script pede o asset
  // da origem (403/CORS de localhost) mesmo tendo o arquivo local no mirror.
  _applyHostRewrite(text) {
    if (!this._mirroredHosts || !this._mirroredHosts.size) return text;
    const hosts = [...this._mirroredHosts].sort((a, b) => b.length - a.length);
    for (const h of hosts) {
      // https://host e http://host → /mirror/host  (origem absoluta)
      text = text.split('https://' + h).join('/mirror/' + h);
      text = text.split('http://' + h).join('/mirror/' + h);
    }
    return text;
  }

  _absolutizeCssAll(css, base) {
    css = this._absolutizeCss(css, base);
    css = css.replace(/@import\s+(?!url\()(['"])([^'"]+)\1/gi, (m, q, href) => {
      try { return `@import "${new URL(href, base).href}"`; } catch { return m; }
    });
    return css;
  }

  _rewriteMirrorCss(css, baseUrl) {
    return this._applyHostRewrite(this._applyUrlMap(this._absolutizeCssAll(css, baseUrl)));
  }

  _rewriteMirrorJs(js, baseUrl) {
    let origin = ''; try { origin = new URL(baseUrl).origin; } catch {}
    // Coleta os alvos: URL absoluta e, para same-origin, a forma absoluta-da-raiz
    // ("/_next/…") usada como literal nos bundles (só paths longos/únicos).
    const table = new Map();
    for (const [orig, local] of this.urlMap.entries()) {
      table.set(orig, local);
      if (origin && orig.startsWith(origin)) {
        const rel = orig.slice(origin.length);
        if (rel.length >= 10 && !table.has(rel)) table.set(rel, local);
      }
    }
    if (table.size) {
      // Passada ÚNICA com alternância (mais longo primeiro) — evita recompor um
      // trecho já substituído (o path é substring do path local resultante).
      const keys = [...table.keys()].sort((a, b) => b.length - a.length);
      const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(keys.map(esc).join('|'), 'g');
      js = js.replace(re, m => table.get(m) || m);
    }
    // Reescreve origens de hosts espelhados (para URLs montadas em runtime)
    return this._applyHostRewrite(js);
  }

  // Rede de segurança injetada no mirror: se o site tiver preloader/cortina de
  // transição controlada por JS que não rodou (comum em Webflow/GSAP/Lenis),
  // a página trava numa tela de carregamento. Este script detecta a tela travada
  // e revela o conteúdo. Só age SE estiver realmente travada (não quebra clones ok).
  _safetyNetScript() {
    return `<script>/* Web Clone AI — anti-preloader */(function(){
  var DELAY=4000;
  function vw(){return window.innerWidth||document.documentElement.clientWidth||0;}
  function vh(){return window.innerHeight||document.documentElement.clientHeight||0;}
  function n(v){return parseFloat(v)||0;}
  function solid(cs){return cs.backgroundColor&&cs.backgroundColor!=='rgba(0, 0, 0, 0)'&&cs.backgroundColor!=='transparent';}
  // Detecta overlays sólidos que cobrem a tela toda a partir do canto (cortinas
  // de transição/preloader controladas por JS que não rodou).
  function isCover(el){var cs=getComputedStyle(el);
    if(cs.display==='none'||cs.visibility==='hidden'||n(cs.opacity||'1')<0.1)return false;
    if(cs.position!=='fixed'&&cs.position!=='absolute')return false;
    if(!solid(cs))return false;
    if(vw()<10||vh()<10)return false;
    var r=el.getBoundingClientRect();
    if(r.width<vw()*0.9||r.height<vh()*0.9)return false;
    if(r.top>5||r.left>5)return false;
    // NÃO exclui overlays com canvas/svg/img dentro: preloaders/cortinas
    // frequentemente têm logo ou animação (Rive) no meio. z-index alto + tela
    // cheia a partir do canto = cortina, não conteúdo.
    return n(cs.zIndex||'0')>=2;}
  function covers(){return [].slice.call(document.querySelectorAll('body *')).filter(isCover);}
  function reveal(){try{
    var de=document.documentElement,b=document.body;
    de.classList.remove('lenis-stopped');
    [de,b].forEach(function(el){if(el){el.style.overflow='visible';el.style.height='auto';}});
    covers().forEach(function(el){el.style.display='none';});
    document.querySelectorAll('[style]').forEach(function(el){var s=el.style;
      if(s.opacity!==''&&n(s.opacity)<0.05)s.opacity='1';
      if(s.visibility==='hidden')s.visibility='visible';});
    window.scrollTo(0,0);
  }catch(e){}}
  function check(){if(covers().length){reveal();console.log('[Web Clone AI] Preloader/cortina travada — conteudo revelado (tecla R para repetir).');}}
  function arm(){setTimeout(check,DELAY);}
  if(document.readyState==='complete')arm();else window.addEventListener('load',arm);
  window.addEventListener('keydown',function(e){var t=(e.target&&e.target.tagName)||'';if((e.key==='r'||e.key==='R')&&!/input|textarea/i.test(t))reveal();});
})();</script>`;
  }

  // Reescreve o HTML mantendo o JS: absolutiza URLs e mapeia para o mirror local.
  // isMirror=true injeta a rede de segurança anti-preloader (não no snapshot).
  _rewriteMirrorHtml(html, meta, isMirror = false) {
    let r = html;
    const base = meta.url;

    // Remove o que atrapalha o arquivo local (base, SRI, CSP, refresh)
    r = r.replace(/<base[^>]*>/gi, '');
    r = r.replace(/\s(integrity|crossorigin)=(["'])[^"']*\2/gi, '');
    r = r.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');
    r = r.replace(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*>/gi, '');

    // Scripts que apontam para localhost/127.0.0.1 são vazamentos de dev-server
    // do site original — nunca resolvem para o usuário final. Neutraliza.
    r = r.replace(/<script[^>]*\ssrc=(["'])(?:https?:)?\/\/(?:localhost|127\.0\.0\.1)[^"']*\1[^>]*>\s*<\/script>/gi, '');

    // Carrega todas as imagens de imediato (sem esperar scroll) — evita seções
    // em branco no clone. O settlePage já garantiu que os srcs reais existem.
    r = r.replace(/\sloading=(["'])lazy\1/gi, '');

    // Absolutiza atributos de URL
    r = r.replace(/\b(src|href|poster|data-src|data-lazy-src|data-original)=(["'])([^"']+)\2/gi,
      (m, attr, q, val) => {
        if (/^(data:|blob:|#|javascript:|mailto:|tel:|https?:)/i.test(val)) return m;
        if (val.startsWith('//')) return `${attr}="https:${val}"`;
        try { return `${attr}="${new URL(val, base).href}"`; } catch { return m; }
      });

    // Absolutiza srcset
    r = r.replace(/\bsrcset=(["'])([^"']+)\1/gi, (m, q, val) => {
      const parts = val.split(',').map(part => {
        const [u, ...rest] = part.trim().split(/\s+/);
        if (!u || /^(data:|blob:)/.test(u)) return part;
        try { const a = u.startsWith('//') ? 'https:' + u : new URL(u, base).href; return [a, ...rest].join(' '); }
        catch { return part; }
      });
      return `srcset="${parts.join(', ')}"`;
    });

    // Absolutiza url() em <style> e style="" inline
    r = r.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, qq, raw) => {
      const u = raw.trim();
      if (!u || /^(data:|blob:|#|https?:)/i.test(u)) return u.startsWith('//') ? `url("https:${u}")` : m;
      try { return `url("${new URL(u, base).href}")`; } catch { return m; }
    });

    // Mapeia absoluto → local
    r = this._applyUrlMap(r);

    // Rede de segurança anti-preloader (só no mirror rodável)
    if (isMirror) {
      const net = this._safetyNetScript();
      if (/<\/body>/i.test(r)) r = r.replace(/<\/body>/i, `${net}\n</body>`);
      else r += net;
    }

    r = r.replace(/<html/i, `<!-- Web Clone AI · mirror | ${meta.url} | ${meta.capturedAt} -->\n<html`);
    if (!/^\s*<!doctype/i.test(r)) r = '<!DOCTYPE html>\n' + r;
    return r;
  }

  _rewriteHtml(html, cssFiles, meta, extraCss = []) {
    let result = html;
    const base = meta.url;

    // 1. Remove <base> (interfere com paths relativos locais)
    result = result.replace(/<base[^>]*>/gi, '');

    // 2. Resolve URLs relativas/protocol-relative para absolutas em atributos src/href
    result = result.replace(
      /\b(src|href|poster|data-src|data-lazy-src|data-bg)=["']([^"']+)["']/gi,
      (match, attr, val) => {
        if (/^(data:|blob:|#|javascript:|https?:|chrome-)/.test(val)) return match;
        try {
          const abs = val.startsWith('//') ? 'https:' + val : new URL(val, base).href;
          return `${attr}="${abs}"`;
        } catch { return match; }
      }
    );

    // 3. Resolve srcset (múltiplas URLs separadas por vírgula)
    result = result.replace(/\bsrcset=["']([^"']+)["']/gi, (match, val) => {
      const parts = val.split(',').map(part => {
        const [url, ...rest] = part.trim().split(/\s+/);
        if (!url || /^(data:|blob:)/.test(url)) return part;
        try {
          const abs = url.startsWith('//') ? 'https:' + url : new URL(url, base).href;
          return [abs, ...rest].join(' ');
        } catch { return part; }
      });
      return `srcset="${parts.join(', ')}"`;
    });

    // 4. Resolve url() dentro de atributos style inline
    result = result.replace(/\bstyle=["']([^"']*url\([^)]+\)[^"']*)["']/gi, (match, styleVal) => {
      const fixed = styleVal.replace(/url\(['"]?([^'")\s]+)['"]?\)/g, (m, u) => {
        if (/^(data:|blob:|#)/.test(u)) return m;
        try {
          const abs = u.startsWith('//') ? 'https:' + u : new URL(u, base).href;
          return `url('${abs}')`;
        } catch { return m; }
      });
      return `style="${fixed}"`;
    });

    // 5. Substituir URLs absolutas pelos paths locais do ZIP
    const sorted = [...this.urlMap.entries()].sort((a, b) => b[0].length - a[0].length);
    for (const [orig, local] of sorted) result = result.split(orig).join(local);

    // 6. Injetar <link> para CSS extras que foram gerados mas não estavam no HTML original
    if (extraCss.length > 0) {
      const tags = extraCss.map(p => `  <link rel="stylesheet" href="${p}">`).join('\n');
      result = result.replace(/<\/head>/i, `${tags}\n</head>`);
    }

    result = result.replace(/<html/i, `<!-- Web Clone AI | ${meta.url} | ${meta.capturedAt} -->\n<html`);
    return result;
  }

  _rewriteCss(css, cssFilePath) {
    const depth = cssFilePath.split('/').length - 1;
    const prefix = '../'.repeat(depth);
    let result = css;
    const sorted = [...this.urlMap.entries()].sort((a, b) => b[0].length - a[0].length);
    for (const [orig, local] of sorted) result = result.split(orig).join(prefix + local);
    return result;
  }

  _formatTokens(tokens) {
    const vars = Object.entries(tokens).map(([k, v]) => `  ${k}: ${v};`).join('\n');
    return `/* Design Tokens — Web Clone AI */\n:root {\n${vars}\n}\n`;
  }

  _generatePrompt(meta, pageData, cssFiles, shotsCount) {
    const fw = meta.frameworks?.length ? meta.frameworks.join(', ') : 'HTML/CSS';

    // Nomes de fontes: dos CSS baixados (se houver) + da tipografia computada
    const fontNames = new Set();
    const skipFont = (n) => !n || ['inherit','sans-serif','serif','monospace','system-ui','ui-sans-serif','ui-serif','-apple-system'].includes(n.toLowerCase());
    for (const { content } of (cssFiles || [])) {
      for (const m of (content || '').matchAll(/font-family:\s*['"]?([A-Za-z0-9 _-]{2,40})['"]?/gi)) {
        const name = m[1].trim().replace(/['"]/g, '');
        if (!skipFont(name)) fontNames.add(name);
      }
    }
    for (const t of Object.values(pageData?.designSpec?.typography || {})) {
      const first = (t.fontFamily || '').split(',')[0].trim().replace(/['"]/g, '');
      if (!skipFont(first)) fontNames.add(first);
    }

    // Extrair tokens de cor
    const colorTokens = Object.entries(pageData?.designTokens || {})
      .filter(([, v]) => /#[0-9a-fA-F]{3,8}|rgba?|hsla?/.test(v))
      .slice(0, 14)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join('\n');

    const shotsSection = shotsCount > 0
      ? `\n## 📸 Screenshots (referência visual obrigatória)\n\nA pasta \`screenshots/\` tem **${shotsCount} imagem${shotsCount > 1 ? 's' : ''}** mostrando cada seção da página como ela aparece no browser.\n\n> **Sempre use essas imagens como referência fiel do design. Elas mostram o resultado final exato que deve ser reproduzido.**\n`
      : '';

    const tokensSection = colorTokens
      ? `\n## 🎨 Paleta (CSS custom properties extraídas)\n\n\`\`\`css\n:root {\n${colorTokens}\n}\n\`\`\`\n`
      : '';

    const fontsSection = fontNames.size
      ? `\n## ✒️ Fontes detectadas\n\n${[...fontNames].slice(0, 8).map(f => `- ${f}`).join('\n')}\n`
      : '';

    // Mídias detectadas
    const mda = pageData?.media || {};
    const mediaParts = [];
    if (mda.videos?.length) mediaParts.push(`- **${mda.videos.length} vídeo(s)**${mda.videos.some(v => v.autoplay) ? ' — há vídeo com autoplay/background' : ''}`);
    if (mda.audios?.length) mediaParts.push(`- **${mda.audios.length} áudio(s)**`);
    if (mda.embeds?.length) {
      const hosts = [...new Set(mda.embeds.map(e => { try { return new URL(e).hostname.replace('www.', ''); } catch { return null; } }).filter(Boolean))].slice(0, 4);
      mediaParts.push(`- **${mda.embeds.length} embed(s)** (${hosts.join(', ')})`);
    }
    const mediaSection = mediaParts.length
      ? `\n## 🎬 Mídias detectadas\n\n${mediaParts.join('\n')}\n\n> Vídeos/áudios pequenos foram baixados para \`assets/\`; os maiores e os embeds (YouTube, etc.) mantêm a URL original no HTML. Reproduza os mesmos comportamentos (autoplay, loop, mudo) no clone.\n`
      : '';

    // Efeitos de movimento
    const motionLibs = (meta.frameworks || []).filter(f => ['GSAP', 'AOS', 'Lottie', 'Swiper', 'Smooth Scroll', 'Framer'].includes(f));
    const motionSection = (motionLibs.length || pageData?.keyframes?.length)
      ? `\n## ✨ Efeitos de movimento\n\n${motionLibs.length ? `Bibliotecas de animação detectadas: **${motionLibs.join(', ')}**.\n\n` : ''}${pageData?.keyframes?.length ? `${pageData.keyframes.length} animação(ões) \`@keyframes\` capturada(s) em \`styles/keyframes.css\`.\n\n` : ''}> O CSS de animações (\`@keyframes\`, \`transition\`, \`transform\`) foi capturado e funciona no clone. Animações controladas por JavaScript (scroll-reveal, parallax, timelines) não são copiadas como código — recrie-as usando as screenshots e estas bibliotecas como referência.\n`
      : '';

    const jsSection = `\n## ⚙️ Como este mirror funciona\n\nEste é um **espelho completo e rodável**: o \`index.html\` é o HTML servido pelo original, com **todo o JavaScript, CSS, fontes e imagens preservados** e as URLs reescritas para os arquivos locais em \`mirror/\`. Rode com \`npx serve .\` — o site funciona igual ao original (menus, carrosséis, animações-JS, etc.).\n\n> **Não abra por \`file://\`** — as URLs são absolutas a partir da raiz e precisam de um servidor local.\n>\n> \`snapshot.html\` é um fallback visual estático (sem JS), caso algum script dependa de API ao vivo. Bibliotecas detectadas: ${(meta.frameworks || []).join(', ') || 'nenhuma'}.\n`;

    return `# Web Clone AI — Instruções para Reprodução

## Site original

| Campo | Valor |
|-------|-------|
| URL | ${meta.url} |
| Título | ${meta.title || '—'} |
| Capturado em | ${meta.capturedAt} |
| Tecnologias | ${fw} |

## Estrutura desta pasta

\`\`\`
index.html            ← MIRROR rodável (HTML servido + JS). Rode: npx serve .
snapshot.html         ← fallback visual estático (DOM renderizado, sem JS)
mirror/               ← todos os recursos por host (js, css, fontes, imagens, mídia)
  <host>/...          ← estrutura de pastas idêntica à do original
screenshots/          ← 📸 REFERÊNCIA VISUAL — olhe aqui primeiro
DESIGN.md             ← 🎨 cores, tipografia e espaçamentos REAIS (computados)
PROMPT.md             ← este arquivo
\`\`\`
${shotsSection}${tokensSection}${fontsSection}${mediaSection}${motionSection}${jsSection}
## 🤖 Prompts prontos para Claude Code / Cursor

### ① Reproduzir exatamente igual
Abra esta pasta no Claude Code (\`claude .\`) e cole:

\`\`\`
Tenho nesta pasta o clone de um site (${meta.url}).

Quero que você reproduza este site exatamente igual ao original:

1. Rode o mirror com \`npx serve .\` e abra no navegador para ver o site funcionando
2. Leia o index.html para entender a estrutura completa (os recursos estão em /mirror/)
3. Analise as imagens em /screenshots/ — elas mostram como cada seção deve ficar visualmente
4. Use o DESIGN.md como fonte de verdade de cores, tipografia e espaçamentos (valores reais computados)
5. Mantenha todos os layouts, animações, hover effects e responsividade
6. Substitua apenas: textos de conteúdo, nome da marca e imagens de placeholder

Tecnologias do original: ${fw}
\`\`\`

### ② Adaptar para o seu produto
\`\`\`
Tenho nesta pasta o clone de ${meta.url}.

Adapte este site para o meu produto:
- Meu produto: [descreva aqui]
- Minha marca: [seu nome]
- Minhas cores: [suas cores]
- Meu público: [quem é seu cliente]

Mantenha toda a estrutura de layout, UX e hierarquia visual.
Use as screenshots em /screenshots/ para entender o que cada seção comunica.
Reescreva todos os textos para o meu contexto. Substitua as imagens por descrições do que colocar.
\`\`\`

### ③ Publicar após personalizar
\`\`\`bash
npx vercel        # deploy em 30 segundos
# ou
npx serve .       # testar localmente na porta 3000
\`\`\`

---
*Gerado por Web Clone AI — webcloneai.com.br*
`;
  }

  _generateMirrorReport(pageData, stats) {
    const fails = stats.failures || [];
    const totalRes = (pageData.resources || []).length;
    const lines = [];
    lines.push('Web Clone AI — Relatório de Mirror');
    lines.push('==================================');
    lines.push(`URL: ${pageData.meta.url}`);
    lines.push(`Capturado em: ${pageData.meta.capturedAt}`);
    lines.push('');
    lines.push(`Recursos detectados na página: ${totalRes}`);
    lines.push(`Assets estáticos tentados: ${stats.attempted ?? '?'}`);
    lines.push(`Baixados para o mirror: ${stats.total}`);
    lines.push(`Falharam: ${fails.length}`);
    lines.push('');
    if (fails.length) {
      lines.push('FALHAS (URL — tipo — erro):');
      lines.push('---------------------------');
      // agrupa por mensagem de erro para facilitar o diagnóstico
      for (const f of fails) lines.push(`[${f.type}] ${f.error}\n    ${f.url}`);
    } else {
      lines.push('Nenhuma falha registrada. 🎉');
    }
    lines.push('');
    lines.push('Obs.: recursos que falharam mantêm a URL original no HTML (carregam');
    lines.push('da web quando o clone é servido com internet). Envie este arquivo');
    lines.push('para diagnóstico se algo estiver faltando.');
    return lines.join('\n');
  }

  _generateReadme(meta, mirrorCount) {
    return `# ${meta.title}

> Mirror completo exportado por **Web Clone AI** de: ${meta.url}

Este é um **espelho rodável** do site: HTML, JavaScript, CSS, fontes e imagens
foram baixados exatamente como o servidor entrega (${mirrorCount} arquivo(s) em \`mirror/\`)
e as URLs foram reescritas para os arquivos locais. O JavaScript foi **mantido**,
então o site roda igual ao original.

## ▶️ Rodar localmente

Precisa de um servidor local (as URLs são absolutas a partir da raiz — não abra
por \`file://\`):

\`\`\`bash
npx serve .
# ou
python -m http.server 8000
\`\`\`

Depois abra \`http://localhost:3000\` (ou :8000).

## Arquivos

- \`index.html\` — o mirror rodável (com JS). **Use este.**
- \`snapshot.html\` — fallback visual estático (DOM já renderizado, sem JS). Útil se algum script do original quebrar offline.
- \`mirror/\` — todos os recursos (js, css, fontes, imagens, mídia) por host.
- \`screenshots/\`, \`DESIGN.md\`, \`PROMPT.md\` — referências para editar/reconstruir.

## Abrir no Claude Code para editar
\`\`\`
claude .
\`\`\`

> ⚠️ Conteúdo dinâmico buscado de uma API ao vivo (feeds, busca, login) mora no
> servidor original e não é copiável offline — essas partes podem ficar vazias
> até você apontar para seus próprios dados.
`;
  }

  _generateDesignDoc(pageData) {
    const d = pageData.designSpec || {};
    const seo = pageData.seo || {};
    const r = pageData.responsive || {};

    const palette = (d.palette || []).length
      ? `## 🎨 Paleta de cores (real, computada)\n\n${d.palette.map(c => `- \`${c}\``).join('\n')}\n`
      : '';

    const typoRows = Object.entries(d.typography || {}).map(([sel, t]) =>
      `| \`${sel}\` | ${t.fontSize} | ${t.fontWeight} | ${t.lineHeight} | ${t.letterSpacing} | \`${t.color}\` |`
    ).join('\n');
    const baseFont = Object.values(d.typography || {})[0]?.fontFamily || '—';
    const typo = typoRows
      ? `## ✒️ Tipografia (computada)\n\nFonte base: ${baseFont}\n\n| Elemento | Tamanho | Peso | Line-height | Letter-spacing | Cor |\n|---|---|---|---|---|---|\n${typoRows}\n`
      : '';

    const shadows = (d.shadows || []).length
      ? `## 🌑 Sombras\n\n${d.shadows.map(s => `- \`${s}\``).join('\n')}\n`
      : '';
    const gradients = (d.gradients || []).length
      ? `## 🌈 Gradientes\n\n${d.gradients.map(g => `- \`${g}\``).join('\n')}\n`
      : '';
    const radii = (d.radii || []).length
      ? `## ⬜ Border-radius\n\n${d.radii.map(x => `\`${x}\``).join(' · ')}\n`
      : '';

    const seoMetas = Object.entries(seo.metas || {});
    const seoSection = (seoMetas.length || seo.canonical || seo.jsonld?.length)
      ? `## 🔎 SEO / Meta\n\n${seoMetas.map(([k, v]) => `- **${k}:** ${v}`).join('\n')}\n${seo.canonical ? `- **canonical:** ${seo.canonical}\n` : ''}${seo.jsonld?.length ? `\n${seo.jsonld.length} bloco(s) JSON-LD (schema.org) preservado(s) em \`assets/jsonld/\`.\n` : ''}`
      : '';

    const respSection = ((r.breakpoints || []).length || r.darkMode)
      ? `## 📱 Responsividade\n\n${r.breakpoints?.length ? `Breakpoints detectados:\n${r.breakpoints.map(b => `- \`@media (${b})\``).join('\n')}\n` : ''}${r.darkMode ? `\n🌙 O site tem **dark mode** (\`prefers-color-scheme: dark\`) — reconstrua os dois temas.\n` : ''}`
      : '';

    const svgSection = pageData.svgs?.length
      ? `## ⭐ Ícones SVG\n\n${pageData.svgs.length} SVG(s) inline extraído(s) para \`assets/icons/\`.\n`
      : '';

    return `# Design System — ${pageData.meta.title}\n\n> Valores extraídos direto do site (computados pelo navegador). Use como referência fiel de cores, tipografia e espaçamentos ao reconstruir.\n\n${palette}\n${typo}\n${shadows}\n${gradients}\n${radii}\n${respSection}\n${seoSection}\n${svgSection}\n---\n*Gerado por Web Clone AI*\n`;
  }

  // Executa `fn` com timeout e retries (backoff). Não repete em erro permanente
  // (403/404/410) — só em rede/timeout/5xx, que costumam ser transitórios.
  async _withRetry(fn, tries = 5) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      try {
        return await fn(ctrl.signal);
      } catch (e) {
        lastErr = e;
        if (/HTTP (40[0-9]|41[0-8])/.test(e.message)) break; // 4xx: não adianta repetir
        if (i < tries - 1) await this._delay(500 * (i + 1));
      } finally { clearTimeout(t); }
    }
    throw lastErr;
  }

  // Tenta baixar pelo service worker (rede estável, bypass CORS, retries); se
  // indisponível, cai para o fetch direto no popup.
  async _swFetch(url, binary) {
    try {
      const res = await chrome.runtime.sendMessage({ action: 'WCA_FETCH', url, binary });
      if (res && res.ok) return res;
    } catch (_) { /* SW indisponível — usa fallback */ }
    return null;
  }

  async _fetchText(url) {
    const sw = await this._swFetch(url, false);
    if (sw) return sw.text;
    return this._withRetry(async (signal) => {
      const res = await fetch(url, { signal, credentials: 'omit' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    });
  }

  async _fetchBinary(url) {
    const sw = await this._swFetch(url, true);
    if (sw) {
      const bin = atob(sw.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      if (bytes.byteLength > MAX_ASSET_SIZE) throw new Error('Arquivo muito grande');
      return { buffer: bytes.buffer, mimeType: sw.mimeType || '' };
    }
    return this._withRetry(async (signal) => {
      const res = await fetch(url, { signal, credentials: 'omit' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const len = parseInt(res.headers.get('content-length') || '0');
      if (len > MAX_ASSET_SIZE) throw new Error('Arquivo muito grande');
      const buffer = await res.arrayBuffer();
      if (buffer.byteLength > MAX_ASSET_SIZE) throw new Error('Arquivo muito grande');
      return { buffer, mimeType: res.headers.get('content-type') || '' };
    });
  }

  _guessExt(url, mimeType) {
    const clean = url.split('?')[0].split('#')[0];
    const fromUrl = clean.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (fromUrl && fromUrl.length >= 2 && fromUrl.length <= 5) return fromUrl;
    const map = {
      'image/jpeg':'jpg','image/png':'png','image/gif':'gif','image/webp':'webp',
      'image/svg+xml':'svg','image/avif':'avif','image/x-icon':'ico',
      'font/woff2':'woff2','font/woff':'woff','font/ttf':'ttf',
    };
    return map[(mimeType||'').split(';')[0].trim()] || 'bin';
  }

  _resetSteps() {
    for (const step of Object.values(this.steps)) {
      step.classList.remove('active', 'done');
      step.querySelector('.step-dot').textContent = '◎';
    }
  }

  _stepActive(key) {
    const el = this.steps[key]; if (!el) return;
    el.classList.add('active');
    el.querySelector('.step-dot').textContent = '●';
  }

  _stepDone(key) {
    const el = this.steps[key]; if (!el) return;
    el.classList.remove('active'); el.classList.add('done');
    el.querySelector('.step-dot').textContent = '✓';
  }

  _updateStepLabel(key, text) {
    const el = this.steps[key];
    if (el) el.querySelector('.step-label').textContent = text;
  }

  _showStatus(msg, type) {
    this.statusLine.textContent = msg;
    this.statusLine.className = `status-line ${type}`;
  }

  _hideStatus() { this.statusLine.className = 'status-line hidden'; }

  _slugify(s) {
    return (s||'projeto').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g,'')
      .replace(/[^\w\s-]/g,'').replace(/\s+/g,'-')
      .replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,40) || 'projeto';
  }

  _delay(ms) { return new Promise(r => setTimeout(r, ms)); }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Selo de versão lido do manifest — serve de sinal visual de que o reload da
  // extensão pegou (já aconteceu de o Chrome servir uma cópia antiga).
  const vt = document.getElementById('versionTag');
  if (vt) { try { vt.textContent = 'V' + chrome.runtime.getManifest().version; } catch {} }

  initLoginScreen();
  initNoSubScreen();
  boot();
});
