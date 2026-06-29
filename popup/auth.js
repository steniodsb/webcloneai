'use strict';

// ─── CONFIGURAÇÃO — preencher com credenciais reais após deploy ───────────────
const WCA_CONFIG = {
  supabaseUrl:     'https://cygvhqggcqsemtrfltfk.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5Z3ZocWdnY3FzZW10cmZsdGZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0OTE3OTAsImV4cCI6MjA5ODA2Nzc5MH0.T_tbZPZdn32uQyyQKGIRa-L3-DQydsv8ewi6h2DzFJE',
  membersUrl:      'https://webcloneai.com.br/membros',  // URL da área de membros
  checkoutUrl:     'https://webcloneai.com.br/checkout', // URL do checkout
};

// ─── Supabase REST helper ─────────────────────────────────────────────────────

async function _supa(method, path, body, token) {
  const res = await fetch(`${WCA_CONFIG.supabaseUrl}${path}`, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'apikey':         WCA_CONFIG.supabaseAnonKey,
      'Authorization': `Bearer ${token || WCA_CONFIG.supabaseAnonKey}`,
      'Prefer':        'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json.error_description || json.message || json.msg || `Erro ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

// ─── Autenticação ─────────────────────────────────────────────────────────────

async function wca_signIn(email, password) {
  const data = await _supa('POST', '/auth/v1/token?grant_type=password', { email, password });
  const session = {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token,
    userId:       data.user?.id,
    email:        data.user?.email,
    expiresAt:    Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  await chrome.storage.local.set({ wca_session: session });
  return session;
}

async function wca_signOut() {
  const { wca_session } = await chrome.storage.local.get('wca_session');
  if (wca_session?.accessToken) {
    _supa('POST', '/auth/v1/logout', {}, wca_session.accessToken).catch(() => {});
  }
  await chrome.storage.local.remove('wca_session');
}

async function wca_getSession() {
  const { wca_session } = await chrome.storage.local.get('wca_session');
  if (!wca_session) return null;

  // Renovar token se expira em menos de 5 minutos
  if (Date.now() > wca_session.expiresAt - 300_000) {
    try {
      return await _refreshSession(wca_session.refreshToken);
    } catch {
      await chrome.storage.local.remove('wca_session');
      return null;
    }
  }
  return wca_session;
}

async function _refreshSession(refreshToken) {
  const data = await _supa('POST', '/auth/v1/token?grant_type=refresh_token', {
    refresh_token: refreshToken,
  });
  const session = {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token,
    userId:       data.user?.id,
    email:        data.user?.email,
    expiresAt:    Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  await chrome.storage.local.set({ wca_session: session });
  return session;
}

// ─── Verificação de assinatura ────────────────────────────────────────────────

async function wca_checkSubscription(userId, accessToken) {
  const data = await _supa(
    'GET',
    `/rest/v1/subscriptions?user_id=eq.${userId}&select=status,plan&limit=1`,
    null,
    accessToken
  );
  if (!Array.isArray(data) || data.length === 0) {
    return { status: 'none', plan: null };
  }
  return { status: data[0].status, plan: data[0].plan };
}

// ─── Exporta para o escopo global (não usamos módulos para compatibilidade) ───
window.WCA_Auth = {
  signIn:            wca_signIn,
  signOut:           wca_signOut,
  getSession:        wca_getSession,
  checkSubscription: wca_checkSubscription,
  membersUrl:        WCA_CONFIG.membersUrl,
  checkoutUrl:       WCA_CONFIG.checkoutUrl,
};
