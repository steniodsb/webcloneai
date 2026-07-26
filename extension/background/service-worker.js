'use strict';

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') console.log('[Web Clone AI] Instalado.');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'PING') {
    sendResponse({ ok: true });
    return false;
  }

  // Download de asset pelo service worker — contexto de rede mais estável que o
  // popup (bypass de CORS com host_permissions, sobrevive ao popup, sem pressa).
  if (message.action === 'WCA_FETCH') {
    const { url, binary } = message;
    (async () => {
      let lastErr = 'desconhecido';
      for (let i = 0; i < 6; i++) {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 60000);
          let res;
          try {
            res = await fetch(url, { signal: ctrl.signal, credentials: 'omit', cache: 'force-cache' });
          } finally { clearTimeout(t); }
          if (!res.ok) throw new Error('HTTP ' + res.status);
          if (binary) {
            const buf = await res.arrayBuffer();
            const bytes = new Uint8Array(buf);
            let bin = '';
            for (let j = 0; j < bytes.length; j += 0x8000) {
              bin += String.fromCharCode.apply(null, bytes.subarray(j, j + 0x8000));
            }
            sendResponse({ ok: true, base64: btoa(bin), mimeType: res.headers.get('content-type') || '' });
          } else {
            sendResponse({ ok: true, text: await res.text() });
          }
          return;
        } catch (e) {
          lastErr = (e && e.message) || String(e);
          // 4xx permanente não repete; 403/408/429 SIM (hotlink/referer/transitório)
          if (/HTTP (40[0-24-7]|41[0-8])/.test(lastErr)) break;
          await new Promise(r => setTimeout(r, 700 * (i + 1)));
        }
      }
      sendResponse({ ok: false, error: lastErr });
    })();
    return true; // async
  }

  // Captura screenshot da aba ativa (só o SW pode chamar captureVisibleTab)
  if (message.action === 'CAPTURE_TAB') {
    const windowId = message.windowId || null;
    chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 82 }, dataUrl => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ ok: true, dataUrl });
      }
    });
    return true; // async
  }
});
