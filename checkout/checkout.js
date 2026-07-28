'use strict';

// ─── Configuração — preencher com credenciais reais ──────────────────────────
const API_URL = 'https://api.webcloneai.com.br';
const VALOR = 29.90;

// Atribuição para a Utmify: prefere o que veio na URL agora, senão usa o que
// foi guardado na primeira visita (o clique do anúncio cai na landing, não aqui).
function lerAtribuicao(){
  var campos=['utm_source','utm_campaign','utm_medium','utm_content','utm_term','src','sck'];
  var q=new URLSearchParams(location.search), t={};
  campos.forEach(function(k){ t[k]=q.get(k)||null });
  if(campos.some(function(k){return t[k]})) return t;
  try{
    var g=JSON.parse(localStorage.getItem('wca_utm')||'null');
    if(g){ campos.forEach(function(k){ t[k]=g[k]||null }); }
  }catch(e){}
  return t;
}


// Manda para a página de obrigado, que é quem dispara o Purchase.
function irParaObrigado(email) {
  const q = new URLSearchParams({ v: String(VALOR) });
  if (email) q.set('e', email);
  setTimeout(() => { location.href = '/obrigado?' + q.toString(); }, 900);
}

// Quem abriu o checkout demonstrou intenção de compra — é este evento que o
// Meta usa para achar mais gente parecida.
if (window.fbq) fbq('track', 'InitiateCheckout', { value: VALOR, currency: 'BRL', content_name: 'Web Clone AI' });

// ─── Estado ──────────────────────────────────────────────────────────────────
let currentPlan    = 'lifetime';
let currentPayment = 'pix';

const PLANS = {
  monthly:  { name: 'Acesso Mensal',   price: 29.90, label: 'R$29,90', period: 'por mês' },
  lifetime: { name: 'Acesso Vitalício', price: 29.90, label: 'R$29,90', period: 'pagamento único' },
};

// ─── Seleção de plano ─────────────────────────────────────────────────────────

window.selectPlan = function(plan) {
  currentPlan = plan;
  document.getElementById('planMonthly')?.classList.toggle('selected', plan === 'monthly');
  document.getElementById('planLifetime').classList.toggle('selected', plan === 'lifetime');

  const p = PLANS[plan];
  document.getElementById('summaryPlanName').textContent  = p.name;
  document.getElementById('summaryPlanPrice').textContent = p.label;
  document.getElementById('summaryTotal').textContent     = p.label;

  // Ajustar parcelamento para cartão (mensal sem parcelamento)
  const sel = document.getElementById('installments');
  sel.innerHTML = `<option value="1">1x de R$29,90 sem juros</option>`;
};

// ─── Seleção de pagamento ─────────────────────────────────────────────────────

window.selectPayment = function(method) {
  currentPayment = method;
  document.getElementById('tabPix').classList.toggle('active', method === 'pix');
  document.getElementById('tabCard').classList.toggle('active', method === 'card');
  document.getElementById('pixBlock').classList.toggle('show', method === 'pix');
  document.getElementById('cardBlock').classList.toggle('show', method === 'card');

  const label = method === 'pix' ? 'GERAR QR CODE PIX' : 'FINALIZAR PEDIDO';
  document.getElementById('submitLabel').textContent = label;
};

// ─── Máscaras de input ────────────────────────────────────────────────────────

document.getElementById('cpf').addEventListener('input', function() {
  let v = this.value.replace(/\D/g, '').slice(0, 11);
  if (v.length > 9)      v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  else if (v.length > 6) v = v.replace(/(\d{3})(\d{3})(\d{3})/, '$1.$2.$3');
  else if (v.length > 3) v = v.replace(/(\d{3})(\d{3})/, '$1.$2');
  this.value = v;
});

document.getElementById('cardNumber')?.addEventListener('input', function() {
  let v = this.value.replace(/\D/g, '').slice(0, 16);
  this.value = v.replace(/(\d{4})/g, '$1 ').trim();
});

document.getElementById('cardExpiry')?.addEventListener('input', function() {
  let v = this.value.replace(/\D/g, '').slice(0, 4);
  if (v.length > 2) v = v.slice(0, 2) + '/' + v.slice(2);
  this.value = v;
});

// ─── Validação ────────────────────────────────────────────────────────────────

function validateForm() {
  const name  = document.getElementById('fullName').value.trim();
  const email = document.getElementById('email').value.trim();
  const cpf   = document.getElementById('cpf').value.replace(/\D/g, '');

  if (!name || name.split(' ').length < 2)     return 'Informe seu nome completo.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'E-mail inválido.';
  if (cpf.length !== 11)                         return 'CPF inválido.';

  if (currentPayment === 'card') {
    const num = document.getElementById('cardNumber').value.replace(/\D/g, '');
    const exp = document.getElementById('cardExpiry').value;
    const cvv = document.getElementById('cardCvv').value;
    if (num.length < 13)  return 'Número de cartão inválido.';
    if (!/^\d{2}\/\d{2}$/.test(exp)) return 'Validade inválida (MM/AA).';
    if (cvv.length < 3)   return 'CVV inválido.';
  }
  return null;
}

// ─── Envio do formulário ──────────────────────────────────────────────────────

