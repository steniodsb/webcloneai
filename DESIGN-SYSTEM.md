# Design System — "Prata sobre preto"

Linguagem visual usada no Web Clone AI (landing + extensão). Este arquivo é
auto-contido: dá para colar inteiro num chat com Claude/Cursor e pedir para
aplicar noutro projeto.

---

## Prompt para reaproveitar noutro projeto

> Aplique este design system ao projeto. É um tema **escuro monocromático prateado**:
> fundo quase preto, tipografia branca, e todo o "colorido" vem de **luz** — gradientes
> prateados, brilhos difusos, bordas que reluzem e vidro fosco. **Não existe cor de
> marca** (nada de azul, roxo, verde). Acento = branco/prata.
>
> Regras que definem o estilo:
> 1. Fundo escuro (`#08090b`), superfícies em vidro translúcido, nunca cinza sólido.
> 2. Toda borda é `rgba(255,255,255,.08–.2)` — luz, não linha cinza.
> 3. Tipografia geométrica, peso 500, **letter-spacing negativo** em títulos grandes.
> 4. Botões são pílulas (`border-radius:100px`). O CTA principal é escuro com **borda
>    cônica prateada girando** — é a assinatura do design.
> 5. Profundidade vem de `inset` highlight no topo + sombra preta larga embaixo.
> 6. Movimento é lento e contínuo (3–7s), nunca chamativo. Sempre respeitar
>    `prefers-reduced-motion`.
>
> Use os tokens e componentes abaixo como fonte da verdade.

---

## 1. Tokens

```css
:root{
  /* Fundos */
  --bg:    #08090b;   /* página */
  --bg2:   #0b0d11;   /* seção alternada */
  --panel: #0d0f14;   /* cartão sólido / mockup */

  /* Escala prateada — do mais claro ao mais apagado */
  --s1: #eef1f5;      /* brilho máximo (topo do gradiente) */
  --s2: #d6dce4;      /* prata claro — texto de destaque */
  --s3: #c0c5ce;      /* prata médio */
  --s4: #8a94a6;      /* prata apagado — base do gradiente */

  /* Texto */
  --txt1: #ffffff;
  --txt2: rgba(255,255,255,.60);   /* corpo */
  --txt3: rgba(255,255,255,.40);   /* legendas, labels */

  /* Vidro e bordas */
  --line:  rgba(255,255,255,.08);
  --glass: linear-gradient(160deg, rgba(255,255,255,.06), rgba(255,255,255,.018));
  --glass-hi: rgba(255,255,255,.068);
  --glass-top: rgba(255,255,255,.18);   /* inset highlight do topo */
}
```

**Raios:** `100px` (pílulas/botões) · `17–18px` (cartões, tiles) · `9–13px` (inputs, itens de lista) · `6px` (chips).

---

## 2. Tipografia

Fonte: **Urbanist** (variável 100–1000) na landing, **DM Sans** na extensão.
Qualquer geométrica sem serifa com peso variável serve — o que importa é o
tratamento abaixo.

```css
h1,h2,h3{ font-weight:500; color:#fff; margin:0 }

h1{ font-size:clamp(38px,6.1vw,70px); line-height:1.05; letter-spacing:-2px }
h2{ font-size:clamp(31px,4.6vw,55px); line-height:1.08; letter-spacing:-1.5px }
h3{ font-size:19.5px;                 line-height:1.28; letter-spacing:-.4px }

.sub{ color:var(--txt2); font-size:15.5px; line-height:1.62; max-width:620px }
```

> **O detalhe que faz a diferença:** peso 500 (não bold) + letter-spacing bem
> negativo em tamanhos grandes. É isso que dá o ar "caro" — títulos pesados e
> espaçados parecem template.

**Eyebrow** (rótulo acima do título):

```css
.eye{
  display:inline-flex; align-items:center; gap:8px;
  border:1px solid rgba(255,255,255,.13); border-radius:100px;
  padding:7px 16px; font-size:11.5px; letter-spacing:1.2px; font-weight:500;
  text-transform:uppercase; color:var(--s2); background:rgba(255,255,255,.035);
}
```

**Texto com prata líquida** (para 1–2 palavras dentro do título — nunca a frase toda):

