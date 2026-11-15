/* ════════════════════════════════════════════════════════════════════════════
   CADPROP — MODO CAMPO  (index.html?t=CÓDIGO)          Poligonal · v1 · 14/11/2026

   O link do trabalho (gerado pelo comando CAMPOTRAB no AutoCAD) abre esta tela:
     🗺 Mapa     lotes do trabalho; tocar num lote; desenhar polígono novo; editar vértices; GPS
     👤 Pessoas  várias pessoas (o mesmo formulário do cadastro, com só o NOME obrigatório)
     📷 Fotos    câmera ou galeria; comprimidas; tipo + pessoa + lote + posição do celular
     📤 Enviar   nome de quem coletou, autorização e envio (ou fila, se estiver sem internet)

   SEM INTERNET: tudo fica no próprio celular (IndexedDB do navegador):
     kv     'trab:<cód>' = trabalho baixado · 'rasc:<cód>' = rascunho em andamento · 'cfg' = coletor
     fotos  id → {id, blob}   (as fotos ficam aqui até o envio dar certo)
     fila   envio → {corpo, fotos:[ids], enviadas:[ids], status}
   Ao voltar a internet (ou no botão "Enviar agora"): manda cada foto ({acao:'foto'}) e depois
   os dados ({acao:'campo'}). A fila só é limpa quando o servidor responde ok:true.
   ════════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';

const PAPEIS=['proprietário','confinante','possuidor','ocupante','herdeiro','procurador','informante','outro'];
const LADOS=['frente','fundos','lado direito','lado esquerdo','norte','sul','leste','oeste','nordeste','noroeste','sudeste','sudoeste'];
const TIPOS_FOTO=['fachada','documento da pessoa','documento do imóvel','print anotado','croqui','marco / divisa','cerca / muro','outro'];
const FOTO_MAX=1600, FOTO_QUAL=0.75;
const qs=new URLSearchParams(location.search);
const CODIGO=(qs.get('t')||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const agoraISO=()=>new Date().toISOString();
const novoId=p=>p+Date.now().toString(36).toUpperCase()+Math.random().toString(36).slice(2,6).toUpperCase();
const uuid=()=>(crypto.randomUUID?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return (c==='x'?r:(r&3|8)).toString(16);}));

/* ── IndexedDB ─────────────────────────────────────────────────────────── */
let _db=null;
function idb(){
  if(_db) return Promise.resolve(_db);
  return new Promise((ok,err)=>{
    const r=indexedDB.open('ptp-campo',1);
    r.onupgradeneeded=()=>{ const d=r.result;
      if(!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if(!d.objectStoreNames.contains('fotos')) d.createObjectStore('fotos',{keyPath:'id'});
      if(!d.objectStoreNames.contains('fila')) d.createObjectStore('fila',{keyPath:'envio'}); };
    r.onsuccess=()=>{ _db=r.result; ok(_db); };
    r.onerror=()=>err(r.error);
  });
}
async function tx(loja,modo,fn){
  const d=await idb();
  return new Promise((ok,err)=>{
    const t=d.transaction(loja,modo), s=t.objectStore(loja); let res;
    const q=fn(s); if(q) q.onsuccess=()=>{res=q.result;};
    t.oncomplete=()=>ok(res); t.onerror=()=>err(t.error); t.onabort=()=>err(t.error||new Error('gravação cancelada (espaço cheio?)'));
  });
}
const kvGet=k=>tx('kv','readonly',s=>s.get(k));
const kvPut=(k,v)=>tx('kv','readwrite',s=>s.put(v,k));
const kvDel=k=>tx('kv','readwrite',s=>s.delete(k));
const kvChaves=()=>tx('kv','readonly',s=>s.getAllKeys());
const fotoGet=id=>tx('fotos','readonly',s=>s.get(id));
const fotoPut=o=>tx('fotos','readwrite',s=>s.put(o));
const fotoDel=id=>tx('fotos','readwrite',s=>s.delete(id));
const filaTodos=()=>tx('fila','readonly',s=>s.getAll());
const filaPut=o=>tx('fila','readwrite',s=>s.put(o));
const filaDel=k=>tx('fila','readwrite',s=>s.delete(k));

/* ── Estado ────────────────────────────────────────────────────────────── */
let TRAB=null;              // trabalho baixado (PTP_TRABALHO_CAMPO)
let EST=null;               // rascunho: {codigo, envio, criado_em, fichas:[], fotos:[], geoms:{}, seq}
let CFG={coletor:{nome:'',tel:''}};
let _fichaEditando=null;    // id da ficha aberta no formulário (null = nova)
let _localFicha=null;       // {lat,lon,prec,em} marcado no formulário
/* grava na hora (o rascunho não tem as fotos, é pequeno): fechar o app logo depois não perde nada */
function salvarRascunho(){ kvPut('rasc:'+CODIGO,EST).catch(e=>toast('Não consegui guardar no celular: '+e.message,'err')); }
async function salvarJa(){ await kvPut('rasc:'+CODIGO,EST); }
function rascunhoNovo(){ return {codigo:CODIGO, envio:uuid(), criado_em:agoraISO(), fichas:[], fotos:[], geoms:{}, seq:0}; }

/* ── Estilos do modo campo ─────────────────────────────────────────────── */
const CSS=`
body.campo .obrig{display:none} body.campo .obrig.cp-sim{display:inline}
#campo{display:flex;flex-direction:column;gap:10px}
.cp-top{display:flex;align-items:center;justify-content:space-between;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:8px 12px}
.cp-top b{color:#fff;font-size:14px}.cp-cod{font-family:Consolas,monospace;color:var(--text-dim);font-size:12px;margin-left:6px}
.cp-rede{font-size:12px;white-space:nowrap}.cp-rede.on{color:#5cb87a}.cp-rede.off{color:#f0a040}
.cp-abas{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;position:sticky;top:0;z-index:1000;background:var(--bg);padding:2px 0}
.cp-abas button{padding:9px 2px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-muted);font:600 13px inherit;font-family:inherit;cursor:pointer}
.cp-abas button.ativa{border-color:var(--accent);color:#fff;background:rgba(74,143,245,.15)}
.cp-n{display:inline-block;min-width:16px;padding:0 4px;border-radius:8px;background:var(--surface-2);font-size:11px;margin-left:3px}
.cp-n.alerta{background:#8a5a12;color:#fff}
#cp-mapa-div{height:58vh;min-height:300px;border:1px solid var(--border);border-radius:var(--radius);background:#1b2230}
.cp-barra{display:flex;flex-wrap:wrap;gap:6px}
.cp-btn{padding:8px 11px;background:var(--surface-2);color:var(--text);border:1px solid var(--border);border-radius:var(--radius);font-size:13px;font-family:inherit;cursor:pointer;white-space:nowrap}
.cp-btn:hover{border-color:var(--accent)}.cp-btn.pri{background:var(--accent);border-color:var(--accent);color:#fff}
.cp-btn.ok{background:var(--ok);border-color:var(--ok);color:#fff}.cp-btn.perigo{color:#ff9a9a}
.cp-btn.liga{background:#6b2a2a;border-color:#a84444;color:#fff}.cp-btn:disabled{opacity:.4;cursor:default}
.cp-painel{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;display:flex;flex-direction:column;gap:8px;font-size:13px}
.cp-painel h3{font-size:14px;color:#fff}.cp-mut{color:var(--text-muted);font-size:12px}
.cp-lista{display:flex;flex-direction:column;gap:6px}
.cp-item{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:9px 12px;display:flex;gap:10px;align-items:center}
.cp-item .tx{flex:1;min-width:0}.cp-item .tx b{color:#fff;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cp-vazio{color:var(--text-dim);text-align:center;padding:22px 10px;background:var(--surface);border:1px dashed var(--border);border-radius:var(--radius)}
.cp-grade{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.cp-foto{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;display:flex;flex-direction:column}
.cp-foto img{width:100%;height:120px;object-fit:cover;background:#000;display:block}
.cp-foto .cx{padding:6px;display:flex;flex-direction:column;gap:4px}
.cp-foto select,.cp-foto input,.cp-painel select,.cp-painel input:not([type=checkbox]),.cp-env input:not([type=checkbox]){padding:5px 6px;background:var(--surface-2);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:13px;font-family:inherit;width:100%}
.cp-env{display:flex;flex-direction:column;gap:10px}
.cp-fila-item{font-size:12px;padding:6px 10px;border-radius:4px;background:var(--surface-2);display:flex;justify-content:space-between;gap:8px}
.cp-voltar{display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:8px 12px}
.cp-voltar b{color:#fff}
.cp-rot{background:rgba(13,17,23,.75);border:none;box-shadow:none;color:#fff;font-size:11px;font-weight:600;padding:1px 4px}
.cp-rot:before{display:none}
.cp-rot.cp-estudo{z-index:1000;background:#ff9f1a;color:#1b1203;text-align:center;line-height:1.25;padding:2px 6px;border-radius:3px;box-shadow:0 1px 4px rgba(0,0,0,.6)}
.cp-rot.cp-estudo b{font-size:11px;letter-spacing:.4px;display:block}
.cp-rot.cp-estudo span{font-weight:500;font-size:10.5px}
.cp-vert{background:#fff;border:2px solid #e05252;border-radius:50%}
.cp-mira{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:800;pointer-events:none}
.cp-mira svg{display:block;filter:drop-shadow(0 1px 3px rgba(0,0,0,.8))}
.cp-mira-txt{position:absolute;left:50%;top:calc(50% - 44px);transform:translateX(-50%);z-index:800;pointer-events:none;background:rgba(13,17,23,.85);color:#ffd27a;font-size:12px;font-weight:600;padding:2px 8px;border-radius:3px;white-space:nowrap}
.cp-pino svg{display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.7))}
.cp-pino-rot{background:rgba(13,17,23,.8);border:none;box-shadow:none;color:#ffd27a;font-size:11px;font-weight:600;padding:1px 4px}
.cp-pino-rot:before{display:none}
.cp-meio{background:rgba(255,255,255,.55);border:1px solid #e05252;border-radius:50%}
.cp-aviso{font-size:12px;background:#3a2a10;border:1px solid #8a5a12;color:#f3d29a;border-radius:var(--radius);padding:7px 10px;line-height:1.45}
.leaflet-container{font-family:inherit}
`;

/* ════════════════════════════════════════════════════════════════════════
   INÍCIO
   ════════════════════════════════════════════════════════════════════════ */
async function iniciar(){
  document.body.classList.add('campo');
  const st=document.createElement('style'); st.textContent=CSS; document.head.appendChild(st);
  document.querySelector('#header .subtitulo').textContent='Cadastro em campo — imóvel, pessoas, fotos e desenho';
  if(navigator.storage&&navigator.storage.persist) navigator.storage.persist().catch(()=>{});
  if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e=>console.warn('sw',e));

  const cont=document.querySelector('.container');
  const campo=document.createElement('div'); campo.id='campo'; cont.insertBefore(campo,cont.firstChild);
  $('form').hidden=true;
  try{ CFG=Object.assign(CFG, await kvGet('cfg')||{}); }catch(e){ campo.innerHTML=`<div class="cp-aviso">Este navegador não deixa guardar dados (modo anônimo?). Abra o link numa janela normal.</div>`; return; }

  if(!CODIGO){ await telaEscolher(); return; }
  campo.innerHTML='<div class="cp-vazio"><span class="spinner"></span> Carregando o trabalho…</div>';
  const t=await carregarTrabalho(CODIGO);
  if(!t){ return; }
  TRAB=t; await kvPut('ultimo',CODIGO);
  EST=await kvGet('rasc:'+CODIGO)||rascunhoNovo();
  prepararFormulario();
  montarTela();
  abrirAba('mapa');
  atualizarRede();
  window.addEventListener('online',()=>{ atualizarRede(); sincronizar(); });
  window.addEventListener('offline',atualizarRede);
  setInterval(()=>{ if(navigator.onLine) sincronizar(); },90000);
  sincronizar();
}

