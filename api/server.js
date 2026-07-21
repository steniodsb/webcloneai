'use strict';

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const crypto   = require('crypto');
const path     = require('path');
const fs       = require('fs');
const fetch    = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));

// ── Configuração ──────────────────────────────────────────────────────────────
const {
  ASAAS_API_KEY,
  ASAAS_SANDBOX,          // 'true' para ambiente de testes
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,   // chave service_role (secreta) — NÃO é a anon key
  WEBHOOK_SECRET,         // string secreta para validar webhooks Asaas
  RESEND_API_KEY,         // chave do Resend — entrega confiável de e-mail
  RESEND_FROM = 'Web Clone AI <acesso@webcloneai.com.br>',
  ADMIN_EMAIL = 'admin@webcloneai.com.br',  // e-mail de login do painel admin
  ADMIN_PASSWORD,         // senha do painel admin (defina na env — sem ela o admin fica bloqueado)
  ADMIN_SECRET,           // segredo p/ assinar o token de sessão do admin
  PORT = 3000,
} = process.env;

const ADMIN_TOKEN_SECRET = ADMIN_SECRET || WEBHOOK_SECRET || 'troque-este-segredo';

const ASAAS_BASE = ASAAS_SANDBOX === 'true'
  ? 'https://sandbox.asaas.com/api/v3'
  : 'https://api.asaas.com/api/v3';

// ── Validação de CPF ──────────────────────────────────────────────────────────

function validarCPF(cpf) {
  cpf = cpf.replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf[i]) * (10 - i);
  let r = (sum * 10) % 11;
  if (r === 10 || r === 11) r = 0;
  if (r !== parseInt(cpf[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf[i]) * (11 - i);
  r = (sum * 10) % 11;
  if (r === 10 || r === 11) r = 0;
  return r === parseInt(cpf[10]);
}

// ── Helpers Asaas ─────────────────────────────────────────────────────────────

async function asaas(method, path, body) {
  const res = await fetch(`${ASAAS_BASE}${path}`, {
    method,
    headers: {
      'access_token': ASAAS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.errors?.[0]?.description || `Asaas error ${res.status}`);
  return json;
}

async function asaasCreateCustomer(data) {
  return asaas('POST', '/customers', {
    name:            data.name,
    email:           data.email,
    cpfCnpj:         data.cpf,
    notificationDisabled: false,
  });
}

async function asaasCreatePayment(customerId, data) {
  const plan     = data.plan;
  const isCard   = data.paymentMethod === 'card';
  const amount   = 29.90; // só vitalício
  const dueDate  = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  if (plan === 'monthly' && !isCard) {
    // Assinatura mensal PIX — usa /subscriptions
    return asaas('POST', '/subscriptions', {
      customer:      customerId,
      billingType:   'PIX',
      value:         amount,
      nextDueDate:   dueDate,
      cycle:         'MONTHLY',
      description:   'Web Clone AI — Mensal',
    });
  }

  const base = {
    customer:    customerId,
    billingType: isCard ? 'CREDIT_CARD' : 'PIX',
    value:       amount,
    dueDate,
    description: plan === 'monthly' ? 'Web Clone AI — Mensal' : 'Web Clone AI — Vitalício',
  };

  if (isCard) {
    const { card } = data;
    base.creditCard = {
      holderName:      card.holderName,
      number:          card.number,
      expiryMonth:     card.expiryMonth,
      expiryYear:      card.expiryYear,
      ccv:             card.cvv,
    };
    base.creditCardHolderInfo = {
      name:    data.name,
      email:   data.email,
      cpfCnpj: data.cpf,
    };
    base.installmentCount = parseInt(card.installments) || 1;
    base.installmentValue = parseFloat((amount / base.installmentCount).toFixed(2));
  }

  return asaas('POST', '/payments', base);
}

// ── Helpers Supabase (service_role) ──────────────────────────────────────────

async function supaAdmin(method, path, body) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'apikey':         SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Prefer':        'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_description || json.message || `Supabase ${res.status}`);
  return json;
}

// ── E-mail de acesso (Resend, com fallback pro e-mail nativo do Supabase) ─────

async function generateAccessLink(email) {
  const redirect = process.env.PASSWORD_RESET_URL || 'https://webcloneai.com.br/redefinir-senha';
  const r = await supaAdmin('POST', '/auth/v1/admin/generate_link', {
    type:        'recovery',
    email,
    redirect_to: redirect,
  });
  return r?.action_link || r?.properties?.action_link || redirect;
}

async function sendAccessEmail(email) {
  // Sem Resend configurado → cai no e-mail nativo do Supabase (comportamento antigo)
  if (!RESEND_API_KEY) {
    const redirect = process.env.PASSWORD_RESET_URL || 'https://webcloneai.com.br/redefinir-senha';
    await supaAdmin('POST', `/auth/v1/recover?redirect_to=${encodeURIComponent(redirect)}`, { email });
    return;
  }

  const link       = await generateAccessLink(email);
  const membersUrl = process.env.MEMBERS_URL || 'https://webcloneai.com.br/membros';
  const html = `<!doctype html><html><body style="margin:0;background:#0a0b0e;font-family:Arial,Helvetica,sans-serif;padding:32px">
    <div style="max-width:520px;margin:0 auto;background:#111318;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:36px 32px;color:#fff">
      <h1 style="font-size:22px;margin:0 0 8px">Seu acesso ao Web Clone AI</h1>
      <p style="color:#b8bcc4;font-size:15px;line-height:1.6;margin:0 0 24px">Pagamento confirmado! Clique abaixo para <strong style="color:#fff">definir sua senha</strong> e entrar na área de membros — com a extensão e os tutoriais.</p>
      <a href="${link}" style="display:inline-block;background:#fff;color:#0a0b0e;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:100px;font-size:15px">Definir senha e acessar</a>
      <p style="color:#7b8090;font-size:12px;line-height:1.6;margin:26px 0 0">Se o botão não abrir, use este link:<br><span style="color:#a8adb8;word-break:break-all">${link}</span></p>
      <p style="color:#7b8090;font-size:12px;margin:18px 0 0">Área de membros: ${membersUrl}</p>
    </div></body></html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ from: RESEND_FROM, to: [email], subject: 'Seu acesso ao Web Clone AI', html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text().catch(() => '')}`);
}