```css
.grad{
  background:linear-gradient(100deg,#7d8798 0%,#c0c5ce 26%,#ffffff 46%,#eef1f5 56%,#9aa3b4 80%,#7d8798 100%);
  background-size:220% 100%;
  -webkit-background-clip:text; background-clip:text;
  -webkit-text-fill-color:transparent; color:transparent;
  animation:gradShine 7s linear infinite;
}
@keyframes gradShine{ to{ background-position:-220% 0 } }
```

---

## 3. Botões

### 3.1 CTA assinatura — borda cônica prateada girando

O componente mais característico. Fundo escuro, e a luz **circula pela borda**.
Usa `@property` para animar o ângulo do cônico (Chrome/Edge/Safari 16.4+; onde
não houver, a borda fica estática e continua bonita).

```css
@property --gradient-angle        { syntax:"<angle>";      initial-value:0deg;    inherits:false }
@property --gradient-angle-offset { syntax:"<angle>";      initial-value:0deg;    inherits:false }
@property --gradient-percent      { syntax:"<percentage>"; initial-value:5%;      inherits:false }
@property --gradient-shine        { syntax:"<color>";      initial-value:#fff;    inherits:false }

.cta-shiny{
  --cta-bg:#0a0b0e; --cta-bg-subtle:#15171d;
  --cta-highlight:#c0c5ce; --cta-highlight-subtle:#eef1f5;
  --animation:gradient-angle linear infinite; --duration:3s; --shadow-size:2px;
  --transition:800ms cubic-bezier(.25,1,.5,1);

  isolation:isolate; position:relative; overflow:hidden; cursor:pointer;
  display:inline-flex; align-items:center; justify-content:center; gap:9px;
  padding:1.1rem 2.3rem; font-size:1rem; font-weight:500; line-height:1.2;
  color:#fff; text-decoration:none;
  border:1px solid transparent; border-radius:360px;

  /* fundo escuro no padding-box + luz girando no border-box */
  background:
    linear-gradient(var(--cta-bg),var(--cta-bg)) padding-box,
    conic-gradient(from calc(var(--gradient-angle) - var(--gradient-angle-offset)), transparent,
      var(--cta-highlight) var(--gradient-percent),
      var(--gradient-shine) calc(var(--gradient-percent)*2),
      var(--cta-highlight) calc(var(--gradient-percent)*3),
      transparent            calc(var(--gradient-percent)*4)) border-box;
  box-shadow:inset 0 0 0 1px var(--cta-bg-subtle);
  transition:var(--transition);
  transition-property:--gradient-angle-offset,--gradient-percent,--gradient-shine;
}

/* pontilhado que acompanha o ângulo da luz + shimmer que varre o corpo */
.cta-shiny::before,.cta-shiny::after,.cta-shiny > span::before{
  content:""; pointer-events:none; position:absolute;
  inset-inline-start:50%; inset-block-start:50%; translate:-50% -50%; z-index:-1;
}
.cta-shiny::before{
  --size:calc(100% - var(--shadow-size)*3); --position:2px; --space:calc(var(--position)*2);
  width:var(--size); height:var(--size);
  background:radial-gradient(circle at var(--position) var(--position),#fff calc(var(--position)/4),transparent 0) padding-box;
  background-size:var(--space) var(--space); background-repeat:space;
  mask-image:conic-gradient(from calc(var(--gradient-angle) + 45deg),black,transparent 10% 90%,black);
  -webkit-mask-image:conic-gradient(from calc(var(--gradient-angle) + 45deg),black,transparent 10% 90%,black);
  border-radius:inherit; opacity:.4;
}
.cta-shiny::after{
  --animation:shimmer linear infinite; width:100%; aspect-ratio:1;
  background:linear-gradient(-50deg,transparent,var(--cta-highlight),transparent);
  mask-image:radial-gradient(circle at bottom,transparent 40%,black);
  -webkit-mask-image:radial-gradient(circle at bottom,transparent 40%,black);
  opacity:.6;
}
/* o conteúdo precisa viver num <span> (pseudos ficam em z-index -1) */
.cta-shiny > span{ z-index:1; display:inline-flex; align-items:center; gap:8px }
.cta-shiny > span::before{
  --size:calc(100% + 1rem); width:var(--size); height:var(--size);
  box-shadow:inset 0 -1ex 2rem 4px var(--cta-highlight); opacity:0;
  transition:opacity var(--transition); animation:calc(var(--duration)*1.5) breathe linear infinite;
}

.cta-shiny,.cta-shiny::before,.cta-shiny::after{
  animation:var(--animation) var(--duration), var(--animation) calc(var(--duration)/.4) reverse paused;
  animation-composition:add;
}
.cta-shiny:is(:hover,:focus-visible){
  --gradient-percent:20%; --gradient-angle-offset:95deg; --gradient-shine:var(--cta-highlight-subtle);
}
.cta-shiny:is(:hover,:focus-visible),
.cta-shiny:is(:hover,:focus-visible)::before,
.cta-shiny:is(:hover,:focus-visible)::after{ animation-play-state:running }
.cta-shiny:is(:hover,:focus-visible) > span::before{ opacity:1 }
.cta-shiny:active{ translate:0 1px }

@keyframes gradient-angle{ to{ --gradient-angle:360deg } }
@keyframes shimmer{ to{ rotate:360deg } }
@keyframes breathe{ from,to{ scale:1 } 50%{ scale:1.2 } }
```