async function carregarTrabalho(cod){
  let cache=null; try{ cache=await kvGet('trab:'+cod); }catch{}
  let erro='';
  if(navigator.onLine){
    try{
      const ctrl=new AbortController(); const tm=setTimeout(()=>ctrl.abort(),20000);
      const r=await fetch(APPS_SCRIPT_URL+'?t='+encodeURIComponent(cod),{redirect:'follow',signal:ctrl.signal});
      clearTimeout(tm);
      const j=await r.json();
      if(j.ok && j.trabalho){ await kvPut('trab:'+cod,{trabalho:j.trabalho,baixado_em:agoraISO()}); return j.trabalho; }
      erro=j.erro||'trabalho não encontrado';
      if(j.encerrado && cache){ toast('Este trabalho foi encerrado no escritório. Você ainda pode enviar o que já coletou.','err'); return cache.trabalho; }
    }catch(e){ erro='sem resposta do servidor'; }
  }
  if(cache){ if(erro && navigator.onLine) toast('Usando a cópia guardada no celular ('+erro+').','inf'); return cache.trabalho; }
  $('campo').innerHTML=`<div class="cp-aviso"><b>Não consegui abrir o trabalho ${esc(cod)}.</b><br>${navigator.onLine?esc(erro)+'. Confira o link recebido.':'Na primeira vez é preciso internet para baixar o trabalho. Depois ele funciona sem internet.'}</div>
    <button class="cp-btn" onclick="location.reload()">Tentar de novo</button>`;
  return null;
}

/* ?campo sem código: escolhe um trabalho já baixado */
async function telaEscolher(){
  const ch=(await kvChaves()).filter(k=>String(k).startsWith('trab:'));
  const itens=[];
  for(const k of ch){ const v=await kvGet(k); if(v&&v.trabalho) itens.push(v.trabalho); }
  const ult=await kvGet('ultimo');
  if(ult && itens.some(t=>t.codigo===ult) && !qs.has('lista')){ location.replace('?t='+ult); return; }
  $('campo').innerHTML=`<div class="cp-painel"><h3>Trabalhos neste celular</h3>
    ${itens.length?itens.map(t=>`<a class="cp-btn" href="?t=${esc(t.codigo)}">${esc(t.nome||t.codigo)} <span class="cp-cod">${esc(t.codigo)}</span></a>`).join(''):'<div class="cp-mut">Nenhum trabalho baixado ainda.</div>'}
    <div class="cp-mut" style="margin-top:6px">Ou digite o código recebido:</div>
    <div class="cp-barra"><input id="cp-cod-in" maxlength="8" style="max-width:140px;text-transform:uppercase" placeholder="ABC123">
    <button class="cp-btn pri" onclick="location.href='?t='+encodeURIComponent(document.getElementById('cp-cod-in').value.trim())">Abrir</button></div></div>`;
}

/* ════════════════════════════════════════════════════════════════════════
   TELA
   ════════════════════════════════════════════════════════════════════════ */
function montarTela(){
  $('campo').innerHTML=`
  <div class="cp-top"><div><b>${esc(TRAB.nome||'Trabalho')}</b><span class="cp-cod">${esc(TRAB.codigo)}</span></div><div id="cp-rede" class="cp-rede"></div></div>
  <nav class="cp-abas">
    <button data-aba="mapa">🗺 Mapa</button>
    <button data-aba="pessoas">👤 Pessoas <span class="cp-n" id="n-pessoas">0</span></button>
    <button data-aba="fotos">📷 Fotos <span class="cp-n" id="n-fotos">0</span></button>
    <button data-aba="enviar">📤 Enviar <span class="cp-n" id="n-fila" hidden>0</span></button>
  </nav>
  <section id="aba-mapa" class="cp-env">
    <div id="cp-mapa-div"></div>
    <div class="cp-mut" id="cp-mapa-off"></div>
    <div class="cp-barra" id="cp-barra-mapa">
      <button class="cp-btn" id="b-gps">📍 Onde estou</button>
      <button class="cp-btn" id="b-tudo">⛶ Ver tudo</button>
      <button class="cp-btn" id="b-pino">◉ Indicar ponto</button>
      <button class="cp-btn" id="b-novo">✏ Desenhar polígono</button>
    </div>
    <div class="cp-painel" id="cp-painel"><div class="cp-mut">Toque num lote para ver, cadastrar pessoas ou corrigir o desenho.</div></div>
  </section>
  <section id="aba-pessoas" class="cp-env">
    <button class="cp-btn pri" id="b-nova-pessoa">＋ Cadastrar pessoa</button>
    <div class="cp-lista" id="cp-lista-pessoas"></div>
  </section>
  <section id="aba-fotos" class="cp-env">
    <div class="cp-barra">
      <label class="cp-btn pri">📷 Tirar foto<input type="file" accept="image/*" capture="environment" id="in-camera" hidden></label>
      <label class="cp-btn">🖼 Da galeria<input type="file" accept="image/*" multiple id="in-galeria" hidden></label>
    </div>
    <div class="cp-mut">As fotos são reduzidas (cerca de 300 KB) e ficam guardadas no celular até o envio.</div>
    <div class="cp-grade" id="cp-grade-fotos"></div>
  </section>
  <section id="aba-enviar" class="cp-env">
    <div class="cp-painel">
      <h3>Resumo</h3><div id="cp-resumo" class="cp-mut"></div>
      <div class="g2" style="display:grid;gap:8px;grid-template-columns:1fr 1fr">
        <div><div class="cp-mut">Seu nome (quem coletou)<span class="obrig cp-sim">*</span></div><input id="col-nome" autocomplete="name"></div>
        <div><div class="cp-mut">Seu telefone</div><input id="col-tel" inputmode="tel"></div>
      </div>
      <label class="chk"><input type="checkbox" id="col-consent"><span>Declaro que os dados foram informados pelas próprias pessoas (ou estão em documentos que elas mostraram) e autorizo a <b>Poligonal Topografia e Projetos</b> a usá-los só neste serviço, conforme a LGPD (Lei 13.709/2018).<span class="obrig cp-sim">*</span></span></label>
      <button class="btn-enviar" id="b-enviar">Enviar cadastro de campo</button>
      <div class="cp-mut" id="cp-envio-dica">Sem internet? Pode tocar em enviar mesmo assim: fica na fila e sai sozinho quando o sinal voltar (com esta página aberta).</div>
    </div>
    <div class="cp-painel"><h3>Fila de envio</h3><div id="cp-fila" class="cp-lista"></div>
      <button class="cp-btn" id="b-sinc">🔄 Enviar agora</button></div>
    <div class="cp-aviso">Não limpe os dados do navegador e não use aba anônima enquanto houver algo na fila. No iPhone, se você colocou o atalho na tela de início, abra sempre por ele (o Safari e o atalho guardam os dados em lugares diferentes).</div>
  </section>`;
  document.querySelectorAll('.cp-abas button').forEach(b=>b.onclick=()=>abrirAba(b.dataset.aba));
  $('b-gps').onclick=ondeEstou; $('b-tudo').onclick=verTudo; $('b-novo').onclick=()=>iniciarDesenho(); $('b-pino').onclick=()=>iniciarPino();
  $('b-nova-pessoa').onclick=()=>abrirFicha(null,{});
  $('in-camera').onchange=e=>receberFotos(e.target,'camera');
  $('in-galeria').onchange=e=>receberFotos(e.target,'galeria');
  $('col-nome').value=CFG.coletor.nome||''; $('col-tel').value=CFG.coletor.tel||'';
  $('col-tel').addEventListener('input',function(){ this.value=mTel(this.value); });
  ['col-nome','col-tel'].forEach(id=>$(id).addEventListener('change',()=>{ CFG.coletor={nome:$('col-nome').value.trim(),tel:$('col-tel').value.trim()}; kvPut('cfg',CFG); }));
  $('b-enviar').onclick=enfileirar; $('b-sinc').onclick=()=>sincronizar(true);
  iniciarMapa();
  contar();
}
function abrirAba(a){
  document.querySelectorAll('.cp-abas button').forEach(b=>b.classList.toggle('ativa',b.dataset.aba===a));
  ['mapa','pessoas','fotos','enviar'].forEach(x=>$('aba-'+x).hidden=x!==a);
  if(a==='mapa' && MAPA) setTimeout(()=>MAPA.invalidateSize(),50);
  if(a==='pessoas') renderPessoas();
  if(a==='fotos') renderFotos();
  if(a==='enviar') renderEnviar();
}
function atualizarRede(){ const el=$('cp-rede'); if(!el) return; const on=navigator.onLine; el.className='cp-rede '+(on?'on':'off'); el.textContent=on?'● com internet':'● sem internet'; }
async function contar(){
  $('n-pessoas').textContent=todasPessoas().length;
  $('n-fotos').textContent=EST.fotos.length;
  const pend=(await filaTodos()).filter(x=>x.status!=='ok').length;
  const n=$('n-fila'); n.hidden=!pend; n.textContent=pend; n.classList.toggle('alerta',pend>0);
}

