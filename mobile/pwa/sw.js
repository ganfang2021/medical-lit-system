/* 医学文献系统 · PWA Service Worker
 *
 * 刻意只缓存「图标 + manifest」这类纯静态资源。
 * Streamlit 的页面、/_stcore/ 接口、WebSocket、检索结果与会话数据一律不缓存、
 * 不拦截：这个应用的检索和摘要都在服务端跑，离线本来就用不了，
 * 缓存动态响应只会把 A 会话的数据串给 B 会话，或让用户看到过期结果。
 *
 * 保留 fetch 监听器是为了满足浏览器「可安装 PWA」的条件。
 */
const CACHE = 'medlit-mobile-v1';
const ASSETS = [
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .catch(() => {})          // 单个图标失败不该让 SW 装不上
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;

  const isAsset = url.pathname === '/manifest.webmanifest' ||
                  url.pathname === '/apple-touch-icon.png' ||
                  url.pathname.startsWith('/icons/');
  if (!isAsset) return;         // 其余请求完全交给浏览器，零介入

  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
      }
      return res;
    }))
  );
});
