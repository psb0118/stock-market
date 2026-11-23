/* 머니 플레이그라운드 서비스 워커: 네트워크 우선, 오프라인 시 캐시로 대체 */
const CACHE = "mpg-v2";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  // 정적 자산만 캐시합니다. API(특히 Authorization이 붙은 저장/순위) 응답을
  // URL만으로 캐시하면 다른 연결의 데이터가 섞일 수 있어 서비스워커가 건드리지 않습니다.
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/api/")) return;
  event.respondWith(
    fetch(event.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(event.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(event.request).then(r => r || caches.match("./index.html")))
  );
});
