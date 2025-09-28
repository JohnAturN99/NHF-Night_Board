const CACHE = "nightboard-v1";
const ASSETS = [ "./", "./index.html" ];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
});
self.addEventListener("fetch", (e) => {
  e.respondWith(
    caches.match(e.request).then((res) =>
      res ||
      fetch(e.request).then((net) => {
        const clone = net.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone));
        return net;
      }).catch(() => caches.match("./index.html"))
    )
  );
});