```html
<a class="cta-shiny" href="#"><span>Começar agora ↗</span></a>
```

**Estados (aprendidos na marra):**

```css
/* NUNCA use opacity para desabilitar: o botão fica translúcido e a luz de trás
   vaza através dele, parecendo defeito. Apague a cor, não o elemento. */
.cta-shiny:disabled{ color:rgba(255,255,255,.40); cursor:not-allowed; --gradient-percent:3% }
.cta-shiny:disabled::after{ opacity:.18 }

/* carregando: mesma luz, mais rápida */
.cta-shiny.is-busy{ cursor:progress; color:rgba(255,255,255,.92); --duration:1.1s }
```

> Também evite trocar `animation-duration` no `:hover` — isso reinicia a fase da
> animação e o brilho "pula". Para reagir ao hover, mude cor/brilho, não a duração.

### 3.2 Botão sólido prateado (secundário de alto contraste)

```css
.btn{ display:inline-flex; align-items:center; gap:10px; padding:14px 26px;
      border-radius:100px; font-size:14.5px; font-weight:500; cursor:pointer;
      border:1px solid transparent; transition:transform .25s,box-shadow .25s,background .25s }

.btn-solid{ background:linear-gradient(100deg,var(--s4),var(--s2) 52%,var(--s1));
            color:#0a0b0e; box-shadow:0 8px 28px rgba(198,205,215,.22) }
.btn-solid:hover{ transform:translateY(-2px); box-shadow:0 14px 38px rgba(198,205,215,.34) }
```

### 3.3 Botão fantasma

```css
.btn-ghost{ background:rgba(255,255,255,.04); border-color:rgba(255,255,255,.13); color:#fff }
.btn-ghost:hover{ background:rgba(255,255,255,.09); transform:translateY(-2px) }
```

> Convenção: setinha `↗` no fim do rótulo dos CTAs (`<span class="ar">↗</span>`,
> `font-size:12px; opacity:.7`).

---

## 4. Superfícies

### Cartão de vidro (padrão para qualquer painel)

```css
.glass-card{
  background:var(--glass);
  border:1px solid var(--line);
  border-radius:13px;
  box-shadow:inset 0 1px 0 var(--glass-top);   /* o inset é o que dá o "vidro" */
  padding:13px;
}
```

### Tile 3D (ícone com brilho de vidro moldado)

O truque são três sombras somadas: highlight fino no topo, escurecimento interno
embaixo e sombra externa larga.

```css
.tile{
  width:60px; height:60px; border-radius:17px; position:relative; overflow:hidden;
  display:flex; align-items:center; justify-content:center;
  background:linear-gradient(145deg,rgba(222,227,234,.30),rgba(128,138,156,.08));
  border:1px solid rgba(255,255,255,.2);
  box-shadow:
    inset 0 1.5px 1px rgba(255,255,255,.55),
    inset 0 -10px 18px rgba(0,0,0,.28),
    0 12px 26px rgba(0,0,0,.5);
  animation:float 5s ease-in-out infinite;
}
.tile::before{ content:""; position:absolute; inset:0; z-index:2;
  background:radial-gradient(130% 85% at 28% 6%,rgba(255,255,255,.62),transparent 46%) }
.tile::after{ content:""; position:absolute; inset:-45%; z-index:1;
  background:conic-gradient(from 210deg,transparent 0deg,rgba(255,255,255,.2) 46deg,transparent 100deg);
  animation:sweep 7s linear infinite }
.tile svg{ position:relative; z-index:3; color:#f2f5f8; filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.5)) }
```

