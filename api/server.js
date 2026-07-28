'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express  = require('express');
const cors     = require('cors');
const crypto   = require('crypto');
const path     = require('path');
const fs       = require('fs');
const fetch    = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const app = express();
app.set('trust proxy', true);   // atrás do proxy da WaveHost — IP real do cliente
app.use(express.json());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));

// ── Configuração ──────────────────────────────────────────────────────────────
const {
  ASAAS_API_KEY,
  ASAAS_SANDBOX,          // 'true' para ambiente de testes
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,   // chave service_role (secreta) — NÃO é a anon key
  WEBHOOK_SECRET,         // string secreta para validar webhooks Asaas
  RESEND_API_KEY: RESEND_API_KEY_RAW,  // chave do Resend — entrega confiável de e-mail
  RESEND_FROM = 'Web Clone AI <acesso@webcloneai.com.br>',
  ADMIN_EMAILS = 'contato@webcloneai.com.br,admin@webcloneai.com.br',  // logins do admin (vírgula separa vários)
  ADMIN_PASSWORD,         // senha do painel admin (defina na env — sem ela o admin fica bloqueado)
  ADMIN_SECRET,           // segredo p/ assinar o token de sessão do admin
  UTMIFY_API_TOKEN,       // credencial da Utmify (Integrações → Webhooks → Credencial de API)
  ADMIN_PATH = 'admin',   // caminho secreto do painel (troque por algo que ninguém adivinha)
  PORT = 3000,
} = process.env;

const ADMIN_TOKEN_SECRET = ADMIN_SECRET || WEBHOOK_SECRET || 'troque-este-segredo';