/* ════════════════════════════════════════════════════════════════════════
   MAPA (Leaflet)
   ════════════════════════════════════════════════════════════════════════ */
let MAPA=null, CAM_PINOS=null, _pinoSel=null, CAM_ROT=null, CAM_LOTES=null, CAM_PESSOAS=null, CAM_EDICAO=null, _gpsMk=null, _gpsCirc=null;
let _selId=null, _modo=null;   // _modo: null | {tipo:'desenho'|'edicao', ...}
const camadasLote={};
function lotesTodos(){
  const base=((TRAB.lotes&&TRAB.lotes.features)||[]).map(f=>({id:String(f.properties.id), rotulo:f.properties.rotulo||f.properties.id, papel:f.properties.papel||'confinante', feat:f, novo:false}));
  Object.keys(EST.geoms).forEach(id=>{ const g=EST.geoms[id]; if(g.properties.origem==='novo') base.push({id, rotulo:g.properties.rotulo||id, papel:'novo', feat:g, novo:true}); });
  return base;
}
const loteDe=id=>lotesTodos().find(l=>l.id===id);
const rotuloLote=id=>{ const l=id&&loteDe(id); return l?l.rotulo:''; };
function geomAtual(l){ return EST.geoms[l.id]||l.feat; }

function iniciarMapa(){
  if(typeof L==='undefined'){ $('cp-mapa-div').innerHTML='<div class="cp-vazio">Mapa indisponível (arquivo lib/leaflet.js não carregou).</div>'; return; }
  MAPA=L.map('cp-mapa-div',{zoomControl:true,maxZoom:21,tap:true});
  const sat=L.tileLayer(SAT_URL,{maxNativeZoom:19,maxZoom:21,attribution:'Imagem © Esri'});
  const osm=L.tileLayer(OSM_URL,{maxNativeZoom:19,maxZoom:21,attribution:'© OpenStreetMap'});
  const nada=L.layerGroup();
  sat.addTo(MAPA); _fundo={camada:sat, url:SAT_URL};
  L.control.layers({'Satélite':sat,'Ruas':osm,'Sem fundo':nada},null,{position:'topright'}).addTo(MAPA);
  MAPA.on('baselayerchange',e=>{ _fundo={camada:e.layer, url:e.layer===sat?SAT_URL:e.layer===osm?OSM_URL:''}; medirMapaGuardado(); });
  MAPA.on('moveend',()=>{ clearTimeout(_tMedir); _tMedir=setTimeout(medirMapaGuardado,1500); });
  CAM_LOTES=L.featureGroup().addTo(MAPA); CAM_ROT=L.layerGroup().addTo(MAPA); CAM_PINOS=L.layerGroup().addTo(MAPA);
  MAPA.createPane('pinos').style.zIndex=700;   /* pontos ◉ por cima das etiquetas dos lotes */ CAM_PESSOAS=L.layerGroup().addTo(MAPA); CAM_EDICAO=L.layerGroup().addTo(MAPA);
  MAPA.on('click',e=>{ if(_modo&&_modo.tipo==='desenho') addVerticeDesenho(e.latlng); else if(_modo&&(_modo.tipo==='novopino'||_modo.tipo==='moverpino')) moverPinoNovo(e.latlng); else if(!_modo) limparSelecao(); });
  MAPA.on('zoomend',()=>$('cp-mapa-div').classList.toggle('sem-rot',MAPA.getZoom()<17));
  const st=document.createElement('style'); st.textContent='#cp-mapa-div.sem-rot .cp-rot:not(.cp-estudo){display:none} #cp-mapa-div.sem-rot .cp-estudo span{display:none}'; document.head.appendChild(st);
  desenharLotes(); verTudo(); setTimeout(medirMapaGuardado,2500);
}
/* ── Mapa guardado para uso sem internet (15/11/2026) ─────────────────────
   O sw.js guarda cada imagem de fundo que aparece na tela com internet. Aqui só
   medimos quanto da área do trabalho já está guardado, em dois níveis de zoom. */
