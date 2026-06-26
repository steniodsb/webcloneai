'use strict';

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') console.log('[Web Clone AI] Instalado.');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'PING') {
    sendResponse({ ok: true });
    return false;
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
