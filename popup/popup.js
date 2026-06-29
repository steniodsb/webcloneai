'use strict';

const MAX_ASSET_SIZE   = 5 * 1024 * 1024;
const MAX_ASSETS       = 80;
const MAX_SCREENSHOTS  = 16;
const FETCH_TIMEOUT_MS = 12000;
const SCROLL_WAIT_MS   = 380;

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
    sub = await WCA_Auth.checkSubscription(session.userId, session.accessToken);
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
    loginBtn.disabled = true;
    loginBtn.textContent = 'ENTRANDO...';
    setLoginError('');
    try {
      const session = await WCA_Auth.signIn(email, password);
      const sub = await WCA_Auth.checkSubscription(session.userId, session.accessToken);
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
      loginBtn.disabled = false;
      loginBtn.textContent = 'ENTRAR';
    }
  }

  loginBtn.addEventListener('click', doLogin);
  pwdInp.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  emailInp.addEventListener('keydown', e => { if (e.key === 'Enter') pwdInp.focus(); });

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
    const session = await WCA_Auth.getSession();
    if (!session) { showScreen('loginScreen'); return; }
    const sub = await WCA_Auth.checkSubscription(session.userId, session.accessToken);
    if (sub.status !== 'active') { showScreen('noSubScreen'); return; }

    this.exportBtn.disabled = true;
    if (this.exportIcon) this.exportIcon.style.display = 'none';
    if (this.exportLabel) this.exportLabel.textContent = 'CAPTURANDO...';
    this._resetSteps();
    this.stepsSection.classList.remove('hidden');
    this._hideStatus();

    try {
      const tab = this.tab;
      if (!tab?.id) throw new Error('Nenhuma aba ativa encontrada.');
      if (!tab.url?.startsWith('http')) throw new Error('Só funciona em páginas http/https.');

      const doScreenshots = this.$('toggleScreenshots').checked;
      const doAnimations  = this.$('toggleAnimations').checked;
      const doAssets      = this.$('toggleAssets').checked;

      this.zip    = new JSZip();
      this.urlMap = new Map();

      // Step 1: DOM + CSS
      this._stepActive('dom');
      const pageData = await this._extractPage(tab.id);
      const cssFiles = await this._fetchStylesheets(pageData.sheetUrls, pageData.meta.origin);

      // Rastrear quais CSS extras foram adicionados para injetar no HTML
      const extraCss = [];
      if (doAnimations && pageData.keyframes.length > 0) {
        this.zip.file('styles/keyframes.css', pageData.keyframes.join('\n\n'));
        extraCss.push('styles/keyframes.css');
      }
      if (Object.keys(pageData.designTokens).length > 0) {
        this.zip.file('styles/tokens.css', this._formatTokens(pageData.designTokens));
        extraCss.push('styles/tokens.css');
      }
      if (pageData.inlineStyles.length > 0) {
        const combined = pageData.inlineStyles.join('\n\n/* --- */\n\n');
        this.zip.file('styles/inline.css', this._rewriteCss(combined, 'styles/inline.css'));
        extraCss.push('styles/inline.css');
      }
      for (const { path, content } of cssFiles) {
        this.zip.file(path, this._rewriteCss(content, path));
      }
      this._stepDone('dom');

      // Step 2: Screenshots
      this._stepActive('shots');
      let shotsCount = 0;
      if (doScreenshots) {
        try {
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

      // Assets
      if (doAssets) {
        const assetUrls = this._collectAssetUrls(pageData, cssFiles);
        await this._fetchAssets(assetUrls);
      }

      // Step 3: ZIP
      this._stepActive('zip');
      const finalHtml = this._rewriteHtml(pageData.html, cssFiles, pageData.meta, extraCss);
      this.zip.file('index.html', finalHtml);
      this.zip.file('PROMPT.md', this._generatePrompt(pageData.meta, pageData, cssFiles, shotsCount));
      this.zip.file('README.md', this._generateReadme(pageData.meta, cssFiles.length));
      this._stepDone('zip');

      // Step 4: Download
      this._stepActive('download');
      const blob = await this.zip.generateAsync({
        type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 },
      });
      const url = URL.createObjectURL(blob);
      const filename = 'pagecloner_' + this._slugify(pageData.meta.title) + '.zip';
      await chrome.downloads.download({ url, filename, saveAs: false });
      this._stepDone('download');

      this._showStatus(`✓ ${filename} salvo com sucesso!`, 'ok');

    } catch (err) {
      console.error('[WCA]', err);
      this._showStatus(err.message, 'err');
    } finally {
      this.exportBtn.disabled = false;
      if (this.exportIcon) this.exportIcon.style.display = '';
      if (this.exportLabel) this.exportLabel.textContent = 'CLONAR E BAIXAR';
    }
  }

  async _captureScreenshots(tabId, windowId) {
    const shots = [];
    await this._ensureContentScript(tabId);
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
            const content = await this._fetchText(url);
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
    for (const inline of pageData.inlineStyles) addFromCss(inline, pageData.meta.origin);
    return [...set];
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

    // Extrair nomes de fontes dos arquivos CSS baixados
    const fontNames = new Set();
    for (const { content } of (cssFiles || [])) {
      for (const m of (content || '').matchAll(/font-family:\s*['"]?([A-Za-z0-9 _-]{2,40})['"]?/gi)) {
        const name = m[1].trim().replace(/['"]/g, '');
        if (name && !['inherit','sans-serif','serif','monospace','system-ui'].includes(name.toLowerCase())) {
          fontNames.add(name);
        }
      }
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
index.html            ← HTML completo renderizado (pronto para abrir)
styles/               ← todos os arquivos CSS
  sheet_1.css ...     ← folhas de estilo externas
  inline.css          ← estilos inline extraídos
  tokens.css          ← design tokens (CSS custom properties)
  keyframes.css       ← animações @keyframes
assets/
  images/             ← todas as imagens
  fonts/              ← todas as fontes
screenshots/          ← 📸 REFERÊNCIA VISUAL — olhe aqui primeiro
PROMPT.md             ← este arquivo
\`\`\`
${shotsSection}${tokensSection}${fontsSection}${mediaSection}${motionSection}
## 🤖 Prompts prontos para Claude Code / Cursor

### ① Reproduzir exatamente igual
Abra esta pasta no Claude Code (\`claude .\`) e cole:

\`\`\`
Tenho nesta pasta o clone de um site (${meta.url}).

Quero que você reproduza este site exatamente igual ao original:

1. Leia o index.html para entender a estrutura completa
2. Analise as imagens em /screenshots/ — elas mostram como cada seção deve ficar visualmente
3. Use os arquivos CSS em /styles/ como referência de cores, tipografia e espaçamentos
4. Mantenha todos os layouts, animações, hover effects e responsividade
5. Substitua apenas: textos de conteúdo, nome da marca e imagens de placeholder

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

  _generateReadme(meta, cssCount) {
    return `# ${meta.title}\n\n> Exportado por **Web Clone AI** de: ${meta.url}\n\n## Abrir no Claude Code\n\`\`\`\nclaude .\n\`\`\`\n\n## Publicar\n\`\`\`\nnpx vercel\n\`\`\`\n`;
  }

  async _fetchText(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    } finally { clearTimeout(t); }
  }

  async _fetchBinary(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const len = parseInt(res.headers.get('content-length') || '0');
      if (len > MAX_ASSET_SIZE) throw new Error('Arquivo muito grande');
      const buffer = await res.arrayBuffer();
      if (buffer.byteLength > MAX_ASSET_SIZE) throw new Error('Arquivo muito grande');
      return { buffer, mimeType: res.headers.get('content-type') || '' };
    } finally { clearTimeout(t); }
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
  initLoginScreen();
  initNoSubScreen();
  boot();
});
