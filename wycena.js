/* Wycena z aktów – silnik wyceny (ta sama metoda co agent 8 "poland-apartment-valuation", wycena.py).
 *
 * Dane: kafelki 10 x 10 km z aktami sprzedaży mieszkań (Rejestr Cen Nieruchomości, GUGiK), układ PUWG 1992.
 * Metoda: akty z okolicy (1 km -> 2,5 km -> 6 km), ostatnie 24 miesiące, ceny przeliczone na dziś trendem
 * kwartalnym (maks. ±15%), wagi podobieństwa (odległość, metraż, izby, piętro, świeżość), mediana ważona.
 * Działa w przeglądarce i w Node (testy zgodności z Pythonem).
 */
(function (global) {
  "use strict";

  const KAFEL_M = 10000;
  const PROMIENIE = [1000, 2500, 6000];
  const MIESIECY = 24;
  const MIN_PODOBNYCH = 30;
  const MIN_W_KWARTALE = 15;
  const GRANICE_KOREKTY = [0.85, 1.15];
  const POLOWA_ZYCIA_MIES = 18;
  const ODLEGLOSC_POLOWY_M = 500;
  const GRANICE_M2 = [1500, 80000];

  // ------------------------------------------------------------ pomocnicze

  function mediana(v) {
    const s = v.slice().sort((a, b) => a - b);
    const n = s.length;
    if (!n) return null;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }

  function kwartal(mies) { // "2026-08" -> "2026-Q3"
    return mies.slice(0, 4) + "-Q" + (Math.floor((parseInt(mies.slice(5, 7), 10) - 1) / 3) + 1);
  }

  function iso(d) {
    const p = (x) => String(x).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function kwantylWazony(pary, q) {
    const s = pary.filter((p) => p[1] > 0).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (!s.length) return null;
    const razem = s.reduce((a, p) => a + p[1], 0);
    const poz = [];
    let nar = 0;
    for (const [, w] of s) { poz.push((nar + w / 2) / razem); nar += w; }
    if (q <= poz[0]) return s[0][0];
    if (q >= poz[poz.length - 1]) return s[s.length - 1][0];
    for (let i = 1; i < s.length; i++) {
      if (q <= poz[i]) {
        const p0 = poz[i - 1], p1 = poz[i];
        return s[i - 1][0] + (s[i][0] - s[i - 1][0]) * (q - p0) / (p1 - p0);
      }
    }
    return s[s.length - 1][0];
  }

  function miesiaceMiedzy(mies, dzis) {
    return (dzis.getFullYear() - parseInt(mies.slice(0, 4), 10)) * 12 + (dzis.getMonth() + 1) - parseInt(mies.slice(5, 7), 10);
  }

  const MIESIACE = ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień",
                    "październik", "listopad", "grudzień"];
  const MIESIACE_DOP = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia", "września",
                        "października", "listopada", "grudnia"];

  /** "2026-07" -> "lipiec 2026" (albo "lipca 2026" w dopełniaczu). */
  function miesiacSlownie(mies, dopelniacz) {
    if (!mies) return "";
    const i = parseInt(mies.slice(5, 7), 10) - 1;
    return (dopelniacz ? MIESIACE_DOP : MIESIACE)[i] + " " + mies.slice(0, 4);
  }

  /** "2026-01" -> "ze stycznia 2026", "2026-07" -> "z lipca 2026". */
  function zMiesiaca(mies) {
    const i = parseInt(mies.slice(5, 7), 10) - 1;
    return (i === 0 || i === 8 ? "ze " : "z ") + miesiacSlownie(mies, true);
  }

  // ------------------------------------------------------------ dane

  function kafleWPromieniu(n, e, r) {
    const wynik = [];
    for (let kn = Math.floor((n - r) / KAFEL_M); kn <= Math.floor((n + r) / KAFEL_M); kn++)
      for (let ke = Math.floor((e - r) / KAFEL_M); ke <= Math.floor((e + r) / KAFEL_M); ke++)
        wynik.push(kn + "_" + ke);
    return wynik;
  }

  /** Kafelek JSON -> lista aktów (współrzędne bezwzględne, data jako "RRRR-MM-DD"). */
  function rozpakujKafel(nazwa, dane) {
    const [kn, ke] = nazwa.split("_").map(Number);
    const ulice = dane.s || [];
    return (dane.r || []).map((w) => {
      const d = String(w[2]);
      const data = d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8);
      const pow = w[4] / 10;
      return {
        n: kn * KAFEL_M + w[0], e: ke * KAFEL_M + w[1], data, mies: data.slice(0, 7), cena: w[3], pow,
        m2: Math.round((w[3] / pow) * 100) / 100, izby: w[5] || null,
        pietro: w[6] === -99 ? null : Math.max(0, w[6] - 1), // rejestr: kondygnacja 1 = parter; tu: piętro 0 = parter
        rynek: w[7] ? "primary" : "secondary", ulica: ulice[w[8]] || "", nr: w[9] || "",
      };
    });
  }

  /** Akty z okręgu i okresu; ceny odstające (poniżej 35% / powyżej 300% mediany okolicy) poza statystyką. */
  function aktyWOkregu(akty, n, e, r, od, doDaty) {
    const wynik = [];
    for (const a of akty) {
      if (a.data < od || a.data > doDaty) continue;
      const d = Math.hypot(a.n - n, a.e - e);
      if (d > r) continue;
      const ok = a.m2 >= GRANICE_M2[0] && a.m2 <= GRANICE_M2[1];
      wynik.push(Object.assign({}, a, { odl: Math.round(d), wStat: ok }));
    }
    const ceny = wynik.filter((a) => a.wStat).map((a) => a.m2).sort((x, y) => x - y);
    if (ceny.length >= 20) {
      const med = ceny[Math.floor(ceny.length / 2)];
      for (const a of wynik) if (a.wStat && (a.m2 < 0.35 * med || a.m2 > 3 * med)) a.wStat = false;
    }
    return wynik;
  }

  // ------------------------------------------------------------ metoda (jak wycena.py)

  function indeksCzasu(akty) {
    const poKw = {};
    for (const a of akty) (poKw[kwartal(a.mies)] = poKw[kwartal(a.mies)] || []).push(a.m2);
    const med = {};
    for (const [q, v] of Object.entries(poKw)) if (v.length >= MIN_W_KWARTALE) med[q] = mediana(v);
    const kw = Object.keys(med).sort();
    if (kw.length < 3) return {};
    const gladkie = {};
    kw.forEach((q, i) => {
      const okno = kw.slice(Math.max(0, i - 1), Math.min(kw.length, i + 2)).map((k) => med[k]);
      gladkie[q] = okno.reduce((x, y) => x + y, 0) / okno.length;
    });
    const koniec = gladkie[kw[kw.length - 1]];
    const wynik = {};
    for (const q of kw) wynik[q] = Math.min(GRANICE_KOREKTY[1], Math.max(GRANICE_KOREKTY[0], koniec / gladkie[q]));
    return wynik;
  }

  function grupaPietra(p) {
    if (p === null || p === undefined) return null;
    return p <= 0 ? 0 : p <= 3 ? 1 : p <= 9 ? 2 : 3;
  }

  function waga(a, m, dzis) {
    if (!a.pow || !m.pow) return 0;
    const st = a.pow / m.pow;
    if (st < 0.5 || st > 2) return 0;
    let w = Math.exp(-(Math.log(st) ** 2) / (2 * 0.3 ** 2));
    w *= 1 / (1 + (a.odl / ODLEGLOSC_POLOWY_M) ** 2);
    w *= 0.5 ** (Math.max(0, miesiaceMiedzy(a.mies, dzis)) / POLOWA_ZYCIA_MIES);
    if (m.izby && a.izby) {
      const r = Math.abs(a.izby - m.izby);
      w *= r === 0 ? 1 : r === 1 ? 0.6 : 0.3;
    }
    if (m.pietro !== null && m.pietro !== undefined && a.pietro !== null && a.pietro !== undefined)
      w *= grupaPietra(a.pietro) === grupaPietra(m.pietro) ? 1 : 0.8;
    return w;
  }

  function pasujace(akty, m) {
    let w = akty.filter((a) => a.wStat && a.m2 && a.pow && a.pow / m.pow >= 0.5 && a.pow / m.pow <= 2);
    if (m.rynek === "primary" || m.rynek === "secondary") w = w.filter((a) => a.rynek === m.rynek);
    return w;
  }

  function pewnosc(nEf, rozrzut) {
    if (nEf >= 25 && rozrzut !== null && rozrzut <= 0.3) return "high";
    if (nEf >= 10 && (rozrzut === null || rozrzut <= 0.45)) return "medium";
    return "low";
  }

  function zaokr(v, d) { return v === null ? null : Math.round(v / (d || 1000)) * (d || 1000); }

  function wycen(m, akty, dzis, ilePorownan) {
    const trend = indeksCzasu(akty.filter((a) => a.wStat));
    const pary = [], szcz = [];
    for (const a of pasujace(akty, m)) {
      const w = waga(a, m, dzis);
      if (w <= 0) continue;
      const mn = Object.keys(trend).length ? (trend[kwartal(a.mies)] || 1) : 1;
      const cena = a.m2 * mn;
      pary.push([cena, w]);
      szcz.push([w, cena, mn, a]);
    }
    if (!pary.length) return null;
    const m2 = kwantylWazony(pary, 0.5), p25 = kwantylWazony(pary, 0.25), p75 = kwantylWazony(pary, 0.75);
    const p10 = kwantylWazony(pary, 0.1), p90 = kwantylWazony(pary, 0.9);
    const suma = pary.reduce((x, p) => x + p[1], 0), sumaKw = pary.reduce((x, p) => x + p[1] * p[1], 0);
    const nEf = sumaKw ? (suma * suma) / sumaKw : 0;
    const rozrzut = m2 ? (p75 - p25) / m2 : null;
    const maksW = Math.max(...szcz.map((s) => s[0]));
    const najlepsze = szcz.slice().sort((x, y) => y[0] - x[0]).slice(0, ilePorownan === undefined ? 10 : ilePorownan);
    return {
      wartosc: zaokr(m2 * m.pow), cenaM2: Math.round(m2),
      przedzial: [zaokr(p25 * m.pow), zaokr(p75 * m.pow)],
      cenyM2: { p10: Math.round(p10), p25: Math.round(p25), p75: Math.round(p75), p90: Math.round(p90) },
      pewnosc: pewnosc(nEf, rozrzut), porownan: pary.length, porownanEf: Math.round(nEf * 10) / 10,
      rozrzut: rozrzut === null ? null : Math.round(rozrzut * 1000) / 1000,
      trend,
      porownania: najlepsze.map(([w, cena, mn, a]) => ({
        data: a.data, rynek: a.rynek, cena: a.cena, pow: a.pow, m2: a.m2, m2Dzis: Math.round(cena),
        izby: a.izby, pietro: a.pietro, ulica: a.ulica, nr: a.nr, odl: a.odl, dn: a.n, de: a.e,
        podobienstwo: Math.round((w / maksW) * 1000) / 1000,
      })),
    };
  }

  function rynekLokalny(akty, ileKwartalow) {
    const uzyte = akty.filter((a) => a.wStat);
    const poKw = {};
    for (const a of uzyte) (poKw[kwartal(a.mies)] = poKw[kwartal(a.mies)] || []).push(a.m2);
    const kwartaly = Object.keys(poKw).sort().map((q) => ({ kwartal: q, mediana: Math.round(mediana(poKw[q])), aktow: poKw[q].length }));
    const ostatni = uzyte.reduce((x, a) => (a.mies > x ? a.mies : x), "");
    return { aktow: uzyte.length, medianaM2: uzyte.length ? Math.round(mediana(uzyte.map((a) => a.m2))) : null,
             kwartaly: kwartaly.slice(-(ileKwartalow || 8)), ostatniMiesiac: ostatni || null };
  }

  /**
   * Pełna wycena jak agent 8.
   * miejsce: {n, e, typ: "address"|"street"|"city"}; mieszkanie: {pow, pokoje, pietro, rynek}
   * pobierzKafel(nazwa) -> Promise<lista aktów> (już rozpakowana, [] gdy kafelka nie ma)
   */
  async function wycenaPelna(miejsce, mieszkanie, pobierzKafel, dzis) {
    dzis = dzis || new Date();
    const doDaty = iso(dzis);
    const odDaty = iso(new Date(dzis.getTime() - Math.round(MIESIECY * 30.44) * 86400000));
    const izby = mieszkanie.pokoje ? Number(mieszkanie.pokoje) + 1 : null;
    let rynek = ["primary", "secondary", "any"].includes(mieszkanie.rynek) ? mieszkanie.rynek : "secondary";
    let m = { pow: Number(mieszkanie.pow), izby, pietro: mieszkanie.pietro === "" || mieszkanie.pietro === null || mieszkanie.pietro === undefined ? null : Number(mieszkanie.pietro), rynek };
    const dowolny = Object.assign({}, m, { rynek: "any" });
    const pamiec = {};
    let akty = [], promien = PROMIENIE[0];
    for (promien of PROMIENIE) {
      const wszystkie = [];
      for (const k of kafleWPromieniu(miejsce.n, miejsce.e, promien)) {
        if (!(k in pamiec)) pamiec[k] = await pobierzKafel(k);
        for (const a of pamiec[k]) wszystkie.push(a);
      }
      akty = aktyWOkregu(wszystkie, miejsce.n, miejsce.e, promien, odDaty, doDaty);
      const nRynek = pasujace(akty, m).length;
      if (nRynek >= MIN_PODOBNYCH) break;
      if (promien >= PROMIENIE[1] && nRynek < 10 && pasujace(akty, dowolny).length >= MIN_PODOBNYCH) break;
    }
    const uwagi = [];
    if (m.rynek !== "any" && pasujace(akty, m).length < 10) {
      uwagi.push(m.rynek === "primary" ? "W okolicy jest za mało sprzedaży nowych mieszkań, więc wycena uwzględnia też używane."
                                         : "W okolicy jest za mało sprzedaży używanych mieszkań, więc wycena uwzględnia też nowe, od deweloperów.");
      m = dowolny;
    }
    const wynik = wycen(m, akty, dzis, 10);
    const rynekOk = rynekLokalny(akty);
    if (!wynik) return { blad: "brak", promien, rynek: rynekOk, okres: [odDaty, doDaty] };
    let pew = wynik.pewnosc;
    const poziom = { low: 0, medium: 1, high: 2 };
    if (miejsce.typ === "city") {
      if (poziom[pew] > 0) pew = "low";
      uwagi.push("Rozpoznaliśmy tylko miejscowość lub dzielnicę, bez ulicy, więc wycena dotyczy jej środka. Podaj ulicę i numer, a będzie dokładniejsza.");
    } else if (miejsce.typ === "street") {
      if (poziom[pew] > 1) pew = "medium";
      uwagi.push("Nie znaleźliśmy numeru budynku, więc liczymy dla ulicy – położenie jest przybliżone.");
    }
    if (promien > PROMIENIE[0]) uwagi.push("W pobliżu było mało podobnych sprzedaży, więc bierzemy pod uwagę promień " + (promien / 1000).toLocaleString("pl-PL") + " km.");
    if (rynekOk.ostatniMiesiac) {
      const granica = new Date(dzis.getFullYear(), dzis.getMonth() - 4, 1);
      if (rynekOk.ostatniMiesiac < iso(granica).slice(0, 7))
        uwagi.push("Najnowszy akt z tej okolicy jest " + zMiesiaca(rynekOk.ostatniMiesiac) + " – starostwa publikują akty z opóźnieniem, więc ostatnich miesięcy jeszcze nie widać.");
    }
    return Object.assign(wynik, { pewnosc: pew, promien, rynekUzyty: m.rynek, uwagi, rynek: rynekOk, okres: [odDaty, doDaty] });
  }

  // ------------------------------------------------------------ układ PUWG 1992 (EPSG:2180) <-> GPS

  const A = 6378137.0, F = 1 / 298.257222101, E2 = 2 * F - F * F, EP2 = E2 / (1 - E2), K0 = 0.9993;
  const LON0 = 19 * Math.PI / 180, FE = 500000.0, FN = -5300000.0;

  function lukPoludnika(phi) {
    const e2 = E2, e4 = E2 * E2, e6 = E2 * E2 * E2;
    return A * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi)
      + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi) - (35 * e6 / 3072) * Math.sin(6 * phi));
  }

  function doPuwg(lat, lon) {
    const phi = lat * Math.PI / 180, lam = lon * Math.PI / 180;
    const s = Math.sin(phi), c = Math.cos(phi), t0 = Math.tan(phi);
    const n = A / Math.sqrt(1 - E2 * s * s), t = t0 * t0, cc = EP2 * c * c, a = (lam - LON0) * c;
    const x = K0 * n * (a + (1 - t + cc) * a ** 3 / 6 + (5 - 18 * t + t * t + 72 * cc - 58 * EP2) * a ** 5 / 120);
    const y = K0 * (lukPoludnika(phi) + n * t0 * (a * a / 2 + (5 - t + 9 * cc + 4 * cc * cc) * a ** 4 / 24
      + (61 - 58 * t + t * t + 600 * cc - 330 * EP2) * a ** 6 / 720));
    return [FN + y, FE + x];
  }

  const api = { KAFEL_M, PROMIENIE, MIESIECY, kafleWPromieniu, rozpakujKafel, aktyWOkregu, indeksCzasu, waga, pasujace,
                kwantylWazony, wycen, wycenaPelna, rynekLokalny, doPuwg, mediana, kwartal, miesiacSlownie, zMiesiaca, iso };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.Wycena = api;
})(typeof window !== "undefined" ? window : globalThis);