### Nav que vira vidro ao rolar

```css
nav{ position:fixed; inset:0 0 auto; z-index:100; transition:.35s; border-bottom:1px solid transparent }
nav.scrolled{ background:rgba(8,9,11,.75); border-bottom-color:var(--line);
              backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px) }
```
```js
addEventListener('scroll',()=>nav.classList.toggle('scrolled',scrollY>20),{passive:true});
```

### Inputs

```css
.field{ width:100%; padding:9px 12px; border-radius:9px; outline:none;
        background:var(--glass); border:1px solid var(--line); color:#fff;
        box-shadow:inset 0 1px 0 var(--glass-top); transition:border-color .15s,background .15s }
.field:focus{ border-color:rgba(255,255,255,.22); background:var(--glass-hi) }
.field::placeholder{ color:var(--txt3) }
```

---

## 5. Efeitos de fundo e de luz

São eles que sustentam o tema. Todos `position:absolute`, `pointer-events:none`,
atrás do conteúdo (que fica em `z-index:3`).

### Glows — manchas de luz difusas

```css
.glow{ position:absolute; border-radius:50%; filter:blur(95px); pointer-events:none; z-index:0 }
.glow-top  { width:680px; height:440px; background:rgba(150,163,185,.16); top:-80px; left:50%; transform:translateX(-50%) }
.glow-left { width:460px; height:340px; background:rgba(110,122,145,.13); top:38%; left:-6% }
.glow-right{ width:460px; height:340px; background:rgba(110,122,145,.11); top:44%; right:-6% }
```

> `blur(95px)` é o valor certo: menos que isso vira "bolha", mais vira névoa.
> Opacidade sempre abaixo de `.16` — luz insinuada, não holofote.

### Beam — feixe vertical central

Ancora a composição no centro e dá verticalidade à hero.

```css
.beam{ position:absolute; top:0; left:50%; transform:translateX(-50%);
       width:2.5px; height:88%; z-index:1; filter:blur(2px); opacity:.8;
       background:linear-gradient(180deg,transparent,var(--s1) 22%,var(--s3) 62%,transparent);
       animation:beamPulse 4s ease-in-out infinite }
.beam::after{ content:""; position:absolute; top:0; left:50%; transform:translateX(-50%);
       width:200px; height:100%; filter:blur(38px);
       background:linear-gradient(180deg,rgba(200,208,220,.14),transparent 70%) }
@keyframes beamPulse{ 0%,100%{opacity:.5} 50%{opacity:1} }
```

### Parallax suave do glow com o mouse

```js
const g = document.querySelector('.glow-top');
addEventListener('mousemove', e=>{
  const x=(e.clientX/innerWidth-.5), y=(e.clientY/innerHeight-.5);
  g.style.transform=`translateX(-50%) translate(${x*42}px,${y*26}px)`;
},{passive:true});
```

### Shimmer (varredura de luz em placeholders/skeletons)

```css
.shimmer{ position:relative; overflow:hidden }
.shimmer::after{ content:""; position:absolute; inset:0; transform:translateX(-100%);
  background:linear-gradient(110deg,transparent 30%,rgba(255,255,255,.06) 50%,transparent 70%);
  animation:shim 3.2s linear infinite }
@keyframes shim{ to{ transform:translateX(100%) } }
```

### Pulso de foco (botão de play, indicadores)

```css
.pulse{ animation:pulse 2.6s ease-in-out infinite }
@keyframes pulse{ 0%,100%{ box-shadow:0 0 0 0 rgba(214,220,228,.3) }
                  50%    { box-shadow:0 0 0 18px rgba(214,220,228,0) } }
```

### Ponto luminoso (bullets de prova social)

```css
.dot{ width:5px; height:5px; border-radius:50%; background:var(--s3); box-shadow:0 0 8px var(--s3) }
```

### Carrossel infinito com bordas dissolvidas

```css
.marquee{ overflow:hidden;
  mask-image:linear-gradient(90deg,transparent,#000 7%,#000 93%,transparent);
  -webkit-mask-image:linear-gradient(90deg,transparent,#000 7%,#000 93%,transparent) }
.marquee:hover .track{ animation-play-state:paused }
```