document.getElementById('checkoutForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  const err = validateForm();
  if (err) return showMsg(err, 'err');

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  document.getElementById('submitLabel').textContent = 'PROCESSANDO...';
  clearMsg();

  try {
    const payload = {
      plan:          currentPlan,
      paymentMethod: currentPayment,
      name:          document.getElementById('fullName').value.trim(),
      email:         document.getElementById('email').value.trim(),
      cpf:           document.getElementById('cpf').value.replace(/\D/g, ''),
      tracking:      lerAtribuicao(),
    };

    if (currentPayment === 'card') {
      const [expMonth, expYear] = document.getElementById('cardExpiry').value.split('/');
      payload.card = {
        number:         document.getElementById('cardNumber').value.replace(/\D/g, ''),
        expiryMonth:    expMonth,
        expiryYear:     '20' + expYear,
        cvv:            document.getElementById('cardCvv').value,
        holderName:     document.getElementById('cardName').value.trim(),
        installments:   parseInt(document.getElementById('installments').value),
      };
    }

    const res = await fetch(`${API_URL}/api/checkout`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao processar pagamento.');

    if (currentPayment === 'pix') {
      showPixResult(data);
    } else {
      if (data.status === 'CONFIRMED' || data.status === 'RECEIVED') {
        showMsg('✅ Pagamento confirmado! Redirecionando…', 'ok');
        document.getElementById('checkoutForm').style.display = 'none';
        // O Purchase dispara na /obrigado, não aqui — senão a mesma venda seria
        // contada duas vezes no gerenciador de anúncios.
        irParaObrigado(email);
      } else {
        throw new Error('Pagamento não confirmado. Tente novamente ou use PIX.');
      }
    }

  } catch (err) {
    showMsg(err.message, 'err');
    btn.disabled = false;
    document.getElementById('submitLabel').textContent =
      currentPayment === 'pix' ? 'GERAR QR CODE PIX' : 'FINALIZAR PEDIDO';
  }
});

// ─── UI helpers ───────────────────────────────────────────────────────────────

function showMsg(msg, type) {
  const el = document.getElementById('formMsg');
  el.textContent = msg;
  el.className = `form-msg ${type}`;
}

function clearMsg() {
  const el = document.getElementById('formMsg');
  el.textContent = '';
  el.className = 'form-msg';
}

function showPixResult(data) {
  const pixResult = document.getElementById('pixResult');
  document.getElementById('checkoutForm').style.display = 'none';

  const qrHtml = data.pixQrCode
    ? `<div class="qr-wrap"><img src="data:image/png;base64,${data.pixQrCode}" width="200" height="200" alt="QR Code PIX"></div>`
    : '';

  pixResult.innerHTML = `
    ${qrHtml}
    <p style="font-size:14px;color:rgba(248,248,248,0.90);font-weight:600;margin-bottom:10px;">
      Escaneie o QR Code ou copie o código PIX
    </p>
    <div class="pix-code-box" onclick="copyPix(this)" title="Clique para copiar">
      ${data.pixCopiaECola || 'Código indisponível'}
    </div>
    <div class="copy-hint">Clique no código para copiar · Válido por 30 minutos</div>
    <p style="font-size:12px;color:var(--t2);margin-top:16px;line-height:1.55">
      Após o pagamento, você receberá um <strong style="color:var(--t1)">e-mail com login e senha</strong> em até 5 minutos. Verifique a caixa de spam se necessário.
    </p>
    <button id="checkAccessBtn" class="cta-btn" style="display:none;margin-top:20px">
      Já paguei — verificar acesso
    </button>
    <div id="checkAccessMsg" class="form-msg" style="margin-top:12px"></div>
  `;
  pixResult.classList.add('show');

  const email = document.getElementById('email').value.trim();
  setTimeout(() => {
    const btn = document.getElementById('checkAccessBtn');
    if (btn) btn.style.display = 'flex';
  }, 30000);

  pixResult.querySelector('#checkAccessBtn')?.addEventListener('click', () => verifyAccess(email));
}

async function verifyAccess(email) {
  const btn = document.getElementById('checkAccessBtn');
  const msg = document.getElementById('checkAccessMsg');
  btn.disabled = true;
  btn.textContent = 'VERIFICANDO...';
  msg.className = 'form-msg';
  msg.textContent = '';

  try {
    const res = await fetch(`${API_URL}/api/payment/status?email=${encodeURIComponent(email)}`);
    const data = await res.json();
    if (data.paid) {
      msg.className = 'form-msg ok';
      msg.textContent = '✅ Pagamento confirmado! Redirecionando…';
      btn.style.display = 'none';
      irParaObrigado(email);
    } else {
      msg.className = 'form-msg err';
      msg.textContent = 'Pagamento ainda não confirmado. Aguarde alguns instantes e tente novamente.';
    }
  } catch (err) {
    msg.className = 'form-msg err';
    msg.textContent = 'Não foi possível verificar agora. Tente novamente em instantes.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Já paguei — verificar acesso';
  }
}

window.copyPix = function(el) {
  const text = el.textContent.trim();
  navigator.clipboard.writeText(text).then(() => {
    el.textContent = '✓ Copiado!';
    setTimeout(() => { el.textContent = text; }, 2000);
  });
};

// ─── Init ─────────────────────────────────────────────────────────────────────
const urlPlan = new URLSearchParams(window.location.search).get('plan');
selectPlan('lifetime'); // só vitalício R$29,90
void urlPlan;
selectPayment('pix');
