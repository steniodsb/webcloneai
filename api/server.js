'use strict';

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const crypto   = require('crypto');
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
  PORT = 3000,
} = process.env;

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
  const amount   = plan === 'monthly' ? 29.90 : 67.00;
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

  // 3. Enviar e-mail para o cliente definir a senha (best-effort — não derruba o provisioning)
  try {
    const resetUrl = process.env.PASSWORD_RESET_URL || 'https://webcloneai.com.br/redefinir-senha';
    await supaAdmin('POST', `/auth/v1/recover?redirect_to=${encodeURIComponent(resetUrl)}`, { email });
  } catch (e) {
    console.error('[email] falha ao enviar link de senha:', e.message);
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
          const plan = payment.value <= 29.90 ? 'monthly' : 'lifetime';
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

app.get('/', (_req, res) => res.json({ service: 'Web Clone AI API', status: 'online' }));
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[Web Clone AI API] rodando na porta ${PORT} — ${ASAAS_SANDBOX === 'true' ? 'SANDBOX' : 'PRODUÇÃO'}`);
});
