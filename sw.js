/* CADPROP — service worker do modo campo (Poligonal · v1 · 14/11/2026)
   Guarda a página, o campo.js e o Leaflet no celular para abrir SEM INTERNET.
   - Arquivos da pasta (index.html com ou sem ?t=, campo.js, Leaflet): tenta a rede primeiro
     (pega a versão nova) e, sem internet, usa a cópia guardada.
   - Mapas de fundo (15/11/2026): cada imagem de satélite/ruas que APARECE NA TELA com internet
     fica guardada (cache MAPAS, no máximo MAX_MAPAS imagens; as mais antigas saem). Sem internet,
     o que já foi visto aparece. Nada é baixado em lote (os termos dos mapas gratuitos não permitem).
   - Google (Apps Script) não passa por aqui: o trabalho e a fila de envio ficam no IndexedDB (campo.js).
   Ao publicar uma versão nova dos arquivos, aumente o número em VERSAO. */
const VERSAO = 'ptp-campo-v2';
const MAPAS = 'ptp-mapas-v1';          // não começa com "ptp-campo-": sobrevive às trocas de VERSAO
const MAX_MAPAS = 3000;
const SERVIDORES_MAPA = ['server.arcgisonline.com', 'tile.openstreetmap.org'];
const ARQUIVOS = [
  './', 'index.html', 'campo.js', 'manifest.webmanifest',
  'lib/leaflet.js', 'lib/leaflet.css',
  'lib/images/layers.png', 'lib/images/layers-2x.png',
  'lib/images/marker-icon.png', 'lib/images/marker-icon-2x.png', 'lib/images/marker-shadow.png',
  'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('ptp-campo-') && k !== VERSAO).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (SERVIDORES_MAPA.includes(url.hostname)) { e.respondWith(imagemMapa(req)); return; }
  if (url.origin !== self.location.origin) return;           // Google, ViaCEP: direto na rede

  // rede primeiro (pega a versão nova da página e do campo.js juntas); sem internet, a cópia guardada
  const pagina = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
  const chave = pagina ? 'index.html' : req;
  e.respondWith(
    fetch(req).then(r => {
      if (r.ok) { const cp = r.clone(); caches.open(VERSAO).then(c => c.put(chave, cp)); }
      return r;
    }).catch(() => caches.match(chave, { ignoreSearch: true }).then(r => r || (pagina ? caches.match('./') : undefined)))
  );
});

/* imagem do mapa: guardada primeiro (rápido e sem internet); senão rede, guardando a resposta.
   Busca em modo CORS para guardar o tamanho real (resposta "opaca" ocupa ~7 MB de cota cada). */
let _novos = 0;
async function imagemMapa(req) {
  const cache = await caches.open(MAPAS);
  const chave = req.url;
  const guardado = await cache.match(chave);
  if (guardado) return guardado;
  try {
    let r;
    try { r = await fetch(chave, { mode: 'cors', credentials: 'omit' }); }
    catch (e) { return await fetch(req); }                        // servidor sem CORS: mostra, não guarda
    if (r.ok) {
      await cache.put(chave, r.clone());
      if (++_novos % 100 === 0) aparar(cache);
    }
    return r;
  } catch (e) {
    return new Response('', { status: 504, statusText: 'sem internet' });
  }
}
async function aparar(cache) {
  try {
    const ks = await cache.keys();                                // ordem de inclusão: as mais antigas primeiro
    for (let i = 0; i < ks.length - MAX_MAPAS; i++) await cache.delete(ks[i]);
  } catch (e) { }
}