async function createSupabaseUser(email, plan, asaasCustomerId, asaasPaymentId) {
  // 1. Criar usuário auth
  const userRes = await supaAdmin('POST', '/auth/v1/admin/users', {
    email,
    password:      crypto.randomBytes(12).toString('base64url'),
    email_confirm: true,
  });

  const userId = userRes.id;

  // 2. Criar registro de assinatura
  await supaAdmin('POST', '/rest/v1/subscriptions', [{
    user_id:             userId,
    status:              'active',
    plan,                // 'monthly' | 'lifetime'
    asaas_customer_id:   asaasCustomerId,
    asaas_payment_id:    asaasPaymentId,
  }]);

  // 3. Enviar e-mail de acesso (Resend, com fallback) — best-effort, não derruba o provisioning
  try {
    await sendAccessEmail(email);
  } catch (e) {
    console.error('[email] falha ao enviar acesso:', e.message);
  }

  return userId;
}

async function activateSubscription(asaasCustomerId) {
  const rows = await supaAdmin(
    'GET',
    `/rest/v1/subscriptions?asaas_customer_id=eq.${asaasCustomerId}&select=id,user_id,status&limit=1`,
  );
  if (!rows?.length) return null;

  const { id: subId } = rows[0];
  await supaAdmin('PATCH', `/rest/v1/subscriptions?id=eq.${subId}`, [{ status: 'active' }]);
  return rows[0];
}

