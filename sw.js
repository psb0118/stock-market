/* 머니 플레이그라운드 서비스 워커
   - 앱 셸(HTML)은 네트워크 우선 + HTTP 캐시까지 건너뛰어(cache:"no-store") 새 배포가 첫 로드에 바로 보입니다.
   - 오프라인이면 마지막으로 받아 둔 캐시로 대체합니다. */
const CACHE = "mpg-v3";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 문서·서비스워커 스크립트는 "항상 새로" 받아야 하는 앱 셸입니다.
function isAppShell(request, url) {
  if (request.mode === "navigate") return true;
  if (url.pathname.endsWith("/")) return true;
  return url.pathname.endsWith("/index.html") || url.pathname.endsWith("/sw.js");
}

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  // 정적 자산만 캐시합니다. API(특히 Authorization이 붙은 저장/순위) 응답을
  // URL만으로 캐시하면 다른 연결의 데이터가 섞일 수 있어 서비스워커가 건드리지 않습니다.
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/api/")) return;
  // HTML은 브라우저 HTTP 캐시(GitHub Pages는 10분)를 건너뛰고 네트워크에서 새로 받습니다.
  const fresh = isAppShell(event.request, url) ? { cache: "no-store" } : undefined;
  event.respondWith(
    fetch(event.request, fresh)
      .then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(event.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(event.request).then(r => r || caches.match("./index.html")))
  );
});
