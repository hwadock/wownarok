// 와우나로크 홈 화면 앱 설치 조건용 서비스 워커 — 아무것도 캐시하지 않는다(fetch 처리기 없음)
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