// Um .env com duas variáveis na mesma linha já fez a chave virar
// `"re_xxx" ADMIN_EMAILS=...` — o Resend respondia 401 e o cliente pagava sem
// receber a senha, com o erro só num console.error. Limpa e valida no boot.
const RESEND_API_KEY = (RESEND_API_KEY_RAW || '').trim().replace(/^["']|["']$/g, '');

if (RESEND_API_KEY_RAW && !/^re_[A-Za-z0-9_-]+$/.test(RESEND_API_KEY)) {
  console.error(
    '[resend] RESEND_API_KEY com formato inválido (esperado "re_…", sem aspas nem ' +
    'espaços). O e-mail de acesso NÃO vai sair. Confira se não há duas variáveis ' +
    'na mesma linha do .env.'
  );
}

// A própria chave diz o ambiente ($aact_prod_* = produção). Se ASAAS_SANDBOX
// contradisser a chave, a chave manda — senão o Asaas responde 401 invalid_environment.
const ASAAS_KEY_IS_PROD = /^\$aact_prod/i.test(ASAAS_API_KEY || '');
const USE_SANDBOX = ASAAS_KEY_IS_PROD ? false : ASAAS_SANDBOX === 'true';

if (ASAAS_KEY_IS_PROD && ASAAS_SANDBOX === 'true') {
  console.warn('[asaas] ASAAS_SANDBOX=true com chave de produção — usando produção.');
}

const ASAAS_BASE = USE_SANDBOX
  ? 'https://api-sandbox.asaas.com/v3'
  : 'https://api.asaas.com/v3';

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
    // Parcelamento só quando > 1 (installmentCount=1 é cobrança normal — evita recusa)
    const inst = parseInt(card.installments) || 1;
    if (inst > 1) {
      base.installmentCount = inst;
      base.installmentValue = parseFloat((amount / inst).toFixed(2));
    }
    // remoteIp do comprador — antifraude do Asaas (recusa/limita cartão sem ele)
    if (data.remoteIp) base.remoteIp = data.remoteIp;
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

function generatePassword() {
  // Senha legível (sem caracteres ambíguos) de 12 chars
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(12);
  let p = '';
  for (let i = 0; i < 12; i++) p += chars[bytes[i] % chars.length];
  return p;
}

async function sendAccessEmail(email, password) {
  const membersUrl = process.env.MEMBERS_URL || 'https://webcloneai.com.br/membros';

  // Sem Resend → cai no e-mail nativo do Supabase (link p/ definir senha)
  if (!RESEND_API_KEY) {
    const redirect = process.env.PASSWORD_RESET_URL || 'https://webcloneai.com.br/redefinir-senha';
    await supaAdmin('POST', `/auth/v1/recover?redirect_to=${encodeURIComponent(redirect)}`, { email });
    return;
  }

  const cred = password ? `
      <p style="color:#b8bcc4;font-size:14px;margin:0 0 8px">Seus dados de acesso:</p>
      <div style="background:#0a0b0e;border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:14px 16px;margin:0 0 8px;font-size:14px;color:#fff;line-height:1.8">
        E-mail: <strong>${email}</strong><br>Senha: <strong style="letter-spacing:1px;font-size:16px">${password}</strong>
      </div>
      <p style="color:#7b8090;font-size:12px;margin:0 0 22px">Você pode trocar essa senha em "Meu perfil" depois de entrar.</p>` : '';

  const html = `<!doctype html><html><body style="margin:0;background:#0a0b0e;font-family:Arial,Helvetica,sans-serif;padding:32px">
    <div style="max-width:520px;margin:0 auto;background:#111318;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:36px 32px;color:#fff">
      <h1 style="font-size:22px;margin:0 0 8px">Seu acesso ao Web Clone AI</h1>
      <p style="color:#b8bcc4;font-size:15px;line-height:1.6;margin:0 0 24px">Pagamento confirmado! Já pode entrar na área de membros — com a extensão e os tutoriais.</p>
      ${cred}
      <a href="${membersUrl}" style="display:inline-block;background:#fff;color:#0a0b0e;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:100px;font-size:15px">Acessar área de membros</a>
      <p style="color:#7b8090;font-size:12px;margin:22px 0 0">Ou acesse: ${membersUrl}</p>
    </div></body></html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ from: RESEND_FROM, to: [email], subject: 'Seu acesso ao Web Clone AI', html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text().catch(() => '')}`);
}

async function createSupabaseUser(email, plan, asaasCustomerId, asaasPaymentId) {
  // 1. Criar usuário auth com senha aleatória legível (enviada por e-mail)
  const password = generatePassword();
  const userRes = await supaAdmin('POST', '/auth/v1/admin/users', {
    email,
    password,
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
    await sendAccessEmail(email, password);
  } catch (e) {
    // O provisionamento não pode cair por causa do e-mail, mas o cliente pagou e
    // ficou sem acesso — a senha só existia aqui e já foi descartada. Grita alto
    // com o e-mail e o pagamento para dar de achar no log e reenviar pelo admin.
    console.error(
      `[email] *** CLIENTE SEM ACESSO *** ${email} pagou (${asaasPaymentId}) e o ` +
      `e-mail de acesso NAO saiu: ${e.message} — reenvie pelo painel admin, que ` +
      `redefine a senha e manda de novo.`
    );
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
  _accessCache.delete(asaasCustomerId);
  return rows[0];
}

async function deactivateSubscription(asaasCustomerId, status = 'inactive') {
  await supaAdmin(
    'PATCH',
    `/rest/v1/subscriptions?asaas_customer_id=eq.${asaasCustomerId}`,
    [{ status }]
  );
  _accessCache.delete(asaasCustomerId);
}

// ── Acesso: o Asaas é a fonte da verdade ──────────────────────────────────────
//
// O status no Supabase só reflete o Asaas se o webhook chegou. Webhook perdido,
// mal configurado ou evento não tratado deixava um cancelado/estornado com
// acesso vitalício. Aqui a gente confere direto na API do Asaas e sincroniza.

// Estados de pagamento que DÃO acesso e que TIRAM acesso
const PAID_STATUSES    = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED']);
const CHARGEBACK_STATUSES = new Set([
  'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL',
]);

// Decide o acesso a partir da lista de pagamentos do customer no Asaas.
//
// A regra "qualquer estorno revoga" estava errada: quem comprou, foi estornado
// e comprou de NOVO ficava bloqueado para sempre. E ela era desnecessária —
// quando o Asaas estorna, aquela cobrança passa a figurar como REFUNDED, então
// ela simplesmente deixa de contar como paga. Basta perguntar se sobrou alguma
// cobrança paga agora.
//
// Chargeback continua revogando de imediato: ali existe disputa em curso, e o
// prudente é cortar o acesso enquanto ela não se resolve.
function decidePaymentAccess(list) {
  if (list.some(p => CHARGEBACK_STATUSES.has(p.status))) return { active: false, reason: 'chargeback' };
  if (list.some(p => PAID_STATUSES.has(p.status)))       return { active: true,  reason: 'payment_confirmed' };
  return { active: false, reason: 'no_paid_payment' };
}

// Cache curto por customer — evita bater no Asaas a cada abertura do popup
const _accessCache = new Map();  // customerId -> { active, reason, at }
const ACCESS_TTL_MS = 10 * 60 * 1000;

async function asaasAccessState(customerId, plan, subId) {
  const cached = _accessCache.get(customerId);
  if (cached && Date.now() - cached.at < ACCESS_TTL_MS) return cached;

  let state;
  try {
    if (plan === 'monthly' && subId) {
      // Mensal: a assinatura no Asaas manda
      const sub = await asaas('GET', `/subscriptions/${subId}`);
      state = sub.status === 'ACTIVE'
        ? { active: true,  reason: 'subscription_active' }
        : { active: false, reason: `subscription_${String(sub.status || '').toLowerCase()}` };
    } else {
      // Vitalício: precisa de um pagamento pago e nenhum estorno/chargeback
      const r = await asaas('GET', `/payments?customer=${encodeURIComponent(customerId)}&limit=100`);
      state = decidePaymentAccess(r.data || []);
    }
  } catch (e) {
    // Asaas fora do ar não pode derrubar o acesso de quem pagou — mantém o DB
    console.error('[access] falha ao consultar Asaas:', e.message);
    return { active: null, reason: 'asaas_unreachable', at: 0 };
  }

  state.at = Date.now();
  _accessCache.set(customerId, state);
  return state;
}

// Resolve o acesso de um usuário e sincroniza o Supabase se estiver divergente
async function resolveAccess(userId) {
  const rows = await supaAdmin(
    'GET',
    `/rest/v1/subscriptions?user_id=eq.${userId}&select=id,status,plan,asaas_customer_id,asaas_sub_id&limit=1`
  );
  if (!rows?.length) return { active: false, status: 'none', plan: null, reason: 'no_subscription' };

  const sub = rows[0];

  // Sem customer no Asaas (cortesia/liberação manual pelo admin) → o DB manda
  if (!sub.asaas_customer_id) {
    return { active: sub.status === 'active', status: sub.status, plan: sub.plan, reason: 'manual' };
  }

  const state = await asaasAccessState(sub.asaas_customer_id, sub.plan, sub.asaas_sub_id);

  // Asaas inacessível → responde com o que está no DB, sem alterar nada
  if (state.active === null) {
    return { active: sub.status === 'active', status: sub.status, plan: sub.plan, reason: state.reason };
  }

  const wanted = state.active ? 'active' : 'inactive';
  if (sub.status !== wanted) {
    await supaAdmin('PATCH', `/rest/v1/subscriptions?id=eq.${sub.id}`, [{ status: wanted }]);
    console.log(`[access] sync ${userId}: ${sub.status} → ${wanted} (${state.reason})`);
  }

  return { active: state.active, status: wanted, plan: sub.plan, reason: state.reason };
}

// Reconcilia o status de um cliente contra o Asaas (a fonte da verdade), em vez
// de confiar num único evento isolado.
async function reconcileByCustomer(customerId) {
  _accessCache.delete(customerId);
  let estado;
  try {
    const r = await asaas('GET', `/payments?customer=${encodeURIComponent(customerId)}&limit=100`);
    estado = decidePaymentAccess(r.data || []);
  } catch (e) {
    console.error('[reconcile] Asaas indisponível, mantendo como está:', e.message);
    return;
  }
  const alvo = estado.active ? 'active' : 'inactive';
  await supaAdmin('PATCH', `/rest/v1/subscriptions?asaas_customer_id=eq.${customerId}`, [{ status: alvo }]);
  console.log(`[reconcile] ${customerId} -> ${alvo} (${estado.reason})`);
}

// Marca uso do assinante. "open" = abriu a extensão; "export" = mandou clonar.
async function registrarAtividade(userId, ctx) {
  const campos = { last_seen_at: new Date().toISOString() };
  if (ctx === 'export') {
    campos.last_export_at = campos.last_seen_at;
    // exports_count é incremento: lê e soma. Volume aqui é baixo (uma clonagem
    // por vez, por pessoa), então não compensa uma função no banco só para isso.
    try {
      const r = await supaAdmin('GET', `/rest/v1/subscriptions?user_id=eq.${userId}&select=exports_count&limit=1`);
      campos.exports_count = ((r?.[0]?.exports_count) || 0) + 1;
    } catch {}
  }
  await supaAdmin('PATCH', `/rest/v1/subscriptions?user_id=eq.${userId}`, [campos]);
}

// Identifica o usuário pelo JWT do Supabase mandado pelo cliente
async function userFromToken(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const u = await res.json().catch(() => null);
  return u?.id ? u : null;
}

// ── Utmify (atribuição de anúncio) ───────────────────────────────────────────
//
// A Utmify precisa saber de CADA mudança de status do pedido para casar a venda
// com o anúncio que a originou. Como o PIX fica pendente até o cliente pagar, o
// pedido é guardado em orders_tracking: quando o webhook de "pago" chega, as
// UTMs que vieram do anúncio ainda estão lá — senão a venda entraria sem origem.

function dataUtmify(d) {
  // A Utmify espera "YYYY-MM-DD HH:MM:SS" em UTC
  return (d ? new Date(d) : new Date()).toISOString().slice(0, 19).replace('T', ' ');
}

async function enviarUtmify(pedido) {
  if (!UTMIFY_API_TOKEN) return;   // não configurado: silencioso, não é erro
  try {
    const r = await fetch('https://api.utmify.com.br/api-credentials/orders', {
      method:  'POST',
      headers: { 'x-api-token': UTMIFY_API_TOKEN, 'Content-Type': 'application/json' },
      body:    JSON.stringify(pedido),
    });
    if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 180)}`);
    console.log(`[utmify] ${pedido.orderId} -> ${pedido.status}`);
  } catch (e) {
    // Atribuição não pode derrubar venda: registra e segue.
    console.error('[utmify] falha ao enviar', pedido.orderId, e.message);
  }
}

async function guardarPedido(paymentId, payload) {
  // Upsert de verdade: o mesmo pedido é gravado na criação e de novo a cada
  // mudança de status. Sem resolution=merge-duplicates o segundo POST dá 409.
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/orders_tracking?on_conflict=payment_id`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':         SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer':        'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify([{ payment_id: paymentId, payload }]),
    });
    if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 140)}`);
  } catch (e) { console.error('[utmify] não guardou o pedido:', e.message); }
}

async function lerPedido(paymentId) {
  try {
    const r = await supaAdmin('GET', `/rest/v1/orders_tracking?payment_id=eq.${paymentId}&select=payload&limit=1`);
    return r?.[0]?.payload || null;
  } catch { return null; }
}

// Avisa a Utmify de uma mudança de status usando o pedido já guardado.
async function statusUtmify(paymentId, status, quando) {
  if (!UTMIFY_API_TOKEN) return;
  const pedido = await lerPedido(paymentId);
  if (!pedido) return;                       // veio de antes da integração
  pedido.status = status;
  if (status === 'paid')     pedido.approvedDate = dataUtmify(quando);
  if (status === 'refunded') pedido.refundedAt   = dataUtmify(quando);
  await enviarUtmify(pedido);
  await guardarPedido(paymentId, pedido);
}

// ── Endpoint: POST /api/checkout ──────────────────────────────────────────────

app.post('/api/checkout', async (req, res) => {
  try {
    const { plan, paymentMethod, name, email, cpf, card, tracking } = req.body;

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
    const remoteIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || req.socket?.remoteAddress;
    const payment = await asaasCreatePayment(customer.id, { plan, paymentMethod, name, email, cpf, card, remoteIp });

    // Para cartão confirmado de imediato:
    const pagoAgora = paymentMethod === 'card' && (payment.status === 'CONFIRMED' || payment.status === 'RECEIVED');
    if (pagoAgora) {
      await createSupabaseUser(email, plan, customer.id, payment.id);
    }

    // Utmify: registra o pedido já na criação. PIX nasce "waiting_payment" e
    // vira "paid" pelo webhook — sem este primeiro envio, um PIX abandonado
    // ficaria invisível e o custo do anúncio não teria contrapartida.
    if (payment.id) {
      const t = tracking || {};
      const centavos = Math.round((payment.value || 29.90) * 100);
      const pedido = {
        orderId: payment.id,
        platform: 'WebCloneAI',
        paymentMethod: paymentMethod === 'card' ? 'credit_card' : 'pix',
        status: pagoAgora ? 'paid' : 'waiting_payment',
        createdAt: dataUtmify(),
        approvedDate: pagoAgora ? dataUtmify() : null,
        refundedAt: null,
        customer: {
          name, email,
          phone: t.phone || null,
          document: String(cpf || '').replace(/\D/g, '') || null,
          country: 'BR',
          ip: remoteIp || null,
        },
        products: [{
          id: 'web-clone-ai',
          name: 'Web Clone AI — Vitalício',
          planId: null, planName: null,
          quantity: 1, priceInCents: centavos,
        }],
        trackingParameters: {
          src: t.src || null, sck: t.sck || null,
          utm_source: t.utm_source || null, utm_campaign: t.utm_campaign || null,
          utm_medium: t.utm_medium || null, utm_content: t.utm_content || null,
          utm_term: t.utm_term || null,
        },
        commission: {
          totalPriceInCents: centavos,
          gatewayFeeInCents: 0,
          userCommissionInCents: centavos,
          currency: 'BRL',
        },
        isTest: false,
      };
      await guardarPedido(payment.id, pedido);
      await enviarUtmify(pedido);
    }

    // 3. Para PIX, o QR Code vem de um endpoint separado do Asaas
    let pix = {};
    if (paymentMethod === 'pix' && payment.id) {
      try {
        const qr = await asaas('GET', `/payments/${payment.id}/pixQrCode`);
        pix = {
          pixCopiaECola:  qr.payload,
          pixQrCode:      qr.encodedImage,
          expirationDate: qr.expirationDate,
        };
      } catch (e) {
        console.error('[checkout] falha ao buscar QR do PIX:', e.message);
      }
    }

    // Resposta ao front
    res.json({
      status:     payment.status,
      invoiceUrl: payment.invoiceUrl,
      ...pix,
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

        await statusUtmify(payment.id, 'paid', payment.paymentDate || payment.confirmedDate);

        if (existing?.length) {
          await activateSubscription(payment.customer);
        } else {
          // Primeiro pagamento — determinar plano pelo valor
          const plan = 'lifetime'; // só vitalício
          await createSupabaseUser(email, plan, payment.customer, payment.id);
        }
        break;
      }

      // Estorno, chargeback ou cobrança removida — revogar acesso
      case 'PAYMENT_REFUNDED':
      case 'PAYMENT_REFUND_IN_PROGRESS':
      case 'PAYMENT_PARTIALLY_REFUNDED':
      case 'PAYMENT_CHARGEBACK_REQUESTED':
      case 'PAYMENT_CHARGEBACK_DISPUTE':
      case 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL':
      case 'PAYMENT_DELETED': {
        const { payment } = event;
        if (payment?.customer) {
          const st = event.event === 'PAYMENT_REFUNDED' ? 'refunded' : 'inactive';
          await deactivateSubscription(payment.customer, st);
        }
        if (payment?.id) {
          await statusUtmify(payment.id, /CHARGEBACK/.test(event.event) ? 'chargedback' : 'refunded', new Date());
        }
        break;
      }

      // Cobrança vencida. NÃO pode simplesmente cortar: deactivateSubscription
      // age por CLIENTE, então um PIX antigo que o cliente abandonou derrubava
      // a compra que ele fez depois — foi exatamente o que aconteceu com um
      // cliente real. Aqui a gente reconcilia contra o Asaas: se sobrou alguma
      // cobrança paga, o acesso fica de pé.
      case 'PAYMENT_OVERDUE': {
        const { payment } = event;
        if (payment?.customer) await reconcileByCustomer(payment.customer);
        break;
      }

      // Cobrança restaurada — devolve o acesso.
      // (Não existe PAYMENT_CHARGEBACK_REVERSED no Asaas: a API rejeita esse
      //  evento como inválido. A volta de um chargeback ganho chega como
      //  PAYMENT_RECEIVED/RESTORED.)
      case 'PAYMENT_RESTORED': {
        const { payment } = event;
        if (payment?.customer) await activateSubscription(payment.customer);
        break;
      }

      // Assinatura cancelada ou expirada
      case 'SUBSCRIPTION_DELETED':
      case 'SUBSCRIPTION_INACTIVATED': {
        const { subscription } = event;
        if (subscription?.customer) {
          await deactivateSubscription(subscription.customer, 'expired');
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

// ── Busca de usuário por e-mail ───────────────────────────────────────────────

// O admin do GoTrue ignora `?email=` e devolve a lista inteira — quem usasse isso
// pegava o primeiro usuário qualquer. `filter` faz ILIKE no e-mail; o match exato
// abaixo garante o resto.
async function findUserByEmail(email) {
  const wanted = String(email || '').trim().toLowerCase();
  if (!wanted) return null;
  const r = await supaAdmin('GET', `/auth/v1/admin/users?filter=${encodeURIComponent(wanted)}&per_page=100`);
  const list = r?.users || (Array.isArray(r) ? r : []);
  return list.find(u => String(u.email || '').toLowerCase() === wanted) || null;
}

// ── Endpoint: GET /api/user/status ────────────────────────────────────────────

app.get('/api/user/status', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'E-mail obrigatório.' });

  try {
    const user = await findUserByEmail(email);
    if (!user) return res.json({ status: 'not_found' });

    const userId = user.id;
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

// ── Endpoint: GET /api/access/verify ──────────────────────────────────────────
//
// Usado pela extensão e pela área de membros a cada abertura/exportação.
// Confere no Asaas (fonte da verdade), sincroniza o Supabase e responde.
// Auth: Bearer <access_token do Supabase do próprio usuário>.

app.get('/api/access/verify', async (req, res) => {
  try {
    const user = await userFromToken(req);
    if (!user) return res.status(401).json({ error: 'Sessão inválida.', active: false });

    const out = await resolveAccess(user.id);
    res.json(out);

    // Atividade — depois de responder, para não atrasar o cliente.
    // A extensão chama isto ao abrir o popup (ctx=open) e antes de cada
    // clonagem (ctx=export), então dá para medir uso real sem telemetria nova.
    registrarAtividade(user.id, req.query.ctx).catch(() => {});
  } catch (err) {
    console.error('[access/verify]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Endpoint: GET /api/payment/status ─────────────────────────────────────────

app.get('/api/payment/status', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'E-mail obrigatório.' });

  try {
    const user = await findUserByEmail(email);
    if (!user) return res.json({ paid: false });

    const subs = await supaAdmin(
      'GET',
      `/rest/v1/subscriptions?user_id=eq.${user.id}&status=eq.active&select=id&limit=1`
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
  const payload = Buffer.from(JSON.stringify({ e: 'admin', exp: Date.now() + 8 * 3600 * 1000 })).toString('base64url');
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
  const allowed = ADMIN_EMAILS.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const ok = allowed.includes(String(email || '').trim().toLowerCase()) && password === ADMIN_PASSWORD;
  if (!ok) return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
  res.json({ token: signAdminToken() });
});

app.get('/api/admin/subscribers', requireAdmin, async (_req, res) => {
  try {
    const subs = await supaAdmin('GET', '/rest/v1/subscriptions?select=*');
    const emails = {}, logins = {};
    try {
      const u = await supaAdmin('GET', '/auth/v1/admin/users?per_page=1000');
      (u.users || u || []).forEach(x => { emails[x.id] = x.email; logins[x.id] = x.last_sign_in_at; });
    } catch (e) { console.error('[admin] falha ao listar users:', e.message); }
    const rows = (subs || []).map(s => ({
      id: s.id, email: emails[s.user_id] || null, plan: s.plan, status: s.status,
      created_at: s.created_at || null, asaas_customer_id: s.asaas_customer_id,
      last_sign_in_at: logins[s.user_id] || null,   // último login (área de membros)
      last_seen_at:    s.last_seen_at   || null,    // última vez que abriu a extensão
      last_export_at:  s.last_export_at || null,    // última clonagem
      exports_count:   s.exports_count  || 0,
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

    // Reenviar SEM senha manda um e-mail que não resolve nada: a senha original
    // é gerada, usada para criar o usuário e descartada — ninguém mais a conhece.
    // Quem precisa de reenvio é justamente quem nunca conseguiu entrar, então
    // aqui a gente redefine para uma senha nova e manda ela.
    const password = generatePassword();
    await supaAdmin('PUT', `/auth/v1/admin/users/${rows[0].user_id}`, { password });
    await sendAccessEmail(u.email, password);

    res.json({ ok: true, email: u.email, senhaRedefinida: true });
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

// ── Admin: conteúdo da área de membros (módulos, aulas, banner) ───────────────

app.get('/api/admin/members-content', requireAdmin, async (_req, res) => {
  try {
    const [modules, lessons, settings] = await Promise.all([
      supaAdmin('GET', '/rest/v1/modules?select=*&order=position'),
      supaAdmin('GET', '/rest/v1/lessons?select=*&order=position'),
      supaAdmin('GET', '/rest/v1/members_settings?id=eq.1&select=*&limit=1'),
    ]);
    res.json({ modules: modules || [], lessons: lessons || [], settings: (settings && settings[0]) || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/members-settings', requireAdmin, async (req, res) => {
  try {
    const body = { updated_at: new Date().toISOString() };
    ['banner_title', 'banner_subtitle', 'banner_image_url'].forEach(k => { if (req.body?.[k] !== undefined) body[k] = req.body[k]; });
    await supaAdmin('PATCH', '/rest/v1/members_settings?id=eq.1', [body]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/modules', requireAdmin, async (req, res) => {
  try {
    if (!req.body?.title) return res.status(400).json({ error: 'Título obrigatório.' });
    const r = await supaAdmin('POST', '/rest/v1/modules', [{ title: req.body.title, position: req.body.position || 0 }]);
    res.json({ ok: true, module: r?.[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.patch('/api/admin/modules/:id', requireAdmin, async (req, res) => {
  try {
    const body = {};
    ['title', 'position'].forEach(k => { if (req.body?.[k] !== undefined) body[k] = req.body[k]; });
    await supaAdmin('PATCH', `/rest/v1/modules?id=eq.${encodeURIComponent(req.params.id)}`, [body]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/admin/modules/:id', requireAdmin, async (req, res) => {
  try {
    await supaAdmin('DELETE', `/rest/v1/modules?id=eq.${encodeURIComponent(req.params.id)}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/lessons', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.title) return res.status(400).json({ error: 'Título obrigatório.' });
    const row = {
      title: b.title, description: b.description || null, duration: b.duration || null,
      status: b.status === 'soon' ? 'soon' : 'available', video_url: b.video_url || null,
      module_id: b.module_id || null, position: b.position || 0,
    };
    const r = await supaAdmin('POST', '/rest/v1/lessons', [row]);
    res.json({ ok: true, lesson: r?.[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.patch('/api/admin/lessons/:id', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {}; const body = { updated_at: new Date().toISOString() };
    ['title', 'description', 'duration', 'status', 'video_url', 'material_url', 'module_id', 'position'].forEach(k => { if (b[k] !== undefined) body[k] = b[k]; });
    if (body.status && body.status !== 'soon') body.status = 'available';
    await supaAdmin('PATCH', `/rest/v1/lessons?id=eq.${encodeURIComponent(req.params.id)}`, [body]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/admin/lessons/:id', requireAdmin, async (req, res) => {
  try {
    await supaAdmin('DELETE', `/rest/v1/lessons?id=eq.${encodeURIComponent(req.params.id)}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Arquivos estáticos (LP, checkout, área de membros) ────────────────────────

const SITE_ROOT = path.join(__dirname, '..');

app.use('/icons',    express.static(path.join(SITE_ROOT, 'icons')));
app.use('/fonts',    express.static(path.join(SITE_ROOT, 'fonts')));
app.use('/checkout', express.static(path.join(SITE_ROOT, 'checkout')));
app.use('/landing',  express.static(path.join(SITE_ROOT, 'landing')));
app.use('/members',  express.static(path.join(SITE_ROOT, 'members')));
// O painel não fica em /admin: quem souber o endereço já passou da primeira
// porta. O caminho vem de ADMIN_PATH e a senha continua obrigatória.
app.use(`/${ADMIN_PATH}`, express.static(path.join(SITE_ROOT, 'admin')));

// Todos os domínios (apex, api., membros.) caem NESTE mesmo app, que roteia por
// CAMINHO — não por host. Sem isto, abrir membros.webcloneai.com.br servia a
// página de vendas, porque o caminho ali é "/".
const MEMBERS_HOST = process.env.MEMBERS_HOST || 'membros.webcloneai.com.br';

app.get('/', (req, res, next) => {
  if (req.hostname === MEMBERS_HOST) {
    return res.sendFile(path.join(SITE_ROOT, 'members/index.html'));
  }
  next();
});

app.get('/',                (_req, res) => res.sendFile(path.join(SITE_ROOT, 'landing/index.html')));
app.get(`/${ADMIN_PATH}`,   (_req, res) => res.sendFile(path.join(SITE_ROOT, 'admin/index.html')));
app.get('/lp',              (_req, res) => res.sendFile(path.join(SITE_ROOT, 'landing/index.html')));
app.get('/membros',         (_req, res) => res.sendFile(path.join(SITE_ROOT, 'members/index.html')));
app.get('/termos',          (_req, res) => res.sendFile(path.join(SITE_ROOT, 'landing/termos.html')));
app.get('/obrigado',        (_req, res) => res.sendFile(path.join(SITE_ROOT, 'checkout/obrigado.html')));
app.get('/recuperar-senha', (_req, res) => res.sendFile(path.join(SITE_ROOT, 'landing/recuperar-senha.html')));
app.get('/redefinir-senha', (_req, res) => res.sendFile(path.join(SITE_ROOT, 'landing/redefinir-senha.html')));

// ── Download da extensão (ZIP gerado a partir dos arquivos do projeto) ─────────

let _extZip = null;

const EXT_ROOT = path.join(SITE_ROOT, 'extension');

async function buildExtensionZip() {
  if (_extZip) return _extZip;
  const JSZip = require(path.join(EXT_ROOT, 'lib/jszip.min.js'));
  const zip = new JSZip();

  // Zipa a pasta extension/ INTEIRA. Antes a lista de diretórios era escrita à
  // mão aqui: bastava a extensão ganhar uma pasta nova para ela sumir do ZIP do
  // cliente sem ninguém notar. Agora o que está na pasta é o que é entregue —
  // e nada de fora dela pode entrar (site, api, .env).
  const addDir = (absDir, rel) => {
    for (const name of fs.readdirSync(absDir)) {
      const abs = path.join(absDir, name);
      const r = rel ? `${rel}/${name}` : name;
      if (fs.statSync(abs).isDirectory()) addDir(abs, r);
      else zip.file(r, fs.readFileSync(abs));
    }
  };
  addDir(EXT_ROOT, '');

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

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[Web Clone AI API] rodando na porta ${PORT} — ${USE_SANDBOX ? 'SANDBOX' : 'PRODUÇÃO'} (${ASAAS_BASE})`);
  });
}

// Exportado para teste (require direto não sobe o servidor)
module.exports = { app, decidePaymentAccess, validarCPF, generatePassword, buildExtensionZip, dataUtmify };
