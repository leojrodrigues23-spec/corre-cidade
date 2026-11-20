/* Service worker do PWA "motorista" — escopo /motorista/ (independente do outro perfil).
 * Estratégia:
 *  - navegação: rede primeiro; offline → shell em cache (o app mostra aviso de "sem conexão")
 *  - estáticos versionados (/assets/*, ícones, marca): cache primeiro
 *  - NUNCA armazena respostas de API (Supabase, Google): dados em tempo real não vêm de cache.
 */
const BUILD_ID = '__BUILD_ID__';
const CACHE = 'levaja-motorista-' + BUILD_ID;
// Funciona em qualquer endereço base (domínio próprio ou subpasta do GitHub Pages)
const SHELL = new URL('./', self.registration.scope).pathname;
const ROOT = new URL('../', self.registration.scope).pathname;
const PRECACHE = [SHELL, SHELL + 'manifest.webmanifest', ROOT + 'icons/motorista/icon-192.png', ROOT + 'icons/motorista/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).catch(() => undefined));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('levaja-motorista-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // APIs externas: sempre rede
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(SHELL, copy));
          return res;
        })
        .catch(() => caches.match(SHELL)),
    );
    return;
  }
  if (url.pathname.startsWith(ROOT + 'assets/') || url.pathname.startsWith(ROOT + 'icons/') || url.pathname.startsWith(ROOT + 'brand/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.includes(SHELL));
      return open ? open.focus() : self.clients.openWindow(SHELL);
    }),
  );
});