async function deactivateSubscription(asaasCustomerId) {
  await supaAdmin(
    'PATCH',
    `/rest/v1/subscriptions?asaas_customer_id=eq.${asaasCustomerId}`,
    [{ status: 'inactive' }]
  );
}

// ── Endpoint: POST /api/checkout ──────────────────────────────────────────────

app.post('/api/checkout', async (req, res) => {
  try {
    const { plan, paymentMethod, name, email, cpf, card } = req.body;

    if (!plan || !paymentMethod || !name || !email || !cpf) {
      return res.status(400).json({ error: 'Dados incompletos.' });
    }

    if (!validarCPF(cpf)) {
      return res.status(400).json({ error: 'CPF inválido.' });
    }

    // 1. Criar ou buscar customer no Asaas
    let customer;
    const existing = await asaas('GET', `/customers?email=${encodeURIComponent(email)}&limit=1`);
    if (existing.totalCount > 0) {
      customer = existing.data[0];
    } else {
      customer = await asaasCreateCustomer({ name, email, cpf });
    }

    // 2. Criar cobrança
    const payment = await asaasCreatePayment(customer.id, { plan, paymentMethod, name, email, cpf, card });

    // Para cartão confirmado de imediato:
    if (paymentMethod === 'card' && (payment.status === 'CONFIRMED' || payment.status === 'RECEIVED')) {
      await createSupabaseUser(email, plan, customer.id, payment.id);
    }

    // Resposta ao front
    res.json({
      status:          payment.status,
      pixCopiaECola:   payment.pixQrCode?.payload,
      pixQrCode:       payment.pixQrCode?.encodedImage,
      expirationDate:  payment.pixQrCode?.expirationDate,
      invoiceUrl:      payment.invoiceUrl,
    });

  } catch (err) {
    console.error('[checkout]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Endpoint: POST /api/webhook/asaas ─────────────────────────────────────────

app.post('/api/webhook/asaas', express.json(), async (req, res) => {
  // Validar assinatura do webhook (se configurado)
  if (WEBHOOK_SECRET) {
    const signature = req.headers['asaas-access-token'];
    if (signature !== WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Assinatura inválida.' });
    }
  }

  const event = req.body;
  console.log('[webhook] evento:', event.event, event.payment?.status || event.subscription?.status);

  try {
    switch (event.event) {
      // Pagamento PIX ou cartão confirmado
      case 'PAYMENT_RECEIVED':
      case 'PAYMENT_CONFIRMED': {
        const { payment } = event;
        if (!payment?.customer) break;

        // Idempotência — ignorar se este pagamento já foi processado
        const dup = await supaAdmin('GET', `/rest/v1/subscriptions?asaas_payment_id=eq.${payment.id}&limit=1`);
        if (dup?.length) break;

        // Buscar dados do customer para obter e-mail
        const cust = await asaas('GET', `/customers/${payment.customer}`);
        const email = cust.email;

        // Verificar se usuário já existe no Supabase
        const existing = await supaAdmin(
          'GET',
          `/rest/v1/subscriptions?asaas_customer_id=eq.${payment.customer}&limit=1`
        );

        if (existing?.length) {
          await activateSubscription(payment.customer);
        } else {
          // Primeiro pagamento — determinar plano pelo valor
          const plan = 'lifetime'; // só vitalício
          await createSupabaseUser(email, plan, payment.customer, payment.id);
        }
        break;
      }

      // Estorno ou reembolso — revogar acesso
      case 'PAYMENT_REFUNDED':
      case 'PAYMENT_CHARGEBACK_REQUESTED':
      case 'PAYMENT_CHARGEBACK_DISPUTE': {
        const { payment } = event;
        if (payment?.customer) {
          await deactivateSubscription(payment.customer);
        }
        break;
      }

      // Assinatura cancelada ou expirada
      case 'SUBSCRIPTION_DELETED':
      case 'SUBSCRIPTION_INACTIVATED': {
        const { subscription } = event;
        if (subscription?.customer) {
          await deactivateSubscription(subscription.customer);
        }
        break;
      }

      default:
        // Ignorar eventos não tratados
        break;
    }
  } catch (err) {
    console.error('[webhook] erro ao processar evento:', err.message);
    return res.status(500).json({ error: err.message });
  }

  res.json({ received: true });
});

// ── Endpoint: GET /api/user/status ────────────────────────────────────────────

app.get('/api/user/status', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'E-mail obrigatório.' });

  try {
    const users = await supaAdmin(
      'GET',
      `/auth/v1/admin/users?email=${encodeURIComponent(email)}&limit=1`
    );
    if (!users?.users?.length) return res.json({ status: 'not_found' });

    const userId = users.users[0].id;
    const subs = await supaAdmin(
      'GET',
      `/rest/v1/subscriptions?user_id=eq.${userId}&select=status,plan&limit=1`
    );

    if (!subs?.length) return res.json({ status: 'none' });
    return res.json({ status: subs[0].status, plan: subs[0].plan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Endpoint: GET /api/payment/status ─────────────────────────────────────────

app.get('/api/payment/status', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'E-mail obrigatório.' });

  try {
    const users = await supaAdmin(
      'GET',
      `/auth/v1/admin/users?email=${encodeURIComponent(email)}&limit=1`
    );
    if (!users?.users?.length) return res.json({ paid: false });

    const userId = users.users[0].id;
    const subs = await supaAdmin(
      'GET',
      `/rest/v1/subscriptions?user_id=eq.${userId}&status=eq.active&select=id&limit=1`
    );
    return res.json({ paid: !!subs?.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Health check ──────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ── Painel admin ──────────────────────────────────────────────────────────────

function signAdminToken() {
  const payload = Buffer.from(JSON.stringify({ e: ADMIN_EMAIL, exp: Date.now() + 8 * 3600 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', ADMIN_TOKEN_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function verifyAdminToken(tok) {
  const [payload, sig] = String(tok || '').split('.');
  if (!payload || !sig) return false;
  const expect = crypto.createHmac('sha256', ADMIN_TOKEN_SECRET).update(payload).digest('base64url');
  if (sig.length !== expect.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now(); }
  catch { return false; }
}
function requireAdmin(req, res, next) {
  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!verifyAdminToken(tok)) return res.status(401).json({ error: 'Não autorizado.' });
  next();
}

app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'Admin não configurado (defina ADMIN_PASSWORD).' });
  const ok = String(email || '').trim().toLowerCase() === ADMIN_EMAIL.toLowerCase() && password === ADMIN_PASSWORD;
  if (!ok) return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
  res.json({ token: signAdminToken() });
});

app.get('/api/admin/subscribers', requireAdmin, async (_req, res) => {
  try {
    const subs = await supaAdmin('GET', '/rest/v1/subscriptions?select=*');
    const emails = {};
    try {
      const u = await supaAdmin('GET', '/auth/v1/admin/users?per_page=1000');
      (u.users || u || []).forEach(x => { emails[x.id] = x.email; });
    } catch (e) { console.error('[admin] falha ao listar users:', e.message); }
    const rows = (subs || []).map(s => ({
      id: s.id, email: emails[s.user_id] || null, plan: s.plan, status: s.status,
      created_at: s.created_at || null, asaas_customer_id: s.asaas_customer_id,
    }));
    res.json({ subscribers: rows, total: rows.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/subscribers/:id/status', requireAdmin, async (req, res) => {
  try {
    const status = req.body?.status === 'active' ? 'active' : 'inactive';
    await supaAdmin('PATCH', `/rest/v1/subscriptions?id=eq.${encodeURIComponent(req.params.id)}`, [{ status }]);
    res.json({ ok: true, status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/subscribers/:id/resend', requireAdmin, async (req, res) => {
  try {
    const rows = await supaAdmin('GET', `/rest/v1/subscriptions?id=eq.${encodeURIComponent(req.params.id)}&select=user_id&limit=1`);
    if (!rows?.length) return res.status(404).json({ error: 'Assinante não encontrado.' });
    const u = await supaAdmin('GET', `/auth/v1/admin/users/${rows[0].user_id}`);
    if (!u?.email) return res.status(404).json({ error: 'E-mail não encontrado.' });
    await sendAccessEmail(u.email);
    res.json({ ok: true, email: u.email });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/billing', requireAdmin, async (_req, res) => {
  try {
    const received  = await asaas('GET', '/payments?limit=100&status=RECEIVED');
    const confirmed = await asaas('GET', '/payments?limit=100&status=CONFIRMED');
    const all = [...(received.data || []), ...(confirmed.data || [])];
    const total = all.reduce((s, p) => s + (p.value || 0), 0);
    const recentes = all.slice(0, 20).map(p => ({
      value: p.value, status: p.status, date: p.paymentDate || p.dateCreated,
      billingType: p.billingType, customer: p.customer,
    }));
    res.json({ totalRecebido: total, pagamentos: all.length, recentes });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Arquivos estáticos (LP, checkout, área de membros) ────────────────────────

const SITE_ROOT = path.join(__dirname, '..');

app.use('/icons',    express.static(path.join(SITE_ROOT, 'icons')));
app.use('/fonts',    express.static(path.join(SITE_ROOT, 'fonts')));
app.use('/checkout', express.static(path.join(SITE_ROOT, 'checkout')));
app.use('/landing',  express.static(path.join(SITE_ROOT, 'landing')));
app.use('/members',  express.static(path.join(SITE_ROOT, 'members')));
app.use('/admin',    express.static(path.join(SITE_ROOT, 'admin')));

app.get('/',                (_req, res) => res.sendFile(path.join(SITE_ROOT, 'landing/index.html')));
app.get('/admin',           (_req, res) => res.sendFile(path.join(SITE_ROOT, 'admin/index.html')));
app.get('/lp',              (_req, res) => res.sendFile(path.join(SITE_ROOT, 'landing/index.html')));
app.get('/membros',         (_req, res) => res.sendFile(path.join(SITE_ROOT, 'members/index.html')));
app.get('/recuperar-senha', (_req, res) => res.sendFile(path.join(SITE_ROOT, 'landing/recuperar-senha.html')));
app.get('/redefinir-senha', (_req, res) => res.sendFile(path.join(SITE_ROOT, 'landing/redefinir-senha.html')));

// ── Download da extensão (ZIP gerado a partir dos arquivos do projeto) ─────────

let _extZip = null;

async function buildExtensionZip() {
  if (_extZip) return _extZip;
  const JSZip = require(path.join(SITE_ROOT, 'lib/jszip.min.js'));
  const zip = new JSZip();

  const addDir = (absDir, rel) => {
    for (const name of fs.readdirSync(absDir)) {
      const abs = path.join(absDir, name);
      const r = rel ? `${rel}/${name}` : name;
      if (fs.statSync(abs).isDirectory()) addDir(abs, r);
      else zip.file(r, fs.readFileSync(abs));
    }
  };

  zip.file('manifest.json', fs.readFileSync(path.join(SITE_ROOT, 'manifest.json')));
  for (const dir of ['popup', 'content', 'background', 'lib', 'icons', 'fonts']) {
    addDir(path.join(SITE_ROOT, dir), dir);
  }

  _extZip = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return _extZip;
}

app.get('/download/web-clone-ai.zip', async (_req, res) => {
  try {
    const buf = await buildExtensionZip();
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', 'attachment; filename="web-clone-ai.zip"');
    res.send(buf);
  } catch (e) {
    console.error('[download]', e.message);
    res.status(500).json({ error: 'Falha ao gerar o pacote da extensão.' });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[Web Clone AI API] rodando na porta ${PORT} — ${ASAAS_SANDBOX === 'true' ? 'SANDBOX' : 'PRODUÇÃO'}`);
});
