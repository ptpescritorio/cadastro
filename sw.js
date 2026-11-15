/* CADPROP — service worker do modo campo (Poligonal · v1 · 14/11/2026)
   Guarda a página, o campo.js e o Leaflet no celular para abrir SEM INTERNET.
   - Arquivos da pasta (index.html com ou sem ?t=, campo.js, Leaflet): tenta a rede primeiro
     (pega a versão nova) e, sem internet, usa a cópia guardada.
   - Nada do Google (Apps Script) nem dos mapas de fundo passa por aqui: o trabalho e
     a fila de envio ficam no IndexedDB (campo.js).
   Ao publicar uma versão nova dos arquivos, aumente o número em VERSAO. */
const VERSAO = 'ptp-campo-v1';
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
  if (url.origin !== self.location.origin) return;           // Google, ViaCEP, mapas: direto na rede

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
