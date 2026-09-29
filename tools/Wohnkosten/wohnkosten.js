/* =========================================================
   Wohnkosten — Pendel- & Fahrtkostenrechner (Österreich)
   Läuft vollständig clientseitig, kein Backend, keine Telemetrie.
   ========================================================= */
(function () {
  "use strict";

  /* =======================================================
     ANNAHMEN & SÄTZE — alles Anpassbare steht hier oben.
     Bei einer Gesetzesänderung nur diesen Block austauschen.
     ======================================================= */

  /* Pendlerpauschale, Jahresbeträge in Euro.
     Reihenfolge ist relevant: die erste Zeile, in die die einfache
     Wegstrecke fällt (min <= km <= max), gewinnt. Damit landen die
     Grenzwerte (20 / 40 / 60 km) jeweils in der unteren Stufe. */
  var PP_RATES = {
    /* Kleines Pendlerpauschale: öffentliche Verkehrsmittel zumutbar. */
    klein: [
      { min: 20, max: 40, year: 696 },
      { min: 40, max: 60, year: 1356 },
      { min: 60, max: Infinity, year: 2016 }
    ],
    /* Großes Pendlerpauschale: öffentliche Verkehrsmittel unzumutbar
       (keine Verbindung, unzumutbare Fahrzeit, Behinderung). */
    gross: [
      { min: 2, max: 20, year: 372 },
      { min: 20, max: 40, year: 1476 },
      { min: 40, max: 60, year: 2568 },
      { min: 60, max: Infinity, year: 3672 }
    ]
  };

  /* Pendlereuro: Absetzbetrag, 2 € je Kilometer der einfachen
     Wegstrecke und Jahr. Nur bei bestehendem Pauschale-Anspruch. */
  var PENDLEREURO_PER_KM_YEAR = 2;

  /* Aliquotierung nach Fahrten pro Kalendermonat. */
  function ppFactor(daysPerMonth) {
    if (daysPerMonth >= 11) return 1;
    if (daysPerMonth >= 8) return 2 / 3;
    if (daysPerMonth >= 4) return 1 / 3;
    return 0;
  }

  /* Kfz-Versicherung: grobe Marktspanne pro Jahr nach Jahreskilometern.
     Richtwerte für einen Mittelklasse-Pkw (ca. 85 bis 110 kW),
     Haftpflicht plus Teilkasko, inklusive motorbezogener
     Versicherungssteuer. Keine Fahrzeug- oder Bonus-Malus-Daten. */
  var INSURANCE_TIERS = [
    { max: 10000, label: "bis 10.000 km", low: 900, high: 1300 },
    { max: 15000, label: "10.001 bis 15.000 km", low: 1000, high: 1450 },
    { max: 20000, label: "15.001 bis 20.000 km", low: 1100, high: 1600 },
    { max: 30000, label: "20.001 bis 30.000 km", low: 1250, high: 1800 },
    { max: Infinity, label: "über 30.000 km", low: 1400, high: 2100 }
  ];

  /* Feste Annahmen. Beide waren früher Eingabefelder und sind jetzt
     hier hinterlegt, damit die Seite mit weniger Feldern auskommt.

     ppMode "gross": der Rechner unterstellt durchgehend die Fahrt mit
     dem eigenen Auto, also unzumutbare öffentliche Verkehrsmittel.
     Das große Pendlerpauschale gilt bereits ab 2 km.

     taxRate: die Pauschale ist ein Werbungskostenabzug und wirkt nur
     in Höhe des Grenzsteuersatzes. 40 % entspricht der Tarifstufe von
     rund 36.000 bis 69.000 € Jahreseinkommen. */
  var ASSUMPTIONS = {
    ppMode: "gross",
    taxRate: 0.4
  };

  var DEFAULTS = {
    price: 1.65,
    days: 20,
    vb: { km: 34, cons: 7.0, priv: 5000 },
    hoe: { km: 18, cons: 6.0, priv: 5000 }
  };

  /* v2: ohne die Felder oeffi und tax. Der neue Schlüssel verhindert,
     dass ein alter Eintrag aus dem Browser eingelesen wird. */
  var STORAGE_KEY = "wk-wohnkosten-v2";

  /* =======================================================
     Formatierung
     ======================================================= */

  /* de-DE, nicht de-AT: Österreich formatiert Tausender mit einem
     schmalen Leerzeichen, die übrige Website und die statische
     Pauschalen-Tabelle verwenden den Punkt. */
  var fmtEur = new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
  var fmtEur2 = new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  var fmtKm = new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
  var fmtLitre = new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1
  });

  function eur(n) {
    if (!isFinite(n)) return "–";
    return fmtEur.format(Math.round(n));
  }
  function eur2(n) {
    if (!isFinite(n)) return "–";
    return fmtEur2.format(n);
  }
  function km(n) {
    if (!isFinite(n)) return "–";
    return fmtKm.format(Math.round(n));
  }
  function litre(n) {
    if (!isFinite(n)) return "–";
    return fmtLitre.format(n);
  }
  /* Entlastungsbeträge werden als Abzug dargestellt. Ohne Anspruch
     soll dort "0" stehen und nicht "−0". */
  function credit(n) {
    if (!isFinite(n)) return "–";
    if (Math.round(n) === 0) return "0";
    return "−" + eur(n);
  }

  /* =======================================================
     Rechenkern — eine Person, ein Arbeitsweg
     ======================================================= */

  function ppRow(distance, mode) {
    var table = PP_RATES[mode] || PP_RATES.klein;
    for (var i = 0; i < table.length; i++) {
      if (distance >= table[i].min && distance <= table[i].max) return table[i];
    }
    return null;
  }

  function calcRoute(route, price, daysPerMonth) {
    var d = route.km;
    var factor = ppFactor(daysPerMonth);

    /* Sprit */
    var kmPerMonth = d * 2 * daysPerMonth;
    var litresPerMonth = (kmPerMonth * route.cons) / 100;
    var fuelPerMonth = litresPerMonth * price;

    /* Pendlerpauschale (Werbungskosten → wirkt mit dem Grenzsteuersatz) */
    var row = ppRow(d, ASSUMPTIONS.ppMode);
    var ppYear = row ? row.year * factor : 0;
    var ppReliefMonth = (ppYear / 12) * ASSUMPTIONS.taxRate;

    /* Pendlereuro (Absetzbetrag → wirkt in voller Höhe), nur mit Anspruch */
    var peYear = row ? PENDLEREURO_PER_KM_YEAR * d * factor : 0;
    var peReliefMonth = peYear / 12;

    var reliefMonth = ppReliefMonth + peReliefMonth;
    var netPerMonth = fuelPerMonth - reliefMonth;

    /* Jahreskilometer */
    var commuteKmPerYear = kmPerMonth * 12;
    var totalKmPerYear = commuteKmPerYear + route.priv;

    /* Versicherung */
    var tier = INSURANCE_TIERS[INSURANCE_TIERS.length - 1];
    for (var i = 0; i < INSURANCE_TIERS.length; i++) {
      if (totalKmPerYear <= INSURANCE_TIERS[i].max) { tier = INSURANCE_TIERS[i]; break; }
    }

    return {
      distance: d,
      factor: factor,
      kmPerMonth: kmPerMonth,
      litresPerMonth: litresPerMonth,
      fuelPerMonth: fuelPerMonth,
      ppBand: row,
      ppYear: ppYear,
      ppReliefMonth: ppReliefMonth,
      peYear: peYear,
      peReliefMonth: peReliefMonth,
      reliefMonth: reliefMonth,
      netPerMonth: netPerMonth,
      commuteKmPerYear: commuteKmPerYear,
      totalKmPerYear: totalKmPerYear,
      tier: tier
    };
  }

  /* =======================================================
     DOM
     ======================================================= */

  var $ = function (id) { return document.getElementById(id); };

  var els = {
    price: $("in-price"),
    days: $("in-days"),
    reset: $("wk-reset")
  };

  var ROUTES = ["vb", "hoe"];

  ROUTES.forEach(function (key) {
    els[key] = {
      km: $("in-" + key + "-km"),
      cons: $("in-" + key + "-cons"),
      priv: $("in-" + key + "-priv")
    };
  });

  function num(el, fallback) {
    var v = parseFloat(String(el.value).replace(",", "."));
    if (!isFinite(v) || v < 0) {
      el.classList.add("is-invalid");
      return fallback;
    }
    el.classList.remove("is-invalid");
    return v;
  }

  function readState() {
    var price = num(els.price, DEFAULTS.price);
    var days = Math.round(num(els.days, DEFAULTS.days));
    var state = { price: price, days: days };
    ROUTES.forEach(function (key) {
      state[key] = {
        km: num(els[key].km, DEFAULTS[key].km),
        cons: num(els[key].cons, DEFAULTS[key].cons),
        priv: num(els[key].priv, DEFAULTS[key].priv)
      };
    });
    return state;
  }

  function writeState(state) {
    els.price.value = String(state.price).replace(".", ",");
    els.days.value = state.days;
    ROUTES.forEach(function (key) {
      var r = state[key];
      els[key].km.value = String(r.km).replace(".", ",");
      els[key].cons.value = String(r.cons).replace(".", ",");
      els[key].priv.value = r.priv;
    });
  }

  function setText(id, text) {
    var el = $(id);
    if (el) el.textContent = text;
  }

  /* =======================================================
     Ausgabe
     ======================================================= */

  function render() {
    var state = readState();
    var vb = calcRoute(state.vb, state.price, state.days);
    var hoe = calcRoute(state.hoe, state.price, state.days);

    /* --- 1) Fahrtkosten pro Monat --- */
    var netSum = vb.netPerMonth + hoe.netPerMonth;
    setText("out-net-month", eur(netSum));

    setText("out-vb-fuel", eur(vb.fuelPerMonth));
    setText("out-hoe-fuel", eur(hoe.fuelPerMonth));
    setText("out-sum-fuel", eur(vb.fuelPerMonth + hoe.fuelPerMonth));

    setText("out-vb-relief", credit(vb.reliefMonth));
    setText("out-hoe-relief", credit(hoe.reliefMonth));
    setText("out-sum-relief", credit(vb.reliefMonth + hoe.reliefMonth));

    setText("out-vb-net", eur(vb.netPerMonth));
    setText("out-hoe-net", eur(hoe.netPerMonth));
    setText("out-sum-net", eur(netSum));

    setText("out-fuel-note",
      state.days + " Arbeitstage · " + eur2(state.price) + " €/l");

    /* --- 2) Jahreskilometer --- */
    var kmSum = vb.totalKmPerYear + hoe.totalKmPerYear;
    setText("out-km-year", km(kmSum));

    setText("out-vb-kmcommute", km(vb.commuteKmPerYear));
    setText("out-hoe-kmcommute", km(hoe.commuteKmPerYear));
    setText("out-sum-kmcommute", km(vb.commuteKmPerYear + hoe.commuteKmPerYear));

    setText("out-vb-kmpriv", km(state.vb.priv));
    setText("out-hoe-kmpriv", km(state.hoe.priv));
    setText("out-sum-kmpriv", km(state.vb.priv + state.hoe.priv));

    setText("out-vb-kmtotal", km(vb.totalKmPerYear));
    setText("out-hoe-kmtotal", km(hoe.totalKmPerYear));
    setText("out-sum-kmtotal", km(kmSum));

    /* --- 3) Kfz-Versicherung --- */
    var insLow = vb.tier.low + hoe.tier.low;
    var insHigh = vb.tier.high + hoe.tier.high;
    setText("out-ins-range", eur(insLow) + " - " + eur(insHigh));

    setText("out-vb-ins", eur(vb.tier.low) + "–" + eur(vb.tier.high));
    setText("out-hoe-ins", eur(hoe.tier.low) + "–" + eur(hoe.tier.high));
    setText("out-sum-ins", eur(insLow) + "–" + eur(insHigh));

    setText("out-vb-insmonth", eur(vb.tier.low / 12) + "–" + eur(vb.tier.high / 12));
    setText("out-hoe-insmonth", eur(hoe.tier.low / 12) + "–" + eur(hoe.tier.high / 12));
    setText("out-sum-insmonth", eur(insLow / 12) + "–" + eur(insHigh / 12));

    /* --- Gesamtbild Mobilität --- */
    var mobLow = netSum + insLow / 12;
    var mobHigh = netSum + insHigh / 12;
    setText("out-mobility", eur(mobLow) + " bis " + eur(mobHigh));

    /* --- Pendlerpauschale-Detail --- */
    renderPpDetail("vb", state.vb, vb);
    renderPpDetail("hoe", state.hoe, hoe);
    highlightPpTable(state, vb, hoe);

    persist(state);
  }

  function renderPpDetail(key, input, res) {
    var kind = ASSUMPTIONS.ppMode === "klein" ? "Kleines" : "Großes";
    if (!res.ppBand) {
      setText("out-" + key + "-ppband",
        kind + " Pendlerpauschale: kein Anspruch bei " +
        litre(input.km) + " km");
      setText("out-" + key + "-ppyear", "0 € pro Jahr");
      setText("out-" + key + "-peyear", "0 € pro Jahr");
      return;
    }
    var band = res.ppBand.max === Infinity
      ? "über " + res.ppBand.min + " km"
      : res.ppBand.min + " bis " + res.ppBand.max + " km";
    setText("out-" + key + "-ppband",
      kind + " Pendlerpauschale, Stufe " + band);
    setText("out-" + key + "-ppyear", eur(res.ppYear) + " € pro Jahr");
    setText("out-" + key + "-peyear", eur(res.peYear) + " € pro Jahr");
  }

  /* Hebt in der Übersichtstabelle die tatsächlich angewandte Stufe hervor. */
  function highlightPpTable(state, vb, hoe) {
    var rows = document.querySelectorAll(".wk-pp-table tbody tr");
    Array.prototype.forEach.call(rows, function (tr) {
      tr.classList.remove("is-active", "is-active-hoe");
      if (tr.getAttribute("data-mode") !== ASSUMPTIONS.ppMode) return;
      var min = parseFloat(tr.getAttribute("data-min"));
      if (vb.ppBand && vb.ppBand.min === min) {
        tr.classList.add("is-active");
      }
      if (hoe.ppBand && hoe.ppBand.min === min) {
        tr.classList.add("is-active", "is-active-hoe");
      }
    });
  }

  /* =======================================================
     Persistenz — nur eine Bequemlichkeit, darf fehlschlagen
     ======================================================= */

  function persist(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* privates Fenster, blockierte Site-Daten: egal */ }
  }

  function restore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || !s.vb || !s.hoe) return null;
      return s;
    } catch (e) {
      return null;
    }
  }

  /* =======================================================
     Start
     ======================================================= */

  function init() {
    if (!els.price) return;

    var saved = restore();
    writeState(saved || DEFAULTS);

    var inputs = document.querySelectorAll(".wk-input");
    Array.prototype.forEach.call(inputs, function (el) {
      el.addEventListener("input", render);
      el.addEventListener("change", render);
    });

    if (els.reset) {
      els.reset.addEventListener("click", function () {
        writeState(DEFAULTS);
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* egal */ }
        render();
      });
    }

    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
