/* 머니 플레이그라운드 서비스 워커
   - 앱 셸(HTML)은 네트워크 우선 + HTTP 캐시까지 건너뛰어(cache:"no-store") 새 배포가 첫 로드에 바로 보입니다.
   - 오프라인이면 마지막으로 받아 둔 캐시로 대체합니다. */
const CACHE = "mpg-v4";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg"];

// 설치 시점에 이미 활동 중인 서비스워커가 있으면 "업데이트"입니다.
let isUpdate = false;

self.addEventListener("install", event => {
  isUpdate = !!(self.registration.active || self.registration.waiting);
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
      // 첫 설치에서만 바로 제어를 가져옵니다. 업데이트 때는 열린 탭의 저장을 깨뜨리지 않도록
      // 제어를 빼앗지 않고(controllerchange 강제 새로고침 방지) 알림만 보냅니다.
      .then(() => (isUpdate ? null : self.clients.claim()))
      // 업데이트라면 열린 탭에 "새 버전 준비됨"을 알립니다.
      // 강제로 새로고침하지 않고, 페이지가 저장을 마친 뒤 안전한 시점에 직접 갱신합니다.
      // (백그라운드 탭·주문 입력 중인 탭은 다음 포커스 때 갱신됩니다.)
      .then(() => isUpdate ? self.clients.matchAll({ type: "window" }) : [])
      .then(clients => Promise.all(clients.map(c => {
        try { c.postMessage({ type: "MPG_SW_UPDATE", version: CACHE }); } catch (e) {}
        return null;
      })))
  );
});

// 문서·서비스워커 스크립트는 "항상 새로" 받아야 하는 앱 셸입니다.
function isAppShell(request, url) {
  if (request.mode === "navigate") return true;
  if (url.pathname.endsWith("/")) return true;
  return url.pathname.endsWith("/index.html") || url.pathname.endsWith("/sw.js");
}

// 푸시 서버가 생기면 이 경로로 앱 밖 알림을 받습니다. 지금은 앱이 열려 있을 때
// 페이지에서 showNotification으로 보내는 알림과 같은 모양을 사용합니다.
self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (e) { payload = { body: event.data ? event.data.text() : "" }; }
  const title = payload.title || "머니 플레이그라운드";
  event.waitUntil(self.registration.showNotification(title, {
    body: payload.body || "새 소식이 있습니다.",
    icon: payload.icon || "icon.svg",
    badge: payload.badge || "icon.svg",
    tag: payload.tag || "mpg-push",
    data: { url: (payload.data && payload.data.url) || "./" }
  }));
});

// 알림을 누르면 열려 있는 탭을 찾아 포커스하고, 없으면 새 창을 엽니다.
self.addEventListener("notificationclick", event => {
  const raw = (event.notification && event.notification.data && event.notification.data.url) || "./";
  const scope = new URL(self.registration.scope);
  const target = new URL(raw, scope).href;
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (!client.url) continue;
        const here = new URL(client.url);
        if (here.origin !== scope.origin) continue;
        if (client.focus) client.focus();
        // 이미 앱 안이면 포커스만 합니다. 다른 화면이면 알림이 가리키는 주소로 이동합니다.
        const inApp = here.pathname.startsWith(scope.pathname);
        if (client.navigate && !inApp) client.navigate(target).catch(() => {});
        return;
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : null;
    })
  );
});

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

