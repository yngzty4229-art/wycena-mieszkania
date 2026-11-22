/* Wycena z aktów – praca bez sieci: najpierw sieć (zawsze świeże dane), a gdy jej nie ma – ostatnia zapisana kopia. */
"use strict";
const POWLOKA = "wza-powloka-1";
const DANE = "wza-dane";
const PLIKI = [
  "./", "index.html", "wycena.js", "manifest.webmanifest", "ikony/ikona.svg", "ikony/ikona-192.png",
  "czcionki/spectral-latin-600-normal.woff2", "czcionki/spectral-latin-ext-600-normal.woff2",
  "czcionki/public-sans-latin-wght-normal.woff2", "czcionki/public-sans-latin-ext-wght-normal.woff2",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(POWLOKA).then((c) => c.addAll(PLIKI)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((klucze) => Promise.all(klucze.filter((k) => k !== POWLOKA && k !== DANE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // wyszukiwarki adresów i inne serwisy idą prosto do sieci
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  const dane = url.pathname.includes("/dane/");
  e.respondWith(siecNajpierw(e.request, dane ? DANE : POWLOKA, dane ? url.origin + url.pathname : null));
});

async function siecNajpierw(zadanie, nazwa, kluczBezWersji) {
  const pamiec = await caches.open(nazwa);
  const klucz = kluczBezWersji || zadanie;
  try {
    const odp = await fetch(zadanie);
    if (odp.ok) pamiec.put(klucz, odp.clone());
    return odp;
  } catch (blad) {
    const kopia = await pamiec.match(klucz, { ignoreSearch: true });
    if (kopia) return kopia;
    if (zadanie.mode === "navigate") {
      const strona = await pamiec.match("index.html");
      if (strona) return strona;
    }
    throw blad;
  }
}