const SAT_URL='https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const OSM_URL='https://tile.openstreetmap.org/{z}/{x}/{y}.png';
let _fundo=null, _tMedir=null;
function urlTile(modelo,z,x,y){ return modelo.replace('{z}',z).replace('{x}',x).replace('{y}',y); }
function tilesDaArea(z){
  const b=CAM_LOTES.getBounds(); if(!b.isValid()) return [];
  const m=b.pad(0.15), n=Math.pow(2,z);
  const tx=lon=>Math.floor((lon+180)/360*n);
  const ty=lat=>{ const r=lat*Math.PI/180; return Math.floor((1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*n); };
  const x0=tx(m.getWest()), x1=tx(m.getEast()), y0=ty(m.getNorth()), y1=ty(m.getSouth()), r=[];
  for(let x=x0;x<=x1;x++) for(let y=y0;y<=y1;y++) r.push([x,y]);
  return r;
}
async function medirMapaGuardado(){
  const el=$('cp-mapa-off'); if(!el||!MAPA||!('caches' in window)) return;
  if(!_fundo||!_fundo.url){ el.textContent=''; return; }
  try{
    const c=await caches.open('ptp-mapas-v1');
    const pct=async z=>{ const t=tilesDaArea(z); if(!t.length||t.length>1500) return null; let n=0;
      for(const [x,y] of t) if(await c.match(urlTile(_fundo.url,z,x,y))) n++; return Math.round(100*n/t.length); };
    const a=await pct(17), b=await pct(19);
    if(a==null&&b==null){ el.textContent=''; return; }
    const ok=a===100&&b===100;
    el.innerHTML=`🗺 Fundo guardado para usar sem internet: <b>${a??'—'}%</b> da área de longe · <b>${b??'—'}%</b> bem de perto`+
      (ok?' ✅':(navigator.onLine?' — com internet, passeie pelo mapa da área aproximando até ver as casas.':''));
  }catch{ el.textContent=''; }
}

function estiloLote(l){
  const sel=l.id===_selId, ed=!!EST.geoms[l.id]&&!l.novo;
  const cor=l.papel==='estudo'?'#ff9f1a':l.novo?'#3ddc84':'#4a8ff5';
  return {color:sel?'#ffffff':cor, weight:sel?4:2.5, fillColor:cor, fillOpacity:l.papel==='estudo'?.28:.12, dashArray:ed?'6 5':null};
}
function desenharLotes(){
  if(!MAPA) return;
  CAM_LOTES.clearLayers(); CAM_ROT.clearLayers();
  lotesTodos().forEach(l=>{
    const g=geomAtual(l);
    const lay=L.geoJSON(g,{style:()=>estiloLote(l)});
    lay.on('click',ev=>{ if(_modo) return; L.DomEvent.stopPropagation(ev); selecionarLote(l.id); });
    lay.addTo(CAM_LOTES); camadasLote[l.id]=lay;
    /* rótulo: tooltip solto numa camada própria (o permanente preso ao lote ficava duplicado ao redesenhar) */
    /* 15/11/2026: o imóvel em estudo leva a etiqueta "IMÓVEL EM ESTUDO" (sempre visível, mesmo de longe) */
    const est=l.papel==='estudo';
    try{ L.tooltip({permanent:true,direction:'center',className:'cp-rot'+(est?' cp-estudo':''),interactive:false}).setLatLng(lay.getBounds().getCenter())
      .setContent(est?`<b>IMÓVEL EM ESTUDO</b><span>${esc(l.rotulo)}</span>`:esc(l.rotulo)).addTo(CAM_ROT); }catch{}
  });
  desenharPinos();
  CAM_PESSOAS.clearLayers();
  EST.fichas.forEach(f=>{ if(!f.local || f.pino) return;   /* quem está num ponto aparece no próprio pino */
    L.circleMarker([f.local.lat,f.local.lon],{radius:6,color:'#fff',weight:2,fillColor:'#e05252',fillOpacity:1})
     .bindTooltip(esc((f.pessoas[0]||{}).NOME||'pessoa')).addTo(CAM_PESSOAS); });
}
function verTudo(){ if(!MAPA) return; try{ const b=CAM_LOTES.getBounds(); if(b.isValid()) MAPA.fitBounds(b,{padding:[20,20],maxZoom:19}); else MAPA.setView([-3.73,-38.52],13); }catch{ MAPA.setView([-3.73,-38.52],13); } }

function selecionarLote(id){
  _selId=id; _pinoSel=null; desenharLotes();
  const l=loteDe(id); if(!l){ painel('<div class="cp-mut">Toque num lote.</div>'); return; }
  const pessoas=EST.fichas.filter(f=>f.lote===id);
  const nf=EST.fotos.filter(f=>f.lote===id).length;
  const editado=!!EST.geoms[id]&&!l.novo;
  painel(`<h3>${esc(l.rotulo)} <span class="cp-mut">${l.papel==='estudo'?'· <b style="color:#ff9f1a">IMÓVEL EM ESTUDO</b>':l.novo?'· desenhado em campo':'· provável confinante'}${editado?' · desenho corrigido':''}</span></h3>
   ${pessoas.length?'<div>'+pessoas.map(f=>`👤 ${esc((f.pessoas[0]||{}).NOME)} <span class="cp-mut">${esc(f.papel||'')}${f.lado?' · '+esc(f.lado):''}</span>`).join('<br>')+'</div>':'<div class="cp-mut">Nenhuma pessoa ligada a este lote ainda.</div>'}
   ${nf?`<div class="cp-mut">📷 ${nf} foto(s) deste lote</div>`:''}
   <div class="cp-barra">
     <button class="cp-btn pri" id="pl-pessoa">👤 Cadastrar pessoa deste lote</button>
     <label class="cp-btn">📷 Foto deste lote<input type="file" accept="image/*" capture="environment" id="pl-foto" hidden></label>
     <button class="cp-btn" id="pl-editar">✏ Corrigir desenho</button>
     ${editado?'<button class="cp-btn" id="pl-desfazer">↺ Voltar ao desenho original</button>':''}
     ${l.novo?'<button class="cp-btn" id="pl-renomear">🏷 Renomear</button><button class="cp-btn perigo" id="pl-apagar">🗑 Apagar</button>':''}
     ${BTN_LIMPAR}
   </div>`);
  $('pl-pessoa').onclick=()=>abrirFicha(null,{lote:id, papel:l.papel==='estudo'?'proprietário':'confinante'});
  $('pl-foto').onchange=e=>receberFotos(e.target,'camera',{lote:id});
  $('pl-editar').onclick=()=>iniciarEdicao(id);
  if(editado) $('pl-desfazer').onclick=()=>{ if(!confirm('Descartar a correção e voltar ao desenho do escritório?')) return; delete EST.geoms[id]; salvarRascunho(); selecionarLote(id); };
  if(l.novo){
    $('pl-renomear').onclick=()=>{ const n=prompt('Nome do polígono:',l.rotulo); if(n&&n.trim()){ EST.geoms[id].properties.rotulo=n.trim(); salvarRascunho(); selecionarLote(id); } };
    $('pl-apagar').onclick=()=>{ if(!confirm('Apagar o polígono "'+l.rotulo+'"?')) return; delete EST.geoms[id];
      EST.fichas.forEach(f=>{ if(f.lote===id) f.lote=''; }); EST.fotos.forEach(f=>{ if(f.lote===id) f.lote=''; });
      _selId=null; salvarRascunho(); desenharLotes(); painel('<div class="cp-mut">Polígono apagado.</div>'); };
  }
}
function painel(html){ $('cp-painel').innerHTML=html; const b=$('b-limpar-sel'); if(b) b.onclick=limparSelecao; }
const PAINEL_VAZIO='<div class="cp-mut">Toque num lote para ver, cadastrar pessoas ou corrigir o desenho.</div>';
const BTN_LIMPAR='<button class="cp-btn" id="b-limpar-sel" title="Ou toque numa área vazia do mapa">✖ Limpar seleção</button>';
/* 15/11/2026: tocar no vazio do mapa (ou no botão) tira a seleção do lote/ponto */
function limparSelecao(){ if(_selId==null && _pinoSel==null) return; _selId=null; _pinoSel=null; desenharLotes(); painel(PAINEL_VAZIO); }

/* ── Pontos (pinos) — 15/11/2026 ────────────────────────────────────────
   Um "◉" na casa/terreno onde as informações estão sendo coletadas. Vai em
   geometrias.geojson como Point {id:'PT1', origem:'pino', rotulo}; pessoas e fotos
   podem apontar para ele (ficha.pino / foto.pino). */
function pinosTodos(){ return Object.values(EST.geoms).filter(g=>g.properties&&g.properties.origem==='pino'); }
const pinoDe=id=>EST.geoms[id]&&EST.geoms[id].properties.origem==='pino'?EST.geoms[id]:null;
const rotuloPino=id=>{ const p=id&&pinoDe(id); return p?p.properties.rotulo||id:''; };
function desenharPinos(){
  if(!MAPA) return;
  CAM_PINOS.clearLayers();
  pinosTodos().forEach(g=>{
    const id=g.properties.id, c=g.geometry.coordinates, sel=id===_pinoSel;
    if(_modo&&_modo.tipo==='moverpino'&&_modo.id===id) return;   /* enquanto move, quem aparece é a mira */
    const n=EST.fichas.filter(f=>f.pino===id).length;
    /* círculo (alvo): o CENTRO do círculo é a coordenada (iconAnchor = metade do tamanho) — pedido de 15/11/2026 */
    const t=sel?34:26, r=t/2;
    const html=`<svg width="${t}" height="${t}" viewBox="0 0 ${t} ${t}"><circle cx="${r}" cy="${r}" r="${r-2}" fill="${sel?'#ff9f1a':'#00acc1'}" stroke="#fff" stroke-width="3"/><circle cx="${r}" cy="${r}" r="${sel?4.5:3.5}" fill="#fff"/></svg>`;
    const mk=L.marker([c[1],c[0]],{icon:L.divIcon({className:'cp-pino',html,iconSize:[t,t],iconAnchor:[r,r]}),
      keyboard:false,zIndexOffset:1000,pane:'pinos'});
    mk.bindTooltip(esc(g.properties.rotulo||id)+(n?' · 👤'+n:''),{permanent:true,direction:'right',offset:[r,0],className:'cp-pino-rot'});
    mk.on('click',ev=>{ L.DomEvent.stopPropagation(ev); if(_modo) return; selecionarPino(id); });
    mk.addTo(CAM_PINOS);
  });
}
function localDoPino(id){ const g=pinoDe(id); if(!g) return null; const c=g.geometry.coordinates; return {lat:c[1],lon:c[0],prec:null,em:g.properties.criado_em||agoraISO(),origem:'pino'}; }
/* 15/11/2026: o ponto aparece NA HORA no centro da tela; a pessoa posiciona (arrasta, toca no mapa
   ou usa o GPS), confirma e só depois dá o nome. */
function iconeAlvo(t,cor,miolo){ const r=t/2;
  return L.divIcon({className:'cp-pino',iconSize:[t,t],iconAnchor:[r,r],
    html:`<svg width="${t}" height="${t}" viewBox="0 0 ${t} ${t}"><circle cx="${r}" cy="${r}" r="${r-2}" fill="${cor}" stroke="#fff" stroke-width="3"/><circle cx="${r}" cy="${r}" r="${miolo}" fill="#fff"/></svg>`}); }
/* 15/11/2026 (05h34): MIRA FIXA NO CENTRO — o ◉ fica parado no meio do mapa e a pessoa arrasta o
   MAPA por baixo, com o dedo em qualquer lugar (vê sempre onde o ponto está). A coordenada gravada é o
   centro do mapa = centro da mira (os dois pelo centro do mesmo quadro). Tocar no mapa leva o lugar
   tocado para baixo da mira. */
function mostrarMira(on,txt){
  const div=$('cp-mapa-div'); if(!div) return;
  div.querySelectorAll('.cp-mira,.cp-mira-txt').forEach(e=>e.remove());
  if(!on) return;
  const m=document.createElement('div'); m.className='cp-mira';
  m.innerHTML='<svg width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="#ff9f1a" fill-opacity=".85" stroke="#fff" stroke-width="3"/><circle cx="20" cy="20" r="4" fill="#fff"/></svg>';
  const t=document.createElement('div'); t.className='cp-mira-txt'; t.textContent=txt||'arraste o mapa até o ◉ ficar no lugar certo';
  div.appendChild(m); div.appendChild(t);
}
const pertoDe=(a,b)=>a&&b&&Math.abs(a.lat-b.lat)<1e-6&&Math.abs(a.lng-b.lng)<1e-6;
function iniciarPino(){
  if(_modo||!MAPA) return;
  _selId=null; _pinoSel=null; desenharLotes();
  _modo={tipo:'novopino', gps:null, gpsLL:null};
  mostrarMira(true);
  toast('Arraste o mapa (em qualquer lugar) até o ◉ ficar sobre a casa ou o terreno.','inf');
  $('cp-barra-mapa').hidden=true;
  painel(`<h3>◉ Indicar ponto</h3>
   <div class="cp-aviso">O ponto está no <b>centro do mapa</b> e fica parado. <b>Arraste o mapa</b> com o dedo, em qualquer lugar, até o ◉ ficar sobre a casa ou o terreno (ou toque no lugar certo). Aproxime o mapa para acertar melhor. Estando lá, pode usar o GPS.</div>
   <div class="cp-barra">
     <button class="cp-btn" id="pn-gps">📍 Levar para onde estou</button>
     <button class="cp-btn ok" id="pn-ok">✔ Está no lugar certo</button>
     <button class="cp-btn perigo" id="pn-cancel">✖ Cancelar</button>
   </div>`);
  $('pn-gps').onclick=async()=>{ const b=$('pn-gps'); b.disabled=true; b.textContent='📍 Buscando…';
    try{ const p=await posicao(); if(p.prec>15) toast('Atenção: precisão do GPS de '+Math.round(p.prec)+' m.','err');
      _modo.gps=p; MAPA.setView([p.lat,p.lon],Math.max(MAPA.getZoom(),18),{animate:false}); _modo.gpsLL=MAPA.getCenter(); }
    catch(e){ toast(e.message,'err'); }
    finally{ b.disabled=false; b.textContent='📍 Levar para onde estou'; } };
  $('pn-ok').onclick=()=>{ const c=MAPA.getCenter(); criarPino(c, pertoDe(c,_modo.gpsLL)?_modo.gps:null); };
  $('pn-cancel').onclick=sairModo;
}
function moverPinoNovo(ll){ if(_modo&&(_modo.tipo==='novopino'||_modo.tipo==='moverpino')) MAPA.panTo(ll); }
function criarPino(ll,gps){
  const seq=(EST.seqPino||0)+1;
  /* o ponto cai dentro de algum lote? fica anotado (o rótulo sugere o lote) */
  let lote='';
  try{ lotesTodos().forEach(l=>{ if(!lote && dentro([ll.lng,ll.lat],geomAtual(l).geometry)) lote=l.id; }); }catch{}
  const sug=(lote?rotuloLote(lote)+' — ':'')+'Ponto '+seq;
  const resp=prompt('Nome do ponto (ex.: casa do Sr. José, terreno de esquina):',sug);
  if(resp===null) return;                       /* "Cancelar" no nome: continua posicionando */
  const rot=resp.trim()||sug;
  EST.seqPino=seq; const id='PT'+seq;
  EST.geoms[id]={type:'Feature',properties:{id,origem:'pino',rotulo:rot,lote,criado_em:agoraISO(),gps:gps?{prec:gps.prec,em:gps.em}:null},
    geometry:{type:'Point',coordinates:[+ll.lng.toFixed(7),+ll.lat.toFixed(7)]}};
  salvarRascunho(); sairModo(); selecionarPino(id);
  if(MAPA) MAPA.panTo(ll);
}
/* ponto dentro de polígono (raio), só o anel externo */
function dentro(pt,geo){
  const anel=geo.type==='MultiPolygon'?geo.coordinates[0][0]:geo.coordinates[0]; let d=false;
  for(let i=0,j=anel.length-1;i<anel.length;j=i++){ const xi=anel[i][0],yi=anel[i][1],xj=anel[j][0],yj=anel[j][1];
    if(((yi>pt[1])!==(yj>pt[1])) && (pt[0]<(xj-xi)*(pt[1]-yi)/(yj-yi)+xi)) d=!d; }
  return d;
}
function selecionarPino(id){
  const g=pinoDe(id); if(!g) return;
  _pinoSel=id; _selId=null; desenharLotes();
  const fichas=EST.fichas.filter(f=>f.pino===id), nf=EST.fotos.filter(f=>f.pino===id).length;
  const c=g.geometry.coordinates;
  painel(`<h3>◉ ${esc(g.properties.rotulo||id)} <span class="cp-mut">${g.properties.lote?'· no '+esc(rotuloLote(g.properties.lote)):''}</span></h3>
   <div class="cp-mut">${c[1].toFixed(6)}, ${c[0].toFixed(6)}${g.properties.gps?' · GPS ±'+Math.round(g.properties.gps.prec)+' m':' · marcado no mapa'}</div>
   ${fichas.length?'<div>'+fichas.map(f=>`👤 ${esc((f.pessoas[0]||{}).NOME)} <span class="cp-mut">${esc(f.papel||'')}</span>`).join('<br>')+'</div>':'<div class="cp-mut">Nenhuma pessoa ligada a este ponto ainda.</div>'}
   ${nf?`<div class="cp-mut">📷 ${nf} foto(s) deste ponto</div>`:''}
   <div class="cp-barra">
     <button class="cp-btn pri" id="pp-pessoa">👤 Cadastrar pessoa deste ponto</button>
     <label class="cp-btn">📷 Foto deste ponto<input type="file" accept="image/*" capture="environment" id="pp-foto" hidden></label>
     <button class="cp-btn" id="pp-mover">✋ Mover</button>
     <button class="cp-btn" id="pp-renomear">🏷 Renomear</button>
     <button class="cp-btn perigo" id="pp-apagar">🗑 Apagar</button>
     ${BTN_LIMPAR}
   </div>`);
  $('pp-pessoa').onclick=()=>abrirFicha(null,{pino:id, lote:g.properties.lote||'', papel:'confinante'});
  $('pp-foto').onchange=e=>receberFotos(e.target,'camera',{pino:id, lote:g.properties.lote||'', tipo:'fachada'});
  $('pp-mover').onclick=()=>{
    const c0=g.geometry.coordinates;
    _modo={tipo:'moverpino',id,gps:null,gpsLL:null}; $('cp-barra-mapa').hidden=true;
    MAPA.setView([c0[1],c0[0]],Math.max(MAPA.getZoom(),18),{animate:false});
    desenharPinos(); mostrarMira(true);
    painel(`<h3>✋ Movendo: ${esc(g.properties.rotulo)}</h3><div class="cp-aviso"><b>Arraste o mapa</b> (em qualquer lugar) até o ◉ do centro ficar no lugar certo, ou toque no lugar certo.</div>
      <div class="cp-barra"><button class="cp-btn" id="pm-gps">📍 Levar para onde estou</button><button class="cp-btn ok" id="pm-ok">✔ Pronto</button><button class="cp-btn perigo" id="pm-cancel">✖ Cancelar</button></div>`);
    $('pm-gps').onclick=async()=>{ try{ const p=await posicao(); if(p.prec>15) toast('Atenção: precisão do GPS de '+Math.round(p.prec)+' m.','err');
      _modo.gps=p; MAPA.setView([p.lat,p.lon],Math.max(MAPA.getZoom(),18),{animate:false}); _modo.gpsLL=MAPA.getCenter(); }catch(e){ toast(e.message,'err'); } };
    $('pm-ok').onclick=()=>{ const c=MAPA.getCenter();
      g.geometry.coordinates=[+c.lng.toFixed(7),+c.lat.toFixed(7)]; g.properties.movido_em=agoraISO();
      g.properties.gps=pertoDe(c,_modo.gpsLL)&&_modo.gps?{prec:_modo.gps.prec,em:_modo.gps.em}:null;
      EST.fichas.forEach(f=>{ if(f.pino===id && f.local && f.local.origem==='pino') f.local=localDoPino(id); });
      salvarRascunho(); sairModo(); selecionarPino(id); };
    $('pm-cancel').onclick=()=>{ sairModo(); selecionarPino(id); }; };
  $('pp-renomear').onclick=()=>{ const n=prompt('Nome do ponto:',g.properties.rotulo); if(n&&n.trim()){ g.properties.rotulo=n.trim(); salvarRascunho(); selecionarPino(id); } };
  $('pp-apagar').onclick=()=>{ if(!confirm('Apagar o ponto "'+g.properties.rotulo+'"? As pessoas e fotos continuam, só perdem a ligação com o ponto.')) return;
    delete EST.geoms[id]; EST.fichas.forEach(f=>{ if(f.pino===id){ f.pino=''; } }); EST.fotos.forEach(f=>{ if(f.pino===id) f.pino=''; });
    _pinoSel=null; salvarRascunho(); desenharLotes(); painel('<div class="cp-mut">Ponto apagado.</div>'); };
}

/* ── GPS ───────────────────────────────────────────────────────────────── */
function posicao(timeout=20000){
  return new Promise((ok,err)=>{
    if(!navigator.geolocation){ err(new Error('este aparelho não informa a localização')); return; }
    navigator.geolocation.getCurrentPosition(p=>ok({lat:+p.coords.latitude.toFixed(7), lon:+p.coords.longitude.toFixed(7), prec:Math.round(p.coords.accuracy*10)/10, em:new Date(p.timestamp).toISOString()}),
      e=>err(new Error(e.code===1?'permissão de localização negada (libere nas configurações do navegador)':e.code===3?'o GPS demorou para responder':'localização indisponível')),
      {enableHighAccuracy:true,timeout,maximumAge:0});
  });
}
async function ondeEstou(){
  const b=$('b-gps'); b.disabled=true; b.textContent='📍 Buscando…';
  try{
    const p=await posicao();
    if(MAPA){
      if(_gpsMk){ _gpsMk.remove(); _gpsCirc.remove(); }
      _gpsCirc=L.circle([p.lat,p.lon],{radius:p.prec,color:'#4a8ff5',weight:1,fillOpacity:.15}).addTo(MAPA);
      _gpsMk=L.circleMarker([p.lat,p.lon],{radius:7,color:'#fff',weight:2,fillColor:'#4a8ff5',fillOpacity:1}).addTo(MAPA);
      MAPA.setView([p.lat,p.lon],Math.max(MAPA.getZoom(),18));
    }
    toast('Você está aqui (precisão de '+Math.round(p.prec)+' m).','ok');
  }catch(e){ toast(e.message,'err'); }
  finally{ b.disabled=false; b.textContent='📍 Onde estou'; }
}

/* ── Desenhar polígono novo ────────────────────────────────────────────── */
function iniciarDesenho(){
  if(_modo) return;
  _modo={tipo:'desenho', pts:[]}; _selId=null; desenharLotes();
  $('cp-barra-mapa').hidden=true;
  painelDesenho();
  toast('Toque no mapa para marcar cada canto do polígono.','inf');
}
function painelDesenho(){
  const n=_modo.pts.length;
  painel(`<h3>Desenhando polígono <span class="cp-mut">${n} vértice(s)</span></h3>
   <div class="cp-mut">Toque no mapa em cada canto, na ordem. Ou fique no canto e use o GPS.</div>
   <div class="cp-barra">
     <button class="cp-btn" id="d-gps">📍 Vértice onde estou</button>
     <button class="cp-btn" id="d-desf" ${n?'':'disabled'}>↶ Desfazer</button>
     <button class="cp-btn ok" id="d-ok" ${n>=3?'':'disabled'}>✔ Concluir</button>
     <button class="cp-btn perigo" id="d-cancel">✖ Cancelar</button>
   </div>`);
  $('d-gps').onclick=async()=>{ const b=$('d-gps'); b.disabled=true; b.textContent='📍 Buscando…';
    try{ const p=await posicao(); if(p.prec>10) toast('Atenção: precisão do GPS de '+Math.round(p.prec)+' m.','err'); addVerticeDesenho(L.latLng(p.lat,p.lon)); MAPA.panTo([p.lat,p.lon]); }
    catch(e){ toast(e.message,'err'); b.disabled=false; b.textContent='📍 Vértice onde estou'; } };
  $('d-desf').onclick=()=>{ _modo.pts.pop(); redesenharEdicao(); painelDesenho(); };
  $('d-ok').onclick=concluirDesenho;
  $('d-cancel').onclick=sairModo;
}
function addVerticeDesenho(ll){ _modo.pts.push([+ll.lat.toFixed(7),+ll.lng.toFixed(7)]); redesenharEdicao(); painelDesenho(); }
function concluirDesenho(){
  const pts=_modo.pts; if(pts.length<3) return;
  EST.seq=(EST.seq||0)+1;
  const id='N'+EST.seq;
  const rot=(prompt('Nome do polígono (ex.: casa do Sr. José, área do vizinho):','Polígono '+EST.seq)||'').trim()||('Polígono '+EST.seq);
  EST.geoms[id]=feicao(id,pts,{origem:'novo',rotulo:rot,criado_em:agoraISO()});
  salvarRascunho(); sairModo(); selecionarLote(id);
}
function feicao(id,pts,props){
  const anel=pts.map(p=>[p[1],p[0]]); anel.push(anel[0].slice());
  return {type:'Feature',properties:Object.assign({id},props),geometry:{type:'Polygon',coordinates:[anel]}};
}

/* ── Corrigir desenho (vértices arrastáveis) ───────────────────────────── */
function iniciarEdicao(id){
  const l=loteDe(id); if(!l) return;
  const g=geomAtual(l).geometry;
  let anel=g.type==='MultiPolygon'?g.coordinates[0][0]:g.coordinates[0];
  anel=anel.slice(0,-1).map(c=>[c[1],c[0]]);
  if(anel.length>250){ toast('Este desenho tem vértices demais para editar no celular.','err'); return; }
  _modo={tipo:'edicao', id, pts:anel, remover:false};
  $('cp-barra-mapa').hidden=true; _selId=id; desenharLotes();
  redesenharEdicao(); painelEdicao();
}
function painelEdicao(){
  painel(`<h3>Corrigindo: ${esc(rotuloLote(_modo.id))}</h3>
   <div class="cp-mut">Arraste os pontos brancos para mover um vértice. Toque num ponto pequeno (meio do lado) para criar um vértice novo.</div>
   <div class="cp-barra">
     <button class="cp-btn ${_modo.remover?'liga':''}" id="e-rem">🗑 Remover vértice: ${_modo.remover?'LIGADO (toque no vértice)':'desligado'}</button>
     <button class="cp-btn" id="e-gps">📍 Mover o vértice mais próximo para onde estou</button>
     <button class="cp-btn ok" id="e-ok">✔ Concluir</button>
     <button class="cp-btn perigo" id="e-cancel">✖ Cancelar</button>
   </div>`);
  $('e-rem').onclick=()=>{ _modo.remover=!_modo.remover; painelEdicao(); };
  $('e-gps').onclick=async()=>{ try{ const p=await posicao(); if(p.prec>10) toast('Atenção: precisão do GPS de '+Math.round(p.prec)+' m.','err');
      let mi=0,md=Infinity; _modo.pts.forEach((q,i)=>{ const d=MAPA.distance([p.lat,p.lon],q); if(d<md){md=d;mi=i;} });
      if(md>50 && !confirm('O vértice mais próximo está a '+Math.round(md)+' m. Mover mesmo assim?')) return;
      _modo.pts[mi]=[p.lat,p.lon]; redesenharEdicao(); }catch(e){ toast(e.message,'err'); } };
  $('e-ok').onclick=()=>{
    const l=loteDe(_modo.id), ant=EST.geoms[_modo.id];
    const props=l.novo?Object.assign({},ant.properties,{alterado_em:agoraISO()})
      :{origem:'editado', base:_modo.id, rotulo:l.rotulo, handle:(l.feat.properties||{}).handle||'', editado_em:agoraISO()};
    EST.geoms[_modo.id]=feicao(_modo.id,_modo.pts,props);
    const id=_modo.id; salvarRascunho(); sairModo(); selecionarLote(id); toast('Desenho corrigido.','ok');
  };
  $('e-cancel').onclick=()=>{ const id=_modo.id; sairModo(); selecionarLote(id); };
}
function redesenharEdicao(){
  CAM_EDICAO.clearLayers();
  const pts=_modo.pts; if(!pts.length) return;
  if(pts.length>=2) (_modo.tipo==='desenho'&&pts.length<3?L.polyline(pts,{color:'#ff5252',weight:3}):L.polygon(pts,{color:'#ff5252',weight:3,fillOpacity:.15,interactive:false})).addTo(CAM_EDICAO);
  const ic=new L.DivIcon({className:'cp-vert',iconSize:[18,18]}), icM=new L.DivIcon({className:'cp-meio',iconSize:[12,12]});
  pts.forEach((p,i)=>{
    const m=L.marker(p,{icon:ic,draggable:_modo.tipo==='edicao',keyboard:false}).addTo(CAM_EDICAO);
    if(_modo.tipo!=='edicao') return;
    m.on('drag',e=>{ const ll=e.target.getLatLng(); pts[i]=[+ll.lat.toFixed(7),+ll.lng.toFixed(7)]; });
    m.on('dragend',()=>redesenharEdicao());
    m.on('click',()=>{ if(!_modo.remover) return; if(pts.length<=3){ toast('O polígono precisa de pelo menos 3 vértices.','err'); return; } pts.splice(i,1); redesenharEdicao(); });
  });
  if(_modo.tipo==='edicao') pts.forEach((p,i)=>{
    const q=pts[(i+1)%pts.length];
    L.marker([(p[0]+q[0])/2,(p[1]+q[1])/2],{icon:icM,keyboard:false}).addTo(CAM_EDICAO)
     .on('click',()=>{ pts.splice(i+1,0,[+((p[0]+q[0])/2).toFixed(7),+((p[1]+q[1])/2).toFixed(7)]); redesenharEdicao(); });
  });
}
function sairModo(){ _modo=null; _pinoSel=null; mostrarMira(false); CAM_EDICAO.clearLayers(); $('cp-barra-mapa').hidden=false; desenharLotes(); painel('<div class="cp-mut">Toque num lote para ver, cadastrar pessoas ou corrigir o desenho.</div>'); }

/* ════════════════════════════════════════════════════════════════════════
   PESSOAS (fichas) — usa o formulário do index.html
   ════════════════════════════════════════════════════════════════════════ */
function todasPessoas(){ const r=[]; EST.fichas.forEach(f=>f.pessoas.forEach((p,i)=>r.push({p, f, i}))); return r; }
function nomePessoaId(pid){ const x=todasPessoas().find(o=>o.p._id===pid); return x?x.p.NOME+(x.i>0?' (cônjuge/representante)':''):''; }

function prepararFormulario(){
  const f=$('form');
  f.insertAdjacentHTML('afterbegin',`
   <div class="cp-voltar"><button type="button" class="cp-btn" id="f-voltar">← Voltar</button><b id="f-titulo">Nova pessoa</b></div>
   <div class="sec" id="sec-vinculo"><div class="sec-title">Ligação com o imóvel</div><div class="sec-body g3">
     <div class="fld"><label for="V_LOTE">Lote / imóvel</label><select id="V_LOTE"></select></div>
     <div class="fld"><label for="V_PAPEL">Esta pessoa é</label><select id="V_PAPEL">${PAPEIS.map(p=>`<option>${p}</option>`).join('')}</select></div>
     <div class="fld"><label for="V_LADO">Lado (em relação ao imóvel em estudo)</label><select id="V_LADO"><option value="">—</option>${LADOS.map(p=>`<option>${p}</option>`).join('')}</select></div>
     <div class="fld full" id="f-pino"><label for="V_PINO">◉ Ponto no mapa (casa / terreno)</label><select id="V_PINO"></select></div>
     <div class="fld full"><div class="cp-barra" style="align-items:center"><button type="button" class="cp-btn" id="V_GPS">📍 Marcar onde estou</button><span class="cp-mut" id="V_LOCAL">sem local marcado</span></div></div>
   </div></div>
   <div class="sec" id="sec-fotos-pessoa"><div class="sec-title">📷 Fotos desta pessoa <span class="opc">fachada, documentos da pessoa, documentos do imóvel…</span></div><div class="sec-body">
     <div class="cp-barra" style="align-items:center">
       <select id="V_FTIPO" style="max-width:200px;padding:7px 6px;background:var(--surface-2);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:14px">${TIPOS_FOTO.map(t=>`<option>${t}</option>`).join('')}</select>
       <label class="cp-btn pri">📷 Tirar foto<input type="file" accept="image/*" capture="environment" id="V_FCAM" hidden></label>
       <label class="cp-btn">🖼 Da galeria<input type="file" accept="image/*" multiple id="V_FGAL" hidden></label>
     </div>
     <div class="cp-mut">Escolha o tipo antes de tirar a foto (dá para mudar depois). As fotos ficam ligadas a esta pessoa e vão junto no envio.</div>
     <div class="cp-grade" id="V_FOTOS"></div>
   </div></div>`);
  $('f-voltar').onclick=async()=>{
    const novas=_fotosSessao.length;
    if(!confirm('Sair sem salvar esta pessoa?'+(novas?'\n\nAs '+novas+' foto(s) tiradas agora também serão descartadas.':''))) return;
    for(const fid of _fotosSessao){ EST.fotos=EST.fotos.filter(x=>x.id!==fid); try{ await fotoDel(fid); }catch{} }
    _fotosSessao=[]; await salvarJa(); contar(); fecharFicha(); };
  const fotoDaFicha=(inp,origem)=>receberFotos(inp,origem,{pessoa:_fichaId+'-1', tipo:$('V_FTIPO').value, lote:$('V_LOTE').value, pino:$('V_PINO').value, naFicha:true});
  $('V_FCAM').onchange=e=>fotoDaFicha(e.target,'camera');
  $('V_FGAL').onchange=e=>fotoDaFicha(e.target,'galeria');
  $('V_GPS').onclick=async()=>{ const b=$('V_GPS'); b.disabled=true; b.textContent='📍 Buscando…';
    try{ _localFicha=await posicao(); mostrarLocalFicha(); }catch(e){ toast(e.message,'err'); }
    finally{ b.disabled=false; b.textContent='📍 Marcar onde estou'; } };
  /* só o nome é obrigatório no campo */
  const lblNome=document.querySelector('label[for=NOME]'); if(lblNome) lblNome.querySelector('.obrig')?.classList.add('cp-sim');
  const lblPj=document.querySelector('label[for=PJ_NOME]'); if(lblPj) lblPj.querySelector('.obrig')?.classList.add('cp-sim');
  const c=$('CONSENT'); if(c) c.parentElement.querySelector('span').innerHTML='A pessoa autorizou o uso destes dados para o serviço (LGPD). <span class="cp-mut">Se não autorizou, deixe desmarcado: guardamos só o necessário.</span>';
  $('btn-enviar').textContent='Salvar pessoa';
  document.querySelector('.aviso').innerHTML='Preencha o que a pessoa souber informar. Só o <b>nome</b> é obrigatório; CPF, se informado, é conferido.';
}
function mostrarLocalFicha(){ $('V_LOCAL').textContent=_localFicha?`${_localFicha.lat.toFixed(6)}, ${_localFicha.lon.toFixed(6)} `+(_localFicha.origem==='pino'?'(local do ponto ◉)':`(±${Math.round(_localFicha.prec)} m)`):'sem local marcado'; }
function opcoesLotes(sel){ return '<option value="">— nenhum —</option>'+lotesTodos().map(l=>`<option value="${esc(l.id)}"${l.id===sel?' selected':''}>${esc(l.rotulo)}${l.papel==='estudo'?' — IMÓVEL EM ESTUDO':''}</option>`).join(''); }

function lerCampos(){
  const v={}, c={};
  $('form').querySelectorAll('input[id],select[id],textarea[id]').forEach(el=>{
    if(el.id.startsWith('V_')||el.id==='site'||el.type==='file') return;
    if(el.type==='checkbox') c[el.id]=el.checked; else if(el.type!=='radio') v[el.id]=el.value;
  });
  return {tipo:tipoAtual(), v, c};
}
function porCampos(raw){
  $('form').reset();
  if(raw&&raw.tipo){ const r=document.querySelector(`input[name=tipo][value=${raw.tipo}]`); if(r) r.checked=true; }
  Object.entries((raw&&raw.v)||{}).forEach(([k,val])=>{ const el=$(k); if(el) el.value=val; });
  Object.entries((raw&&raw.c)||{}).forEach(([k,val])=>{ const el=$(k); if(el) el.checked=!!val; });
  trocarTipo();
  const est=raw&&raw.v?raw.v.ESTCIVIL:''; aoMudarEstCivil();
  if(raw&&raw.v){ Object.entries(raw.v).forEach(([k,val])=>{ const el=$(k); if(el && !el.closest('[hidden]')) el.value=val; }); }
  if(raw&&raw.c&&$('cad-conj')){ $('cad-conj').checked=!!raw.c['cad-conj']; aoMarcarConj(); }
  document.querySelectorAll('#form .err').forEach(el=>marcar(el.id,true));
  return est;
}

/* 15/11/2026: a ficha já nasce com o id, para as fotos tiradas DENTRO do cadastro ficarem ligadas a ela */
let _fichaId=null, _fotosSessao=[];
async function renderFotosFicha(){
  const el=$('V_FOTOS'); if(!el) return;
  const minhas=EST.fotos.filter(f=>String(f.pessoa||'').startsWith(_fichaId+'-'));
  if(!minhas.length){ el.innerHTML='<div class="cp-mut" style="grid-column:1/-1">Nenhuma foto ainda.</div>'; return; }
  el.innerHTML=minhas.map(f=>`<div class="cp-foto" data-id="${f.id}"><img alt=""><div class="cx">
     <select data-k="tipo">${(TIPOS_FOTO.includes(f.tipo)?TIPOS_FOTO:TIPOS_FOTO.concat([f.tipo])).map(t=>`<option${t===f.tipo?' selected':''}>${t}</option>`).join('')}</select>
     <input data-k="legenda" placeholder="legenda (opcional)" value="${esc(f.legenda)}">
     <div class="cp-barra" style="justify-content:flex-end"><button type="button" class="cp-btn perigo" data-del>🗑</button></div></div></div>`).join('');
  el.querySelectorAll('.cp-foto').forEach(async card=>{
    const id=card.dataset.id, f=EST.fotos.find(x=>x.id===id);
    card.querySelector('img').src=await urlFoto(id);
    card.querySelectorAll('[data-k]').forEach(inp=>inp.addEventListener('change',()=>{ f[inp.dataset.k]=inp.value; salvarRascunho(); }));
    card.querySelector('[data-del]').onclick=async()=>{ if(!confirm('Apagar esta foto?')) return;
      EST.fotos=EST.fotos.filter(x=>x.id!==id); _fotosSessao=_fotosSessao.filter(x=>x!==id); await fotoDel(id); await salvarJa(); contar(); renderFotosFicha(); };
  });
}
function abrirFicha(id,pre){
  if(_modo) sairModo();
  _fichaEditando=id; _fichaId=id||novoId('P'); _fotosSessao=[];
  const f=id?EST.fichas.find(x=>x.id===id):null;
  porCampos(f?f.raw:null);
  _nacionEditada=!!(f && f.raw && f.raw.v && f.raw.v.NACION);
  $('V_LOTE').innerHTML=opcoesLotes(f?f.lote:(pre.lote||''));
  $('V_PAPEL').value=f?(f.papel||'confinante'):(pre.papel||'confinante');
  $('V_LADO').value=f?(f.lado||''):'';
  const pinoIni=f?(f.pino||''):(pre.pino||'');
  $('V_PINO').innerHTML='<option value="">— nenhum —</option>'+pinosTodos().map(g=>`<option value="${esc(g.properties.id)}"${g.properties.id===pinoIni?' selected':''}>${esc(g.properties.rotulo)}</option>`).join('');
  $('f-pino').hidden=!pinosTodos().length;
  _localFicha=f?f.local||null:(pre.pino?localDoPino(pre.pino):null); mostrarLocalFicha();
  $('f-titulo').textContent=f?'Editar: '+((f.pessoas[0]||{}).NOME||''):'Nova pessoa'+(pre.pino?' — ◉ '+rotuloPino(pre.pino):pre.lote?' — '+rotuloLote(pre.lote):'');
  $('V_FTIPO').value='fachada'; renderFotosFicha();
  $('campo').hidden=true; $('form').hidden=false; window.scrollTo({top:0});
}
function fecharFicha(){ $('form').hidden=true; $('campo').hidden=false; _fichaEditando=null; abrirAba('pessoas'); window.scrollTo({top:0}); }

/* chamado pelo submit do index.html (já validado) */
function salvarFicha(){
  const pessoas=montarPessoas().filter(p=>p.NOME);
  if(!pessoas.length){ toast('Informe o nome.','err'); return; }
  let f=_fichaEditando?EST.fichas.find(x=>x.id===_fichaEditando):null;
  if(!f){ f={id:_fichaId||novoId('P'), criado_em:agoraISO()}; EST.fichas.push(f); }
  _fotosSessao=[];
  const antigos=(f.pessoas||[]).map(p=>p._id);
  pessoas.forEach((p,i)=>{ p._id=f.id+'-'+(i+1); });
  f.raw=lerCampos(); f.tipo=f.raw.tipo; f.pessoas=pessoas;
  f.lote=$('V_LOTE').value; f.papel=$('V_PAPEL').value; f.lado=$('V_LADO').value; f.pino=$('V_PINO').value;
  /* sem GPS marcado: a pessoa fica no local do ponto */
  if(f.pino && (!_localFicha || _localFicha.origem==='pino')) _localFicha=localDoPino(f.pino);
  if(!f.pino && _localFicha && _localFicha.origem==='pino') _localFicha=null;
  f.local=_localFicha; f.autorizou=!!($('CONSENT')&&$('CONSENT').checked); f.alterado_em=agoraISO();
  /* foto ligada a uma pessoa que saiu (ex.: cônjuge desmarcado) passa para o titular */
  antigos.filter(a=>!pessoas.some(p=>p._id===a)).forEach(a=>EST.fotos.forEach(ft=>{ if(ft.pessoa===a) ft.pessoa=pessoas[0]._id; }));
  salvarJa().then(()=>{ toast('Pessoa salva no celular.','ok'); desenharLotes(); contar(); fecharFicha(); })
           .catch(e=>toast('Não consegui guardar: '+e.message,'err'));
}
function excluirFicha(id){
  const f=EST.fichas.find(x=>x.id===id); if(!f) return;
  if(!confirm('Excluir o cadastro de '+((f.pessoas[0]||{}).NOME||'')+'?')) return;
  const ids=f.pessoas.map(p=>p._id);
  EST.fichas=EST.fichas.filter(x=>x.id!==id);
  EST.fotos.forEach(ft=>{ if(ids.includes(ft.pessoa)) ft.pessoa=''; });
  salvarRascunho(); renderPessoas(); desenharLotes(); contar();
}
function renderPessoas(){
  const el=$('cp-lista-pessoas');
  if(!EST.fichas.length){ el.innerHTML='<div class="cp-vazio">Nenhuma pessoa cadastrada ainda.<br>Toque em “Cadastrar pessoa” ou num lote do mapa.</div>'; return; }
  el.innerHTML=EST.fichas.map(f=>{
    const p0=f.pessoas[0]||{}, nf=EST.fotos.filter(x=>f.pessoas.some(p=>p._id===x.pessoa)).length;
    const cpf=p0.CPFCNPJ?p0.CPFCNPJ:'sem CPF';
    return `<div class="cp-item"><div class="tx"><b>${esc(p0.NOME)}${f.pessoas.length>1?' <span class="cp-mut">+ '+esc(f.pessoas.slice(1).map(p=>p.NOME).join(', '))+'</span>':''}</b>
      <span class="cp-mut">${esc(cpf)} · ${esc(f.papel||'')}${f.lote?' · '+esc(rotuloLote(f.lote)):''}${f.pino?' · ◉'+esc(rotuloPino(f.pino)):''}${f.lado?' · '+esc(f.lado):''}${nf?' · 📷'+nf:''}${f.local&&!f.pino?' · 📍':''}</span></div>
      <button class="cp-btn" data-ed="${f.id}">✏</button><button class="cp-btn perigo" data-ex="${f.id}">🗑</button></div>`;
  }).join('');
  el.querySelectorAll('[data-ed]').forEach(b=>b.onclick=()=>abrirFicha(b.dataset.ed,{}));
  el.querySelectorAll('[data-ex]').forEach(b=>b.onclick=()=>excluirFicha(b.dataset.ex));
}

/* ════════════════════════════════════════════════════════════════════════
   FOTOS
   ════════════════════════════════════════════════════════════════════════ */
function carregarImg(file){
  return new Promise((ok,err)=>{ const u=URL.createObjectURL(file), im=new Image();
    im.onload=()=>{ ok({im,u}); }; im.onerror=()=>{ URL.revokeObjectURL(u); err(new Error('imagem não reconhecida (HEIC? tire a foto pelo botão da câmera)')); }; im.src=u; });
}
async function comprimir(file){
  const {im,u}=await carregarImg(file);
  try{
    const w0=im.naturalWidth, h0=im.naturalHeight, k=Math.min(1,FOTO_MAX/Math.max(w0,h0));
    const w=Math.round(w0*k), h=Math.round(h0*k);
    const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
    cv.getContext('2d').drawImage(im,0,0,w,h);
    const blob=await new Promise(ok=>cv.toBlob(ok,'image/jpeg',FOTO_QUAL));
    if(!blob) throw new Error('não consegui reduzir a foto');
    return {blob,w,h};
  } finally { URL.revokeObjectURL(u); }
}
async function receberFotos(input,origem,pre={}){
  const files=[...(input.files||[])]; input.value='';
  if(!files.length) return;
  let pos=null;
  if(origem==='camera'){ try{ pos=await posicao(12000); }catch(e){ toast('Foto sem localização: '+e.message,'inf'); } }
  let n=0;
  for(const file of files){
    try{
      const {blob,w,h}=await comprimir(file);
      const id=novoId('F');
      await fotoPut({id,blob});
      EST.fotos.push({id, nome:id+'.jpg', tipo:pre.tipo||(origem==='camera'?'fachada':'outro'), pessoa:pre.pessoa||'', lote:pre.lote||'', pino:pre.pino||'', legenda:'',
        lat:pos?pos.lat:null, lon:pos?pos.lon:null, prec:pos?pos.prec:null,
        em:origem==='camera'?agoraISO():new Date(file.lastModified||Date.now()).toISOString(), origem, w, h, bytes:blob.size, original:file.name||''});
      if(pre.naFicha) _fotosSessao.push(id);
      n++;
    }catch(e){ toast((file.name||'foto')+': '+e.message,'err'); }
  }
  await salvarJa(); contar();
  if(n){ toast(n+' foto(s) guardada(s) no celular.','ok'); if(pre.naFicha) renderFotosFicha(); else abrirAba('fotos'); }
}
const _urls=new Map();
async function urlFoto(id){ if(_urls.has(id)) return _urls.get(id); const o=await fotoGet(id); if(!o) return ''; const u=URL.createObjectURL(o.blob); _urls.set(id,u); return u; }
async function renderFotos(){
  const el=$('cp-grade-fotos');
  if(!EST.fotos.length){ el.innerHTML='<div class="cp-vazio" style="grid-column:1/-1">Nenhuma foto ainda.</div>'; return; }
  const pess=todasPessoas();
  const optP=sel=>'<option value="">— pessoa —</option>'+pess.map(o=>`<option value="${esc(o.p._id)}"${o.p._id===sel?' selected':''}>${esc(o.p.NOME)}${o.i>0?' (2ª)':''}</option>`).join('');
  const pinos=pinosTodos();
  const optT=sel=>(TIPOS_FOTO.includes(sel)||!sel?TIPOS_FOTO:TIPOS_FOTO.concat([sel])).map(t=>`<option${t===sel?' selected':''}>${t}</option>`).join('');
  el.innerHTML=EST.fotos.map(f=>`<div class="cp-foto" data-id="${f.id}"><img alt="">
    <div class="cx"><select data-k="tipo">${optT(f.tipo)}</select><select data-k="pessoa">${optP(f.pessoa)}</select>
    <select data-k="lote">${opcoesLotes(f.lote).replace('— nenhum —','— lote —')}</select>
    ${pinos.length?`<select data-k="pino"><option value="">— ponto ◉ —</option>${pinos.map(g=>`<option value="${esc(g.properties.id)}"${g.properties.id===f.pino?' selected':''}>◉ ${esc(g.properties.rotulo)}</option>`).join('')}</select>`:''}
    <input data-k="legenda" placeholder="legenda (opcional)" value="${esc(f.legenda)}">
    <div class="cp-barra" style="justify-content:space-between"><span class="cp-mut">${f.lat!=null?'📍 ±'+Math.round(f.prec)+' m':'sem local'} · ${Math.round(f.bytes/1024)} KB</span><button class="cp-btn perigo" data-del>🗑</button></div></div></div>`).join('');
  el.querySelectorAll('.cp-foto').forEach(async card=>{
    const id=card.dataset.id, f=EST.fotos.find(x=>x.id===id);
    card.querySelector('img').src=await urlFoto(id);
    card.querySelectorAll('[data-k]').forEach(inp=>inp.addEventListener('change',()=>{ f[inp.dataset.k]=inp.value; salvarRascunho(); }));
    card.querySelector('[data-del]').onclick=async()=>{ if(!confirm('Apagar esta foto?')) return; EST.fotos=EST.fotos.filter(x=>x.id!==id); await fotoDel(id); await salvarJa(); renderFotos(); contar(); };
  });
}

/* ════════════════════════════════════════════════════════════════════════
   ENVIO
   ════════════════════════════════════════════════════════════════════════ */
function renderEnviar(){
  const np=todasPessoas().length, nf=EST.fotos.length, npt=pinosTodos().length, ng=Object.keys(EST.geoms).length-npt;
  $('cp-resumo').innerHTML=`${np} pessoa(s) · ${nf} foto(s) · ${npt} ponto(s) ◉ · ${ng} desenho(s) novo(s) ou corrigido(s)`+
    (np||nf||ng||npt?'':'<br>Nada para enviar ainda.');
  $('b-enviar').disabled=!(np||nf||ng||npt);
  renderFila();
}
async function renderFila(){
  const f=(await filaTodos()).sort((a,b)=>String(b.criado_em).localeCompare(a.criado_em));
  $('cp-fila').innerHTML=f.length?f.map(x=>{
    const n=x.fotos.length, e=x.enviadas.length;
    const st=x.status==='ok'?`✅ recebido · protocolo <b>${esc(x.protocolo)}</b>`:
             `⏳ aguardando${n?` (${e}/${n} fotos)`:''}${x.erro?' · último erro: '+esc(x.erro):''}`;
    return `<div class="cp-fila-item"><span>${new Date(x.criado_em).toLocaleString('pt-BR')} · ${esc(x.resumo||'')}</span><span>${st}</span></div>`;
  }).join(''):'<div class="cp-mut">Nada na fila.</div>';
  contar();
}
function montarCorpo(){
  const pessoas=[], vinculos=[], fichas=[];
  const ids=new Set();
  EST.fichas.forEach(f=>{
    f.pessoas.forEach(p=>{ pessoas.push(Object.assign({},p)); ids.add(p._id);
      if(f.lote||f.papel||f.pino) vinculos.push({pessoa:p._id, lote:f.lote||'', lote_rotulo:rotuloLote(f.lote), pino:f.pino||'', pino_rotulo:rotuloPino(f.pino), papel:f.papel||'', lado:f.lado||''}); });
    fichas.push({id:f.id, pessoas:f.pessoas.map(p=>p._id), lote:f.lote||'', pino:f.pino||'', papel:f.papel||'', lado:f.lado||'', local:f.local||null, autorizou:!!f.autorizou, criado_em:f.criado_em, alterado_em:f.alterado_em});
  });
  const fotos=EST.fotos.map(f=>Object.assign({},f,{pessoa:ids.has(f.pessoa)?f.pessoa:'', lote_rotulo:rotuloLote(f.lote), pino_rotulo:rotuloPino(f.pino)}));
  const geometrias={type:'FeatureCollection',features:Object.values(EST.geoms)};
  return {formato:'PTP_CAMPO', versao:1, token:TOKEN, site:'', trabalho:CODIGO, trabalho_nome:TRAB.nome||'', envio:EST.envio,
    criado_em:EST.criado_em, coletor:{nome:$('col-nome').value.trim(), tel:$('col-tel').value.trim()},
    pessoas, fichas, vinculos, fotos, geometrias,
    consentimento:{aceito:true, texto:$('col-consent').parentElement.innerText.replace(/\*$/,'').trim(), em:agoraISO()},
    navegador:navigator.userAgent.slice(0,160)};
}
async function enfileirar(){
  if(!$('col-nome').value.trim()){ toast('Informe o seu nome (quem coletou).','err'); $('col-nome').focus(); return; }
  if(!$('col-consent').checked){ toast('Marque a declaração de uso dos dados.','err'); return; }
  CFG.coletor={nome:$('col-nome').value.trim(),tel:$('col-tel').value.trim()}; await kvPut('cfg',CFG);
  const corpo=montarCorpo();
  const np=corpo.pessoas.length, nf=corpo.fotos.length, npt=corpo.geometrias.features.filter(g=>g.properties.origem==='pino').length, ng=corpo.geometrias.features.length-npt;
  await filaPut({envio:EST.envio, codigo:CODIGO, corpo, fotos:corpo.fotos.map(f=>f.id), enviadas:[], status:'pendente', tentativas:0, erro:'',
    criado_em:agoraISO(), resumo:`${np} pessoa(s), ${nf} foto(s), ${npt} ponto(s), ${ng} desenho(s)`});
  /* rascunho novo (as fotos continuam no celular até a fila sair) */
  EST=rascunhoNovo(); await salvarJa();
  $('col-consent').checked=false;
  desenharLotes(); renderEnviar();
  toast(navigator.onLine?'Enviando…':'Sem internet: guardado na fila. Sai sozinho quando o sinal voltar.','inf');
  sincronizar(true);
}
function blobB64(b){ return new Promise((ok,err)=>{ const r=new FileReader(); r.onload=()=>ok(String(r.result).split(',')[1]); r.onerror=()=>err(r.error); r.readAsDataURL(b); }); }
async function postar(obj,ms=60000){
  const ctrl=new AbortController(); const tm=setTimeout(()=>ctrl.abort(),ms);
  try{
    const r=await fetch(APPS_SCRIPT_URL,{method:'POST',body:JSON.stringify(obj),headers:{'Content-Type':'text/plain;charset=utf-8'},redirect:'follow',signal:ctrl.signal});
    return await r.json();
  }catch(e){ throw new Error(e.name==='AbortError'?'tempo esgotado':'sem conexão'); }
  finally{ clearTimeout(tm); }
}
let _sinc=false;
async function sincronizar(avisar){
  if(_sinc) return;
  if(!navigator.onLine){ if(avisar) toast('Sem internet agora. O envio fica na fila.','inf'); return; }
  _sinc=true;
  let enviados=0, falhas=0;
  try{
    const fila=(await filaTodos()).filter(x=>x.status!=='ok');
    for(const it of fila){
      try{
       for(let tentativa=1;;tentativa++){
        for(const fid of it.fotos){
          if(it.enviadas.includes(fid)) continue;
          const o=await fotoGet(fid);
          if(!o){ it.fotos=it.fotos.filter(x=>x!==fid); it.corpo.fotos=it.corpo.fotos.filter(x=>x.id!==fid); await filaPut(it); continue; }
          const r=await postar({acao:'foto', token:TOKEN, trabalho:it.codigo, envio:it.envio, foto:{id:fid, nome:fid+'.jpg', mime:'image/jpeg', dados:await blobB64(o.blob)}},90000);
          if(!r||!r.ok) throw new Error((r&&r.erro)||'foto recusada');
          it.enviadas.push(fid); await filaPut(it); renderFila();
        }
        const r=await postar(Object.assign({acao:'campo'},it.corpo,{enviado_em:agoraISO()}));
        if(!r||!r.ok){
          /* o servidor não achou alguma foto: manda de novo as que faltam e tenta mais uma vez */
          if(r&&Array.isArray(r.faltam)&&tentativa<3){ it.enviadas=it.enviadas.filter(x=>!r.faltam.includes(x)); await filaPut(it); continue; }
          throw new Error((r&&r.erro)||'envio recusado');
        }
        it.status='ok'; it.protocolo=r.protocolo||''; it.ok_em=agoraISO(); it.erro='';
        const fotos=it.fotos; delete it.corpo; it.fotos=[]; it.enviadas=[];
        await filaPut(it);
        for(const fid of fotos){ await fotoDel(fid); const u=_urls.get(fid); if(u){ URL.revokeObjectURL(u); _urls.delete(fid); } }
        enviados++;
        break;
       }
      }catch(e){ it.tentativas=(it.tentativas||0)+1; it.erro=e.message; await filaPut(it); falhas++; }
    }
    /* guarda só os 20 últimos recebidos */
    const ok=(await filaTodos()).filter(x=>x.status==='ok').sort((a,b)=>String(b.ok_em).localeCompare(a.ok_em));
    for(const x of ok.slice(20)) await filaDel(x.envio);
  } finally { _sinc=false; }
  if(enviados) toast(enviados+' envio(s) recebido(s) pelo escritório. ✅','ok');
  else if(falhas&&avisar) toast('Não consegui enviar agora. Continua na fila.','err');
  if($('cp-fila')) renderFila();
}

/* exporta para o index.html */
window.Campo={iniciar, salvarFicha, _estado:()=>EST, _sincronizar:sincronizar};
})();