---

## 6. Movimento

```css
@keyframes float { 0%,100%{ transform:translateY(0) } 50%{ transform:translateY(-5px) } }
@keyframes sweep { to{ transform:rotate(360deg) } }
```

### Reveal ao entrar na viewport

```css
.rv{ opacity:0; transform:translateY(28px);
     transition:opacity .8s cubic-bezier(.2,.7,.3,1), transform .8s cubic-bezier(.2,.7,.3,1) }
.rv.in{ opacity:1; transform:none }
.rv[data-d="1"]{ transition-delay:.1s }
.rv[data-d="2"]{ transition-delay:.2s }
.rv[data-d="3"]{ transition-delay:.3s }
```
```js
const io=new IntersectionObserver(es=>es.forEach(e=>e.isIntersecting&&e.target.classList.add('in')),{threshold:.12});
document.querySelectorAll('.rv').forEach(e=>io.observe(e));
```

### Mockup em perspectiva que endireita com o scroll

Começa inclinado e vai a 0° conforme sobe — preso à rolagem, não ao tempo.

```css
.stage{ perspective:1500px }
.mock{ transform:rotateX(var(--tilt,9deg)); transform-origin:top center; will-change:transform;
       border-radius:18px 18px 0 0; border:1px solid rgba(255,255,255,.12); border-bottom:0;
       box-shadow:inset 0 -1px 0 rgba(255,255,255,.16), 0 50px 100px rgba(0,0,0,.8);
       background:var(--panel); max-width:1080px; margin:0 auto; overflow:hidden }
```
```js
(function(){
  const mock=document.querySelector('.mock'); if(!mock) return;
  if(matchMedia('(prefers-reduced-motion:reduce)').matches){ mock.style.setProperty('--tilt','0deg'); return }
  const MAX=9; let agendado=false;
  const atualiza=()=>{ agendado=false;
    let p=1-(mock.getBoundingClientRect().top/(innerHeight*0.62));
    p=Math.min(1,Math.max(0,p));
    mock.style.setProperty('--tilt',(MAX*(1-p)).toFixed(2)+'deg'); };
  const agenda=()=>{ if(!agendado){ agendado=true; requestAnimationFrame(atualiza) } };
  addEventListener('scroll',agenda,{passive:true}); addEventListener('resize',agenda,{passive:true}); atualiza();
})();
```

### Acessibilidade

```css
@media (prefers-reduced-motion: reduce){
  .beam,.tile,.tile::after,.pulse,.shimmer::after,.grad,
  .cta-shiny,.cta-shiny::before,.cta-shiny::after{ animation:none }
  .rv{ opacity:1; transform:none; transition:none }
}
```

E foco sempre visível:

```css
:focus-visible{ outline:2px solid rgba(255,255,255,.55); outline-offset:3px }
```

---

## 7. Regras de ouro

1. **Sem cor de marca.** Se algo precisa de destaque, use branco mais forte ou
   mais luz — não um azul. A única exceção são estados semânticos (erro em
   `rgba(255,130,130,.92)`, sucesso em `rgba(200,225,200,.90)`, aviso em `#e8c07a`).
2. **Nada de `opacity` para desabilitar** elementos que tenham luz atrás — a luz
   vaza pelo elemento translúcido. Apague a cor do texto e recolha o brilho.
3. **Hierarquia por luz, não por tamanho.** O CTA principal não é maior; ele é o
   único com a borda girando.
4. **Bordas são luz.** Sempre `rgba(255,255,255,α)`. Cinza sólido mata o tema.
5. **Vidro precisa de `inset 0 1px 0`** no topo. Sem esse fio de luz, é só um
   retângulo escuro.
6. **Animação lenta.** 3–7s em loops ambientes. Rápido (< 1s) só em resposta a
   clique.
7. **Contraste do corpo de texto:** `rgba(255,255,255,.60)` é o piso. Abaixo
   disso só rótulo e legenda.

---

## 8. Onde cada coisa vive neste repositório

| O quê | Arquivo |
|---|---|
| Tokens, tipografia, glows, beam, tiles, reveal, marquee | `landing/index.html` (bloco `<style>` no `<head>`) |
| CTA prateado, vidro, toggles, inputs (versão compacta) | `extension/popup/popup.css` |
| Painel escuro com sidebar (aplicação logada) | `members/index.html` |
