// Seite "Hinzufügen": Passwort, Suche im Katalog, Eingabe von Hand, Hinweis auf Doppelte.
// Alle Daten gehen an die Web-App im Apps Script (config.js → erfassenUrl).
(function () {
  const SPEICHER = "tonie-zugang";
  const cfg = window.TONIE_CONFIG || {};
  const $ = (id) => document.getElementById(id);

  const zustand = {
    zugang: null,      // { schluessel, bis }
    liste: [],         // deine Tonies aus dem Sheet
    modus: "neu",      // "neu" oder "ergaenzen"
    ziel: null,        // vorhandener Eintrag beim Ergänzen
  };

  const BEREICHE = ["bereich-sperre", "bereich-start", "bereich-formular", "bereich-ergebnis", "bereich-weiter", "bereich-pruefen", "bereich-wert"];
  const VERWALTEN_ID = new URLSearchParams(location.search).get("id");
  // Ein Bereich "Tonie-Check": Foto, Name oder von Hand; danach prüfen oder hinzufügen.
  // Alte Adressen mit ?erkennen öffnen ihn mit dem Reiter Foto.
  const ERKENNEN = new URLSearchParams(location.search).has("erkennen");
  const PRUEFEN = new URLSearchParams(location.search).has("pruefen");
  const CHECK = "Tonie-Check";
  const REITER_SPEICHER = "tonie-check-reiter";
  function gemerkterReiter() {
    if (ERKENNEN) return "foto";
    try { const r = localStorage.getItem(REITER_SPEICHER); return r === "suchen" ? "suchen" : "foto"; } catch (x) { return "foto"; }
  }
  const TESTMODUS = /testmodus/.test(location.search) ? "?testmodus" : "";

  // Titel sofort richtig, damit nicht kurz "Tonie hinzufügen" aufblitzt
  function titelSetzen(text) { document.title = $("seitentitel").textContent = text; }
  titelSetzen(VERWALTEN_ID ? "Tonie verwalten" : PRUEFEN ? "Sammlung prüfen" : CHECK);

  // ---------- Zurück zur Sammlung ----------
  // Kam man von der Übersicht, geht es mit history.back() genau dorthin zurück: kein neuer
  // Verlaufseintrag, also keine Schleife mit der Zurück-Taste. Die Übersicht stellt Suche,
  // Filter und Scroll-Position wieder her und zeigt die Meldung (sessionStorage).
  function vonDerSammlung() {
    try {
      const r = new URL(document.referrer);
      return r.origin === location.origin && /\/(index\.html)?$/.test(r.pathname) && history.length > 1;
    } catch (x) { return false; }
  }
  function zurueckZurSammlung(text) {
    try { if (text) sessionStorage.setItem("tonie-meldung", JSON.stringify(text)); } catch (x) {}
    if (vonDerSammlung()) history.back();
    else location.replace("./" + TESTMODUS);
  }
  function zeige(bereich) {
    BEREICHE.forEach((b) => { $(b).hidden = b !== bereich; });
    $("sperren").hidden = bereich === "bereich-sperre";
    window.scrollTo(0, 0);
  }

  function meldung(id, text, art) {
    const el = $(id);
    el.textContent = text || "";
    el.hidden = !text;
    el.dataset.art = art || "fehler";
  }

  // ---------- Verbindung zur Web-App ----------
  // optionen.leise: im Hintergrund, ohne "Einen Moment …"-Hinweis (z. B. Katalog nachladen)
  async function anfrage(aktion, daten, optionen) {
    const body = Object.assign({ aktion, schluessel: zustand.zugang && zustand.zugang.schluessel }, daten);
    if (!(optionen && optionen.leise)) $("laden").hidden = false;
    try {
      let antwort;
      if (window.ERFASSEN_TESTBACKEND) {
        antwort = await window.ERFASSEN_TESTBACKEND(body);
      } else {
        if (!cfg.erfassenUrl) throw new Error("In config.js fehlt die Adresse der Web-App (erfassenUrl).");
        // text/plain vermeidet eine Vorab-Anfrage, die Apps Script nicht beantwortet.
        const senden = () => fetch(cfg.erfassenUrl, {
          method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "text/plain;charset=utf-8" },
        });
        let r;
        try {
          r = await senden();
        } catch (netzFehler) {
          // Apps Script "schläft" manchmal; ein zweiter Versuch nach kurzer Pause klappt meist.
          await new Promise((fertig) => setTimeout(fertig, 1500));
          r = await senden();
        }
        antwort = await r.json();
      }
      if (antwort.code === "schluessel" && aktion !== "entsperren" && !(optionen && optionen.ohneSperre)) {
        sperren("Bitte erneut entsperren (der Zugang gilt 7 Tage).");
        throw new Error("abgelaufen");
      }
      return antwort;
    } catch (fehler) {
      if (fehler.message === "abgelaufen") throw fehler;
      console.error(fehler);
      return { ok: false, fehler: "Keine Verbindung zur Tonie-Erfassung. Bitte später erneut versuchen." };
    } finally {
      $("laden").hidden = true;
    }
  }

  // ---------- Passwort / Zugang ----------
  function gespeicherterZugang() {
    try {
      const z = JSON.parse(localStorage.getItem(SPEICHER));
      return z && z.schluessel && z.bis > Date.now() ? z : null;
    } catch (e) { return null; }
  }

  function sperren(text) {
    zustand.zugang = null;
    try { localStorage.removeItem(SPEICHER); } catch (e) {}
    $("passwort").value = "";
    meldung("sperre-meldung", text || "", "hinweis");
    zeige("bereich-sperre");
  }

  $("form-sperre").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const a = await anfrage("entsperren", { passwort: $("passwort").value });
    $("passwort").value = "";
    if (!a.ok) return meldung("sperre-meldung", a.fehler);
    zustand.zugang = { schluessel: a.schluessel, bis: a.bis };
    try { localStorage.setItem(SPEICHER, JSON.stringify(zustand.zugang)); } catch (e) {}
    meldung("sperre-meldung", "");
    await start();
  });
  $("sperren").addEventListener("click", () => sperren("Gesperrt."));

  // ---------- Start, Liste und Vorschläge ----------
  async function listeLaden() {
    const a = await anfrage("liste");
    if (!a.ok) return;
    zustand.liste = a.tonies;
    const werte = (feld, trennen) => {
      const alle = zustand.liste.flatMap((t) => trennen ? String(t[feld]).split(",") : [t[feld]]);
      return [...new Set(alle.map((w) => String(w).trim()).filter(Boolean))].sort((x, y) => x.localeCompare(y, "de"));
    };
    // Feste Formate immer vorschlagen (auch wenn noch keins davon in der Sammlung ist), dazu die vorhandenen
    const FORMATE = ["Tonie-Figur", "Kreativ-Tonie", "Kuschel-Tonie", "Pocket-Tonie", "Clever-Tonie", "My first Tonie", "Tonieplay", "Audioinhalt"];
    [["reihe"], ["kollektion"], ["format"], ["inhalt"], ["thema", true]].forEach(([feld, trennen]) => {
      const liste = feld === "format" ? FORMATE.concat(werte(feld).filter((w) => FORMATE.indexOf(w) < 0)) : werte(feld, trennen);
      $("vorschlag-" + feld).innerHTML = liste.map((w) => `<option value="${esc(w)}">`).join("");
    });
  }

  async function start() {
    const id = new URLSearchParams(location.search).get("id");
    if (id) {
      // Erst die Auswahllisten, dann die Werte setzen: sonst fehlt z. B. "Selten" noch in der Auswahl.
      const [e] = await Promise.all([anfrage("eintrag", { id }), listenLaden()]);
      if (!e.ok) { zeige("bereich-start"); reiter("suchen"); meldung("such-meldung", e.fehler); }
      else verwaltenOeffnen(e.eintrag);
      listeLaden();
      return;
    }
    if (PRUEFEN) {
      await listeLaden();
      listenLaden();
      return pruefenZeigen();
    }
    zeige("bereich-start");
    reiter(gemerkterReiter());
    katalogLaden();
    listenLaden();
    await listeLaden();
    const b = await anfrage("budget");
    if (b.ok) budgetZeigen(b.budget);
  }

  // ---------- Katalog im Browser (Suche ohne Wartezeit) ----------
  const KATALOG_SPEICHER = "tonie-katalog";
  zustand.katalog = null;

  function katalogAuspacken(k) {
    return k.eintraege.map((z) => {
      const e = {};
      k.felder.forEach((f, i) => { e[f] = z[i]; });
      e.neupreis = typeof e.neupreis === "number" ? e.neupreis : null;
      e.version = versionAusLink(e.link);
      return e;
    });
  }

  // Zuerst sofort aus dem Speicher des Geräts, dann im Hintergrund frisch vom Apps Script.
  async function katalogLaden() {
    try {
      const alt = JSON.parse(localStorage.getItem(KATALOG_SPEICHER));
      if (alt && alt.eintraege) zustand.katalog = katalogAuspacken(alt);
    } catch (e) { /* kein gespeicherter Katalog */ }
    const k = await anfrage("katalog", {}, { leise: true });
    if (!k.ok) return;
    zustand.katalog = katalogAuspacken(k);
    try { localStorage.setItem(KATALOG_SPEICHER, JSON.stringify(k)); } catch (e) { /* Speicher voll: egal */ }
  }

  // Gleiche Logik wie "suchen" im Apps Script: zuerst deine Liste, dann der Katalog, ohne Doppelte.
  function lokaleSuche(text, max) {
    max = max || 24;
    const ausListe = TonieSuche.suchen(zustand.liste, text, { max: 6 })
      .map((t) => Object.assign({}, t.eintrag, { quelle: "liste", vorhanden: t.eintrag }));
    const schonDa = {};
    const name = (t) => vereinfachen(t.titel) + "|" + vereinfachen(t.reihe);
    ausListe.forEach((t) => { (schonDa[name(t)] = schonDa[name(t)] || []).push(t.version); if (t.link) schonDa[linkSchluessel(t.link)] = [true]; });
    // Katalogeintrag nur weglassen, wenn es derselbe Tonie in derselben Version ist (wie im Apps Script)
    const doppelt = (k) => (k.link && schonDa[linkSchluessel(k.link)]) ||
      (schonDa[name(k)] && (!k.version || schonDa[name(k)].some((v) => v && vereinfachen(v) === vereinfachen(k.version))));
    const ausKatalog = TonieSuche.suchen(zustand.katalog || [], text).map((t) => t.eintrag)
      .filter((k) => !doppelt(k))
      .slice(0, max - ausListe.length)
      .map((k) => Object.assign({}, k, { quelle: "katalog", vorhanden: findeVorhanden(k) }));
    return ausListe.concat(ausKatalog);
  }

  // Verbrauch für Foto und Websuche, z. B. "Diesen Monat verbraucht: 0,45 Cent von 5,00 $".
  // In Cent, weil ein einzelnes Foto nur Bruchteile eines Cents kostet.
  function budgetZeigen(b) {
    if (!b) return;
    const geld = (x) => x.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.querySelectorAll(".budget-zeile").forEach((el) => {
      el.textContent = `Foto und Websuche – diesen Monat verbraucht: ${geld(b.verbrauchtUsd * 100)} Cent von ${geld(b.budgetUsd)} $`;
    });
  }

  function reiter(name) {
    document.querySelectorAll("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== name; });
    document.querySelectorAll(".reiter [data-reiter]").forEach((k) => k.setAttribute("aria-pressed", k.dataset.reiter === name));
    if (name === "hand") return formularOeffnen({}, null);
    zeige("bereich-start");
    titelSetzen(CHECK);
    zustand.reiter = name;
    try { localStorage.setItem(REITER_SPEICHER, name); } catch (x) {}
    if (name === "suchen") $("suchtext").focus();
  }
  document.addEventListener("click", (ev) => {
    const k = ev.target.closest("[data-reiter]");
    if (k) reiter(k.dataset.reiter);
  });

  // ---------- Suchen ----------
  async function sucheAusfuehren() {
    const text = $("suchtext").value.trim();
    trefferZeigen([], "treffer");
    $("nichts-gefunden").hidden = true;
    $("mehr-suchen").hidden = true;
    meldung("such-meldung", "");
    if (!text) return;
    let treffer;
    if (zustand.katalog) {
      treffer = lokaleSuche(text);
    } else {
      const a = await anfrage("suchen", { text });
      if (!a.ok) return meldung("such-meldung", a.fehler);
      treffer = a.treffer;
    }
    trefferZeigen(treffer, "treffer", text);
    $("nichts-gefunden").hidden = treffer.length > 0;
    $("mehr-suchen").hidden = treffer.length === 0;
  }
  $("form-suche").addEventListener("submit", (ev) => { ev.preventDefault(); sucheAusfuehren(); });
  // Mit geladenem Katalog sucht die Seite schon beim Tippen (kostet nichts, keine Wartezeit).
  let suchTimer;
  $("suchtext").addEventListener("input", () => {
    if (!zustand.katalog) return;
    clearTimeout(suchTimer);
    suchTimer = setTimeout(sucheAusfuehren, 200);
  });

  // Websuche aus dem Reiter "Suchen" (kostenpflichtig, nur auf Knopfdruck)
  async function netzSuchenText() {
    const text = $("suchtext").value.trim();
    if (!text) return $("suchtext").focus();
    $("nichts-gefunden").hidden = true;
    $("mehr-suchen").hidden = true;
    meldung("such-meldung", "Suche im Netz … das dauert etwa 10–30 Sekunden.", "hinweis");
    const a = await anfrage("netz", { text });
    budgetZeigen(a.budget);
    if (!a.ok) return meldung("such-meldung", a.fehler);
    trefferZeigen(a.treffer, "treffer");
    meldung("such-meldung", a.treffer.length
      ? "Gefunden im Netz – bitte die Angaben im nächsten Schritt prüfen."
      : "Auch im Netz nichts gefunden. Bitte von Hand eintragen.", "hinweis");
  }

  // Jede Trefferliste merkt sich ihre Einträge (es können zwei gleichzeitig sichtbar sein).
  zustand.trefferlisten = {};
  function trefferZeigen(liste, ulId, suchtext) {
    zustand.trefferlisten[ulId] = liste;
    $(ulId).innerHTML = liste.map((t, i) => trefferKarte(t, i, suchtext)).join("");
  }

  const SICHERHEIT = { hoch: "sehr wahrscheinlich", mittel: "wahrscheinlich", niedrig: "vielleicht" };

  function trefferKarte(t, i, suchtext) {
    const zeige = (text) => suchtext ? TonieSuche.markieren(text, suchtext, esc) : esc(text);
    const oben = [t.reihe, t.kollektion].filter(Boolean).join(" · ");
    const marken = [];
    if (t.version) marken.push(versionMarke(t.version)); // alte Version und Neuauflage auseinanderhalten
    if (t.sicherheit) marken.push(`<span class="marke sicher-${esc(t.sicherheit)}">${SICHERHEIT[t.sicherheit] || esc(t.sicherheit)}</span>`);
    if (t.vorhanden) marken.push(`<span class="marke behalten">In deiner Liste: ${anzahlText(t.vorhanden)}</span>`);
    else if (t.format) marken.push(`<span class="marke">${esc(t.format)}</span>`);
    if (t.quelle === "netz" || t.herkunft === "Community") marken.push(`<span class="marke">Quelle: ${esc(t.herkunft)}</span>`);
    return `<li><button type="button" class="treffer-karte" data-treffer="${i}">
      ${bildHtml(t.bild, t.reihe || t.titel)}
      <span class="text">
        <span class="reihe">${zeige(oben)}</span>
        <span class="titel">${zeige(t.titel)}</span>
        ${marken.join("")}
      </span></button></li>`;
  }

  ["treffer", "foto-treffer", "foto-sofort-treffer"].forEach((id) => $(id).addEventListener("click", (ev) => {
    const k = ev.target.closest("[data-treffer]");
    if (!k) return;
    const t = zustand.trefferlisten[id][Number(k.dataset.treffer)];
    // Foto oder Name: erst die Ergebnisansicht ("Habe ich schon?", Wert), danach prüfen oder hinzufügen
    ergebnisZeigen(t, null);
  }));

  // ---------- Foto ----------
  const MAX_FOTOS = 3;
  zustand.fotos = [];

  // Fotos im Browser verkleinern: schneller und günstiger. Schrift bleibt bei 1024 px meist lesbar.
  async function fotoVerkleinern(datei, max) {
    const bild = await createImageBitmap(datei);
    const faktor = Math.min(1, (max || 1024) / Math.max(bild.width, bild.height));
    const leinwand = document.createElement("canvas");
    leinwand.width = Math.round(bild.width * faktor);
    leinwand.height = Math.round(bild.height * faktor);
    leinwand.getContext("2d").drawImage(bild, 0, 0, leinwand.width, leinwand.height);
    return leinwand.toDataURL("image/jpeg", 0.8);
  }

  async function fotosHinzufuegen(dateien) {
    for (const datei of Array.from(dateien)) {
      if (zustand.fotos.length >= MAX_FOTOS) {
        meldung("foto-meldung", `Höchstens ${MAX_FOTOS} Fotos. Bitte zuerst eins mit × entfernen.`, "hinweis");
        break;
      }
      try {
        zustand.fotos.push(await fotoVerkleinern(datei));
      } catch (e) {
        meldung("foto-meldung", "Dieses Bild ließ sich nicht lesen. Bitte ein anderes Foto versuchen.");
      }
    }
    fotoAnsichtAktualisieren();
  }
  ["foto-kamera", "foto-datei"].forEach((id) => $(id).addEventListener("change", (ev) => {
    fotosHinzufuegen(ev.target.files);
    ev.target.value = "";
  }));

  // Löschen wirkt nur hier im Browser: Ein entferntes Foto wird nirgends hingeschickt.
  $("foto-vorschau").addEventListener("click", (ev) => {
    const k = ev.target.closest("[data-foto-weg]");
    if (!k) return;
    zustand.fotos.splice(Number(k.dataset.fotoWeg), 1);
    fotoAnsichtAktualisieren();
  });

  function fotoAnsichtAktualisieren() {
    $("foto-vorschau").innerHTML = zustand.fotos.map((f, i) => `<li>
      <img src="${f}" alt="Foto ${i + 1}">
      <button type="button" class="foto-weg" data-foto-weg="${i}" aria-label="Foto ${i + 1} entfernen">×</button></li>`).join("");
    $("foto-los").disabled = zustand.fotos.length === 0;
  }

  // Hinweis tippen → sofort kostenlose Treffer aus Liste und Katalog zeigen.
  let hinweisTimer;
  $("foto-hinweis").addEventListener("input", () => {
    clearTimeout(hinweisTimer);
    hinweisTimer = setTimeout(() => {
      const text = $("foto-hinweis").value.trim();
      const treffer = text && zustand.katalog ? lokaleSuche(text, 6) : [];
      trefferZeigen(treffer, "foto-sofort-treffer", text);
      $("foto-sofort").hidden = treffer.length === 0;
    }, 250);
  });

  function fotoErgebnisLeeren() {
    trefferZeigen([], "foto-treffer");
    $("foto-vorschlaege").innerHTML = "";
    $("foto-ueberschrift").hidden = true;
    $("foto-weiter").hidden = true;
    meldung("foto-meldung", "");
  }

  function fotoErgebnis(ueberschrift, treffer) {
    trefferZeigen(treffer, "foto-treffer");
    $("foto-ueberschrift").textContent = ueberschrift;
    $("foto-ueberschrift").hidden = false;
    $("foto-weiter").hidden = false;
  }

  function beschreibungText(b) {
    if (!b) return "";
    const teile = [b.figur, b.reihe, b.bauform !== "unbekannt" ? b.bauform : ""].filter(Boolean);
    return "Erkannt: " + teile.join(" · ") + (b.sichtbarer_text ? ` · Text: „${b.sichtbarer_text}“` : "") + ".";
  }

  // Ablauf (mit deinen Testfotos gemessen, 5–6 von 6 auf Platz 1):
  //  1. gleichzeitig: Foto beschreiben + Textsuche  UND  visuelle Vorsichtung über alle Katalogbilder
  //  2. Bildvergleich mit den 12 besten aus der Vorsichtung und bis zu 18 aus der Textsuche
  async function fotoLos() {
    if (!zustand.fotos.length) return;
    fotoErgebnisLeeren();
    const hinweis = $("foto-hinweis").value.trim();
    meldung("foto-meldung", "Schritt 1 von 2: Foto wird beschrieben und mit allen Katalogbildern verglichen …", "hinweis");
    const [a, v] = await Promise.all([
      anfrage("beschreiben", { fotos: zustand.fotos, hinweis }),
      anfrage("vorsichten", { fotos: zustand.fotos }),
    ]);
    budgetZeigen((v.budget && a.budget && v.budget.verbrauchtUsd > a.budget.verbrauchtUsd ? v : a).budget);
    if (!a.ok && !v.ok) return meldung("foto-meldung", a.fehler || v.fehler);
    zustand.beschreibung = a.ok ? a.beschreibung : null;
    const kandidaten = [];
    const dazu = (k) => { if (k && !kandidaten.some((x) => x.schluessel === k.schluessel)) kandidaten.push(k); };
    (v.kandidaten || []).slice(0, 12).forEach(dazu);
    (a.kandidaten || []).forEach((k) => { if (kandidaten.length < 30) dazu(k); });
    if (!kandidaten.length) {
      meldung("foto-meldung", "");
      return fotoErgebnis(`${beschreibungText(zustand.beschreibung)} Kein passender Tonie in Liste oder Katalog.`, []);
    }
    meldung("foto-meldung", "Schritt 2 von 2: genauer Bildvergleich …", "hinweis");
    const b = await anfrage("auswaehlen", { fotos: zustand.fotos, kandidaten: kandidaten.map((k) => k.schluessel) });
    budgetZeigen(b.budget);
    if (!b.ok) return meldung("foto-meldung", b.fehler);
    meldung("foto-meldung", "");
    const text = beschreibungText(zustand.beschreibung);
    fotoErgebnis(b.treffer.length ? `${text} Passende Tonies:` : `${text} Kein passender Tonie in Liste oder Katalog.`, []);
    vorschlaegeZeigen(b.treffer, b.version || {});
  }

  function selbstSuchen() {
    const b = zustand.beschreibung || {};
    const text = $("foto-hinweis").value.trim() || [b.figur, b.reihe].filter(Boolean).join(" ");
    reiter("suchen");
    $("suchtext").value = text;
    sucheAusfuehren();
  }

  async function netzSuchenFoto() {
    const b = zustand.beschreibung || {};
    const text = $("foto-hinweis").value.trim() || [b.figur, b.reihe].filter(Boolean).join(" ");
    fotoErgebnisLeeren();
    meldung("foto-meldung", "Suche im Netz … das dauert etwa 10–30 Sekunden.", "hinweis");
    const a = await anfrage("netz", { text, fotos: zustand.fotos });
    budgetZeigen(a.budget);
    if (!a.ok) return meldung("foto-meldung", a.fehler);
    meldung("foto-meldung", "");
    fotoErgebnis(a.treffer.length ? "Gefunden im Netz – bitte die Angaben im nächsten Schritt prüfen:"
      : "Auch im Netz nichts gefunden. Bitte von Hand eintragen.", a.treffer);
  }

  document.addEventListener("click", (ev) => {
    const k = ev.target.closest("[data-aktion]");
    if (!k) return;
    const aktion = k.dataset.aktion;
    if (aktion === "anders-schreiben") { $("suchtext").select(); $("suchtext").focus(); }
    if (aktion === "abbrechen") abbrechen();
    if (aktion === "ergaenzen") ergaenzenModus(zustand.vorhanden);
    if (aktion === "auslesen") auslesen();
    if (aktion === "zur-sammlung") zurueckZurSammlung();
    if (aktion === "wert-ergebnis") {
      const { t, genau } = zustand.ergebnis;
      // Schon in der Sammlung: mit dessen Werten und ID (dann wird direkt gespeichert)
      wertAssistent(genau ? Object.assign({}, genau) : Object.assign({}, t, { id: "" }), "ergebnis");
    }
    if (aktion === "wert-verwalten") wertAssistent(Object.assign({}, zustand.eintrag), "verwalten");
    if (aktion === "naechster-tonie" || aktion === "naechsten-erkennen") naechsteErkennung();
    if (aktion === "version-alt") { $("f-version").value = "Original"; versionFrage(); }
    if (aktion === "netz-text") netzSuchenText();
    if (aktion === "foto-los") fotoLos();
    if (aktion === "selbst-suchen") selbstSuchen();
    if (aktion === "netz-foto") netzSuchenFoto();
  });

  function abbrechen() {
    if (zustand.modus === "verwalten") return zurueckZurSammlung();
    $("suchtext").value = "";
    $("treffer").innerHTML = "";
    $("nichts-gefunden").hidden = true;
    $("mehr-suchen").hidden = true;
    meldung("such-meldung", "");
    zustand.fotos = [];
    zustand.beschreibung = null;
    $("foto-hinweis").value = "";
    $("foto-sofort").hidden = true;
    fotoAnsichtAktualisieren();
    fotoErgebnisLeeren();
    zeige("bereich-start");
    reiter(zustand.reiter || gemerkterReiter());
  }

  // ---------- Formular ----------
  const FELDER = ["link", "bild", "titel", "reihe", "kollektion", "format", "inhalt", "thema", "version", "raritaet", "bewertung", "preis", "zustand",
    "richtwert", "richtwertOvp", "wertQuelle", "wertStand", "verliehenAn", "verliehenAm", "kommentar", "pruefen"];

  function feldSetzen(name, wert) {
    let w = wert === null || wert === undefined ? "" : (name === "preis" ? preisText(wert) : String(wert));
    if (name === "raritaet" && w === "Normal") w = "";
    $("f-" + name).value = w;
    if (name === "bewertung") sterneZeichnen();
  }

  // ---------- Bewertung (1–5 Sterne) ----------
  const BEWERTUNG_TEXT = ["", "Nicht gut", "Geht so", "Ok", "Gut", "Sehr gut"];
  function sterneZeichnen() {
    const n = Number($("f-bewertung").value) || 0;
    document.querySelectorAll(".stern").forEach((s) => {
      const an = Number(s.dataset.stern) <= n;
      s.classList.toggle("an", an);
      s.setAttribute("aria-pressed", String(Number(s.dataset.stern) === n));
    });
    $("bewertung-text").textContent = n ? `${n} ★ – ${BEWERTUNG_TEXT[n]}` : "noch keine Bewertung";
    document.querySelector('[data-aktion="bewertung-leeren"]').hidden = !n || zustand.modus === "lesen";
  }
  document.addEventListener("click", (ev) => {
    const s = ev.target.closest("[data-stern]");
    const leeren = ev.target.closest('[data-aktion="bewertung-leeren"]');
    if (!s && !leeren) return;
    // Nochmal auf denselben Stern tippen = Bewertung wieder entfernen
    $("f-bewertung").value = leeren || $("f-bewertung").value === s.dataset.stern ? "" : s.dataset.stern;
    sterneZeichnen();
  });

  // Ansicht je Modus: neu, ergänzen (Anzahl erhöhen) oder verwalten (alle Felder eines Tonies ändern)
  function modusAnzeigen() {
    const verw = zustand.modus === "verwalten";
    document.title = $("seitentitel").textContent = verw || VERWALTEN_ID ? "Tonie verwalten" : "Tonie hinzufügen";
    $("feld-pruefen").hidden = !verw;
    $("archiv-bereich").hidden = !verw;
    $("archiv-frage").hidden = true;
    $("konflikt").hidden = true;
  }

  function formularOeffnen(felder, vorhanden) {
    nurLesen(false);
    $("wert-einstieg").hidden = true;
    $("preis-historie").hidden = true;
    zustand.ausErkennen = false;
    zustand.andereVersion = false;
    zustand.modus = "neu";
    zustand.ziel = null;
    zustand.eintrag = null;
    $("form-tonie").reset();
    modusAnzeigen();
    FELDER.forEach((f) => feldSetzen(f, felder[f]));
    ["behalten", "verkaufen"].forEach((art) => { $("h-" + art).checked = false; $("f-" + art).value = 1; });
    neupreisZeigen(felder.neupreis);
    beschriftungen();
    meldung("formular-meldung", "");
    meldung("auslesen-meldung", "");
    bildVorschau();
    eigenStart(felder.eigenesFoto);
    listenHinweis();
    vorhandenZeigen(vorhanden || null);
    zeige("bereich-formular");
  }

  // "Tonie verwalten": alle Felder des Tonies mit den aktuellen Werten, Anzahlen absolut.
  function verwaltenOeffnen(e) {
    formularOeffnen(e, null);
    zustand.modus = "verwalten";
    zustand.eintrag = e;
    modusAnzeigen();
    $("wert-einstieg").hidden = !zustand.zugang;
    preisHistorie(e);
    ["behalten", "verkaufen"].forEach((art) => {
      $("h-" + art).checked = e[art] > 0;
      $("f-" + art).value = e[art] > 0 ? e[art] : 1;
    });
    beschriftungen();
    window.scrollTo(0, 0);
  }

  function neupreisZeigen(neupreis) {
    $("neupreis").hidden = typeof neupreis !== "number";
    if (typeof neupreis === "number") $("neupreis").textContent = `Neupreis bei tonies.com: ${preisText(neupreis)} €`;
  }

  // Beschriftungen und Vorschau hängen vom Modus ab (neu oder ergänzen).
  function beschriftungen() {
    const erg = zustand.modus === "ergaenzen";
    $("text-behalten").textContent = erg ? "+ behalten" : "Behalten";
    $("text-verkaufen").textContent = erg ? "+ verkaufen" : "Verkaufen";
    $("anzahl-legende").textContent = erg ? "Hinzufügen" : "Anzahl";
    $("eintragen").textContent = erg ? "Eintrag aktualisieren" : zustand.modus === "verwalten" ? "Speichern" : "Eintragen";
    $("ergaenzen-titel").hidden = !erg;
    anzahlAktualisieren();
  }

  // Audioinhalte sind digital: keine Anzahl, kein Verkauf, kein Wert
  const istAudioForm = () => $("f-format").value.trim() === "Audioinhalt";

  function anzahlen() {
    if (istAudioForm()) return { behalten: 0, verkaufen: 0 };
    const wert = (art) => $("h-" + art).checked ? Math.max(0, parseInt($("f-" + art).value, 10) || 0) : 0;
    return { behalten: wert("behalten"), verkaufen: wert("verkaufen") };
  }

  function anzahlAktualisieren() {
    ["behalten", "verkaufen"].forEach((art) => { $("f-" + art).disabled = !$("h-" + art).checked; });
    const n = anzahlen();
    const ziel = zustand.ziel;
    const audio = istAudioForm();
    document.querySelector("fieldset.anzahl").hidden = audio;
    if (audio) $("wert-einstieg").hidden = true;
    else if (zustand.modus === "verwalten") $("wert-einstieg").hidden = !zustand.zugang;
    const verkauf = !audio && (n.verkaufen > 0 || (ziel && ziel.verkaufen > 0));
    $("verkaufsfelder").hidden = !verkauf;
    // Zustand gehört nur zum Exemplar im Verkauf: freundlicher Hinweis, blockiert aber nicht.
    $("zustand-hinweis").hidden = !(verkauf && !$("f-zustand").value);
    if (ziel) {
      $("anzahl-vorschau").textContent = "Danach: " + anzahlText({ behalten: ziel.behalten + n.behalten, verkaufen: ziel.verkaufen + n.verkaufen });
    } else {
      $("anzahl-vorschau").textContent = n.behalten || n.verkaufen ? "" : "Ohne Anzahl erscheint der Tonie mit „Anzahl fehlt“.";
    }
  }
  ["h-behalten", "h-verkaufen", "f-behalten", "f-verkaufen", "f-zustand"].forEach((id) => $(id).addEventListener("input", anzahlAktualisieren));

  // ---------- Verleihen ----------
  // Name eingetragen, Datum leer → heute (deutsche Zeit). "Zurückgegeben" leert beides.
  function heuteBerlin() {
    const teile = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date()).reduce((o, t) => (o[t.type] = t.value, o), {});
    return `${teile.year}-${teile.month}-${teile.day}`;
  }
  $("f-verliehenAn").addEventListener("input", () => {
    if ($("f-verliehenAn").value.trim() && !$("f-verliehenAm").value) $("f-verliehenAm").value = heuteBerlin();
    if (!$("f-verliehenAn").value.trim()) $("f-verliehenAm").value = "";
  });

  // ---------- Auswahllisten aus dem Tab "Listen" ----------
  zustand.listen = null;
  async function listenLaden() {
    const a = await anfrage("listen", {}, { leise: true });
    if (!a.ok) return;
    zustand.listen = a.listen;
    const optionen = (werte) => werte.map((w) => `<option value="${esc(w)}">`).join("");
    [["format", "Format"], ["inhalt", "Inhalt"], ["thema", "Thema"], ["version", "Version"]].forEach(([feld, name]) => {
      const vorhanden = [...$("vorschlag-" + feld).options].map((o) => o.value);
      const alle = [...new Set((a.listen[name] || []).concat(vorhanden))];
      $("vorschlag-" + feld).innerHTML = optionen(alle);
    });
    const auswahl = (id, werte, leer) => {
      const alt = $(id).value;
      $(id).innerHTML = `<option value="">${leer}</option>` + werte.filter((w) => w !== "Normal")
        .map((w) => `<option>${esc(w)}</option>`).join("");
      $(id).value = alt;
    };
    auswahl("f-zustand", a.listen["Zustand"] || [], "–");
    auswahl("f-raritaet", a.listen["Rarität"] || [], "Normal");
  }

  // Werte, die nicht in den Listen stehen, sind erlaubt, bekommen aber einen kurzen Hinweis.
  function listenHinweis() {
    const l = zustand.listen;
    if (!l) return ($("listen-hinweis").hidden = true);
    const neu = [];
    [["format", "Format"], ["inhalt", "Inhalt"], ["thema", "Thema"]].forEach(([feld, name]) => {
      $("f-" + feld).value.split(",").map((w) => w.trim()).filter(Boolean)
        .forEach((w) => { if (!(l[name] || []).includes(w)) neu.push(`„${w}“`); });
    });
    $("listen-hinweis").hidden = !neu.length;
    $("listen-hinweis").textContent = neu.length
      ? `${neu.join(", ")} steht nicht im Tab „Listen“ – wird trotzdem so übernommen.` : "";
  }
  ["f-format", "f-inhalt", "f-thema"].forEach((id) => $(id).addEventListener("change", listenHinweis));
  // Format "Audioinhalt" gewählt oder wieder geändert: Anzahl- und Verkaufsfelder ein-/ausblenden
  ["input", "change"].forEach((art) => $("f-format").addEventListener(art, anzahlAktualisieren));

  // ---------- Doppelte ----------
  function vereinfachen(text) {
    return String(text || "").toLowerCase().replace(/ß/g, "ss")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u").trim();
  }
  const linkSchluessel = (u) => String(u || "").trim().toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "");

  // Wie im Apps Script: alte Version und Neuauflage sind zwei verschiedene Tonies; leer/"unbekannt" passt zu allem.
  function versionenPassen(a, b) {
    const v = (x) => vereinfachen(x).replace(/\s+/g, " ").trim();
    const x = v(a), y = v(b);
    return !x || !y || x === "unbekannt" || y === "unbekannt" || x === y;
  }
  function findeVorhanden(f) {
    const link = linkSchluessel(f.link);
    const name = vereinfachen(f.titel) + "|" + vereinfachen(f.reihe);
    return zustand.liste.find((t) => (link && linkSchluessel(t.link) === link) ||
      (f.titel && f.reihe && vereinfachen(t.titel) + "|" + vereinfachen(t.reihe) === name && versionenPassen(t.version, f.version))) || null;
  }

  function vorhandenZeigen(t) {
    zustand.vorhanden = t;
    $("vorhanden").hidden = !t || zustand.modus === "ergaenzen";
    if (t) $("vorhanden-text").innerHTML = `<strong>${esc(t.titel)}</strong> (${esc(t.reihe)}) steht schon in deiner Liste: ${anzahlText(t)}.`;
  }

  // Bei Eingabe von Hand laufend prüfen.
  let pruefTimer;
  ["f-titel", "f-reihe", "f-link"].forEach((id) => $(id).addEventListener("input", () => {
    clearTimeout(pruefTimer);
    pruefTimer = setTimeout(() => {
      if (zustand.modus === "neu") vorhandenZeigen(findeVorhanden(formularWerte()));
    }, 400);
  }));

  // "Anzahl erhöhen": Formular zeigt die aktuellen Werte aus deiner Liste.
  function ergaenzenModus(t) {
    if (!t) return;
    zustand.modus = "ergaenzen";
    zustand.ziel = t;
    FELDER.forEach((f) => feldSetzen(f, t[f]));
    ["behalten", "verkaufen"].forEach((art) => { $("h-" + art).checked = false; $("f-" + art).value = 1; });
    $("ergaenzen-titel").innerHTML = `Vorhandenen Eintrag ergänzen: <strong>${esc(t.titel)}</strong> – aktuell ${anzahlText(t)}`;
    $("vorhanden").hidden = true;
    beschriftungen();
    bildVorschau();
    eigenStart(t.eigenesFoto);
    // Gerade ermittelte Werte nicht mit den alten aus der Sammlung überschreiben
    const erg = zustand.ergebnis;
    if (erg && erg.werte && erg.t && ((erg.t.link && erg.t.link === t.link) || erg.t.titel === t.titel)) werteInsFormular(erg.werte);
    window.scrollTo(0, 0);
  }

  // ---------- Daten von einer Seite holen ----------
  async function auslesen() {
    const url = $("f-link").value.trim();
    if (!/^https:\/\//i.test(url)) return meldung("auslesen-meldung", "Bitte eine vollständige Adresse mit https:// eingeben.");
    const a = await anfrage("auslesen", { url });
    if (!a.ok) return meldung("auslesen-meldung", a.fehler);
    // Nur leere Felder füllen, damit schon Eingetipptes erhalten bleibt (Link und Bild immer).
    FELDER.forEach((f) => {
      const neu = a.felder[f];
      if (neu && (f === "link" || f === "bild" || !$("f-" + f).value.trim())) feldSetzen(f, neu);
    });
    neupreisZeigen(a.felder.neupreis);
    bildVorschau();
    const gefuellt = a.felder.quelle === "tonies.com" ? "Felder von tonies.com übernommen." : `Titel und Bild von ${a.felder.quelle} übernommen – bitte Reihe usw. ergänzen.`;
    meldung("auslesen-meldung", gefuellt, "ok");
    if (zustand.modus === "neu") vorhandenZeigen(a.vorhanden ? findeVorhanden(a.vorhanden) || a.vorhanden : null);
  }

  // ---------- Version aus dem Link (wie versionAusLink im Apps Script) ----------
  // Nur "neuauflage(-JJJJ)" und "relaunch(-JJJJ)" zählen; "adventskalender-tonie-2025" ist keine Version.
  function versionAusLink(url) {
    const m = String(url || "").toLowerCase().match(/(neuauflage|relaunch)(?:-(\d{4}))?(?=[\/\-?#]|$)/);
    return m ? (m[1] === "relaunch" ? "Relaunch" : "Neuauflage") + (m[2] ? " " + m[2] : "") : "";
  }
  function versionVorbelegen() {
    if (!$("f-version").value.trim()) $("f-version").value = versionAusLink($("f-link").value);
    versionFrage();
  }
  // Steht im Katalog nur die Neuauflage, ausdrücklich nachfragen, ob dein Exemplar nicht die alte Version ist.
  function versionFrage() {
    const v = $("f-version").value.trim();
    $("version-frage").hidden = !(/neuauflage|relaunch/i.test(v) && zustand.modus !== "verwalten" && zustand.modus !== "lesen");
    $("version-frage-name").textContent = v;
  }
  $("f-version").addEventListener("input", versionFrage);
  $("f-link").addEventListener("change", versionVorbelegen);

  // Richtwert von Hand eingetragen → Wert-Stand heute (falls leer): dann gilt der Tonie als geprüft.
  ["f-richtwert", "f-richtwertOvp"].forEach((id) => $(id).addEventListener("change", () => {
    if ($(id).value.trim() && !$("f-wertStand").value) $("f-wertStand").value = heuteBerlin();
  }));
  function quelleKnopf() {
    const url = $("f-wertQuelle").value.trim();
    const ok = /^https:\/\/\S+$/i.test(url);
    $("quelle-oeffnen").hidden = !ok;
    if (ok) $("quelle-oeffnen").href = url;
  }
  $("f-wertQuelle").addEventListener("input", quelleKnopf);

  // ---------- Link öffnen (nur https) ----------
  function linkKnopf() {
    quelleKnopf();
    const url = $("f-link").value.trim();
    const ok = /^https:\/\/\S+$/i.test(url);
    $("link-oeffnen").hidden = !ok;
    if (ok) {
      $("link-oeffnen").href = url;
      let host = "";
      try { host = new URL(url).hostname.replace(/^www\./, ""); } catch (x) {}
      $("link-oeffnen").textContent = host ? `Auf ${host} öffnen ↗` : "Seite öffnen ↗";
    }
  }
  $("f-link").addEventListener("input", linkKnopf);

  // ---------- Bild ----------
  function bildVorschau() {
    linkKnopf();
    versionVorbelegen();
    const url = $("f-bild").value.trim();
    const img = $("bild-vorschau");
    img.hidden = !/^https:\/\//i.test(url);
    if (!img.hidden) img.src = url.replace(/\bw_\d+,h_\d+\b/, "w_300,h_300");
  }
  $("f-bild").addEventListener("change", bildVorschau);
  $("bild-vorschau").addEventListener("error", () => { $("bild-vorschau").hidden = true; });

  // ---------- Eigenes Foto ----------
  // Das Foto bleibt im Browser, bis gespeichert wird; erst dann geht es nach Google Drive.
  // bisher = Adresse aus dem Sheet, neu = verkleinertes Foto (800 px), weg = bisheriges entfernen
  function eigenStart(bisher) {
    zustand.eigen = { bisher: bisher || "", neu: null, weg: false };
    eigenAnzeigen();
  }
  function eigenAnzeigen() {
    const e = zustand.eigen;
    const zeigen = e.neu || (!e.weg && e.bisher) || "";
    $("eigen-vorschau").hidden = !zeigen;
    if (zeigen) $("eigen-vorschau").src = zeigen;
    $("eigen-leer").hidden = !!zeigen;
    $("eigen-weg").hidden = !zeigen;
    $("eigen-erkennung").hidden = !zustand.fotos.length || !!e.neu;
    $("eigen-hinweis").textContent = e.neu ? "Wird beim Speichern in deinem Google Drive (Ordner „Tonie-Bilder“) abgelegt."
      : e.weg ? "Wird beim Speichern entfernt (die Datei kommt in den Drive-Papierkorb)."
      : "Ersetzt auf der Seite das Bild aus der Bild-URL. Wird in deinem Google Drive gespeichert und ist für jeden mit der Bildadresse sichtbar.";
  }
  async function eigenSetzen(blob) {
    try {
      zustand.eigen.neu = await fotoVerkleinern(blob, 800);
      zustand.eigen.weg = false;
    } catch (x) {
      meldung("formular-meldung", "Dieses Bild ließ sich nicht lesen. Bitte ein anderes Foto versuchen.");
    }
    eigenAnzeigen();
  }
  ["eigen-kamera", "eigen-datei"].forEach((id) => $(id).addEventListener("change", (ev) => {
    if (ev.target.files[0]) eigenSetzen(ev.target.files[0]);
    ev.target.value = "";
  }));
  // Was mitgeschickt wird: ein neues Foto oder der Auftrag, das bisherige zu entfernen
  function fotoDaten() {
    const e = zustand.eigen;
    if (e.neu) return { foto: e.neu };
    return e.weg && e.bisher ? { fotoEntfernen: true } : {};
  }

  // ---------- Eintragen ----------
  function formularWerte() {
    const w = {};
    FELDER.forEach((f) => { w[f] = $("f-" + f).value.trim(); });
    if (zustand.modus !== "verwalten") delete w.pruefen;
    return w;
  }

  $("form-tonie").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (zustand.modus === "lesen") return;
    const felder = formularWerte();
    if (!felder.titel || !felder.reihe) {
      meldung("formular-meldung", "Bitte Titel und Reihe ausfüllen.");
      $(felder.titel ? "f-reihe" : "f-titel").focus();
      return;
    }
    const n = anzahlen();
    if (zustand.modus === "verwalten") return speichern(Object.assign(felder, n), false);
    const foto = fotoDaten();
    let daten;
    if (zustand.modus === "ergaenzen") {
      const ziel = zustand.ziel;
      if (!istAudioForm() && !n.behalten && !n.verkaufen && !confirm("Keine Anzahl hinzugefügt. Nur die Angaben aktualisieren?")) return;
      daten = Object.assign({ modus: "ergaenzen", ziel: { link: ziel.link, titel: ziel.titel, reihe: ziel.reihe },
        plusBehalten: n.behalten, plusVerkaufen: n.verkaufen, felder }, foto);
    } else {
      daten = Object.assign({ modus: "neu", felder: Object.assign(felder, n), andereVersion: !!zustand.andereVersion }, foto);
    }
    const a = await anfrage("eintragen", daten);
    if (!a.ok && a.code === "vorhanden") {
      await listeLaden();
      vorhandenZeigen(findeVorhanden(a.vorhanden) || a.vorhanden);
      return window.scrollTo(0, 0);
    }
    if (!a.ok) return meldung("formular-meldung", a.fehler);
    const text = a.ergebnis === "ergaenzt" ? `„${a.titel}“ aktualisiert: ${anzahlText(a)}` : `„${a.titel}“ eingetragen`;
    // Aus "Tonie erkennen": gleich den nächsten Tonie fotografieren statt zurück zur Übersicht
    if (zustand.ausErkennen) return weiterZeigen(text);
    zurueckZurSammlung(text);
  });

  // ---------- Tonie verwalten: speichern, Konflikt, archivieren ----------
  async function speichern(felder, erzwingen) {
    const e = zustand.eintrag;
    const a = await anfrage("aendern", Object.assign({ id: e.id, stand: e.geaendertAm, erzwingen, felder }, fotoDaten()));
    if (!a.ok && a.code === "konflikt") {
      zustand.konflikt = { aktuell: a.aktuell, felder };
      $("konflikt").hidden = false;
      return window.scrollTo(0, 0);
    }
    if (!a.ok) return meldung("formular-meldung", a.fehler);
    zurueckZurSammlung(`„${a.eintrag.titel}“ gespeichert`);
  }

  async function archivieren() {
    const e = zustand.eintrag;
    const a = await anfrage("archivieren", { id: e.id });
    if (!a.ok) return meldung("formular-meldung", a.fehler);
    zurueckZurSammlung(`„${a.titel}“ archiviert`);
  }

  document.addEventListener("click", (ev) => {
    const k = ev.target.closest("[data-aktion]");
    if (!k) return;
    const aktion = k.dataset.aktion;
    if (aktion === "zurueckgegeben") { $("f-verliehenAn").value = ""; $("f-verliehenAm").value = ""; }
    if (aktion === "konflikt-neu-laden") verwaltenOeffnen(zustand.konflikt.aktuell);
    if (aktion === "konflikt-speichern") { $("konflikt").hidden = true; speichern(zustand.konflikt.felder, true); }
    if (aktion === "archivieren-frage") $("archiv-frage").hidden = false;
    if (aktion === "archivieren-nein") $("archiv-frage").hidden = true;
    if (aktion === "archivieren-ja") archivieren();
    if (aktion === "eigen-weg") { zustand.eigen.neu = null; zustand.eigen.weg = !!zustand.eigen.bisher; eigenAnzeigen(); }
    if (aktion === "eigen-erkennung" && zustand.fotos[0]) fetch(zustand.fotos[0]).then((r) => r.blob()).then(eigenSetzen);
  });

  // ---------- Tonie verwalten ohne Passwort: nur ansehen ----------
  // Ohne Schlüssel: nur öffentliche Angaben. Mit PIN (wie auf der Übersicht): auch Preis,
  // Kommentar und an wen verliehen – aber nichts änderbar. Ändern braucht das Passwort;
  // das prüft das Apps Script, die Sperre hier ist nur die Oberfläche.
  const PIN_SPEICHER = "tonie-pin";
  function pinZugang() {
    try { const z = JSON.parse(localStorage.getItem(PIN_SPEICHER)); return z && z.schluessel && z.bis > Date.now() ? z : null; }
    catch (x) { return null; }
  }
  const PRIVAT = ["preis", "kommentar", "verliehenAn", "verliehenAm", "richtwert", "richtwertOvp", "wertStand"];

  function nurLesen(an) {
    $("form-tonie").querySelectorAll("input, select, textarea, button:not([data-aktion='zur-sammlung'])")
      .forEach((e) => { e.disabled = an; });
    $("form-tonie").classList.toggle("nur-lesen", an);
    $("form-kopierhilfe").hidden = an; // nur ansehen: nichts einfügen
    $("lesen-leiste").hidden = !an;
    if (!an) {
      $("eintragen").hidden = false;
      document.querySelector(".eigenes-foto").hidden = false;
      PRIVAT.forEach((f) => { $("f-" + f).placeholder = { preis: "z. B. 12,50", verliehenAn: "leer = nicht verliehen",
        richtwert: "z. B. 17–22", richtwertOvp: "z. B. 20–23" }[f] || ""; });
    }
  }

  async function lesenStart() {
    let t = null;
    let privat = false;
    try {
      const a = JSON.parse(sessionStorage.getItem("tonie-auswahl"));
      if (a && a.id === VERWALTEN_ID) t = a;
    } catch (x) {}
    const pin = pinZugang();
    if (t) lesenZeigen(t, false); // sofort anzeigen, private Angaben folgen
    if (pin) {
      const a = await anfrage("sammlung", { schluessel: pin.schluessel }, { leise: !!t, ohneSperre: true });
      const mitPrivat = a.ok && a.tonies.find((x) => x.id === VERWALTEN_ID);
      if (mitPrivat) { t = mitPrivat; privat = true; }
      else if (a.code === "schluessel") { try { localStorage.removeItem(PIN_SPEICHER); } catch (x) {} }
    }
    // Seite direkt geöffnet: den Tonie aus der öffentlichen Liste holen
    if (!t && window.ToniesDaten && cfg.csvUrl) {
      try { t = (await ToniesDaten.laden(cfg.csvUrl)).find((x) => x.id === VERWALTEN_ID) || null; } catch (x) {}
    }
    if (!t) {
      sperren("Diesen Tonie gibt es nicht (mehr). Zum Hinzufügen bitte mit dem Passwort entsperren.");
      return;
    }
    lesenZeigen(t, privat);
  }

  // Nur ansehen: wer in ein Feld tippt oder klickt, bekommt den Hinweis aufs Passwort
  $("form-tonie").addEventListener("click", (ev) => {
    if (zustand.modus !== "lesen" || ev.target.closest("a, [data-aktion='zur-sammlung']")) return;
    if (!ev.target.closest(".feld, fieldset, label")) return;
    const leiste = $("lesen-leiste");
    $("lesen-text").textContent = "Zum Bearbeiten bitte mit dem Passwort entsperren („Bearbeiten (Passwort)“).";
    leiste.classList.remove("achtung"); void leiste.offsetWidth; leiste.classList.add("achtung");
    leiste.scrollIntoView({ behavior: "smooth", block: "center" });
    clearTimeout(leiste.timer);
    leiste.timer = setTimeout(() => leiste.classList.remove("achtung"), 2500);
  });

  function lesenZeigen(t, privat) {
    const sicher = Object.assign({}, t);
    if (!privat) PRIVAT.forEach((f) => { sicher[f] = ""; });
    verwaltenOeffnen(sicher);
    zustand.modus = "lesen";
    $("eintragen").hidden = true;
    $("archiv-bereich").hidden = true;
    $("feld-pruefen").hidden = true;
    $("sperren").hidden = true;
    document.querySelector(".eigenes-foto").hidden = true;
    nurLesen(true);
    if (!privat) {
      $("f-richtwert").placeholder = "🔒 mit PIN sichtbar";
      $("f-richtwertOvp").placeholder = "🔒 mit PIN sichtbar";
      $("f-preis").placeholder = "🔒 mit PIN sichtbar";
      $("f-kommentar").placeholder = "🔒 mit PIN sichtbar";
      $("f-verliehenAn").placeholder = t.verliehen === true || t.verliehen === "ja" ? "🔒 verliehen – an wen: mit PIN" : "nicht verliehen";
    } else {
      ["preis", "kommentar", "richtwert", "richtwertOvp"].forEach((f) => { $("f-" + f).placeholder = "–"; });
      $("f-verliehenAn").placeholder = "nicht verliehen";
    }
    $("lesen-pin-knopf").hidden = privat;
    $("lesen-pin").hidden = true;
    $("lesen-text").textContent = privat
      ? "Nur ansehen. Zum Ändern mit dem Passwort entsperren."
      : "Nur ansehen. Preis, Kommentar und an wen verliehen siehst du mit PIN; ändern geht mit dem Passwort.";
  }

  document.addEventListener("click", (ev) => {
    const k = ev.target.closest("[data-aktion]");
    if (!k) return;
    if (k.dataset.aktion === "lesen-pin") {
      $("lesen-pin").hidden = false;
      $("lesen-pin-eingabe").value = "";
      $("lesen-pin-eingabe").focus();
    }
    if (k.dataset.aktion === "lesen-bearbeiten") sperren("Zum Bearbeiten bitte mit dem Passwort entsperren.");
  });

  $("lesen-pin-eingabe").addEventListener("input", async () => {
    const feld = $("lesen-pin-eingabe");
    feld.value = feld.value.replace(/\D/g, "").slice(0, 4);
    if (feld.value.length < 4) return;
    feld.disabled = true;
    const a = await anfrage("pin", { pin: feld.value }, { ohneSperre: true });
    feld.disabled = false;
    if (!a.ok) {
      meldung("lesen-pin-meldung", a.code === "falsch" ? "PIN falsch." : a.fehler);
      feld.value = "";
      return feld.focus();
    }
    try { localStorage.setItem(PIN_SPEICHER, JSON.stringify({ schluessel: a.schluessel, bis: a.bis })); } catch (x) {}
    meldung("lesen-pin-meldung", "");
    lesenStart();
  });

  // ---------- Tonie erkennen: Vorschläge, Versionen, Ergebnis ----------
  const versionText = (v) => /^original$/i.test(String(v || "").trim()) ? "Alte Version"
    : /^unbekannt$/i.test(String(v || "").trim()) ? "Version unbekannt" : String(v || "").trim();
  const istNeu = (v) => /neuauflage|relaunch/i.test(v || "");
  const bildGross = (url, n) => String(url || "").replace(/\bw_\d+,h_\d+\b/, `w_${n},h_${n}`);
  // Wie versionsGruppe im Apps Script: gleicher Tonie ohne Versionswörter
  function versionsGruppe(t) {
    const ohne = (x) => vereinfachen(x).replace(/\((.*?)\)/g, " ")
      .replace(/\b(neuauflage|relaunch|alte version|original|neu)\b/g, " ").replace(/\b\d{4}\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ").trim();
    return ohne(t.titel) + "|" + ohne(t.reihe);
  }
  const zoomBild = (url, alt) => /^(https:|data:image)/.test(url || "")
    ? `<img src="${esc(url)}" alt="${esc(alt || "")}" data-zoom loading="lazy" onerror="this.remove()">` : "";
  function deineFotos() {
    return zustand.fotos.length ? `<div class="eigene-fotos"><span class="klein">Dein Foto</span>
      ${zustand.fotos.map((f, i) => zoomBild(f, "Dein Foto " + (i + 1))).join("")}</div>` : "";
  }
  const SICHER_TEXT = { hoch: "sehr wahrscheinlich", mittel: "wahrscheinlich", niedrig: "vielleicht" };
  const sicherMarke = (s) => s ? `<span class="marke sicher-${esc(s)}">${SICHER_TEXT[s] || esc(s)}</span>` : "";
  const versionMarke = (v) => v ? `<span class="marke version">${esc(versionText(v))}</span>`
    : `<span class="marke">Version ohne Angabe</span>`;
  // kurz = in schmalen Spalten nur "tonies.com ↗"
  const shopKnopf = (t, kurz) => /^https:\/\//.test(t.link || "")
    ? `<a class="knopf leise" href="${esc(t.link)}" target="_blank" rel="noopener noreferrer">${kurz ? "" : "Auf "}${esc(hostVon(t.link))}${kurz ? "" : " ansehen"} ↗</a>` : "";
  function hostVon(url) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch (x) { return "der Seite"; } }

  // Ein Satz zum Unterschied aus den Katalogdaten (kostenlos)
  function unterschiedSatz(ts) {
    const teile = ts.filter((t) => t.version).map((t) => {
      const anders = [];
      if (ts.some((o) => o !== t && vereinfachen(o.titel) !== vereinfachen(t.titel))) anders.push(`Titel „${t.titel}“`);
      if (t.untertitel && ts.some((o) => o !== t && o.untertitel !== t.untertitel)) anders.push(`Untertitel „${t.untertitel}“`);
      return `${versionText(t.version)}: ${anders.length ? anders.join(", ") : "anderes Cover"}`;
    });
    return teile.length ? teile.join(" · ") + "." : "Die Versionen unterscheiden sich vor allem am Cover.";
  }

  function vorschlaegeZeigen(treffer, urteil) {
    zustand.vorschlaege = treffer;
    const gruppen = [];
    const stelle = {};
    treffer.forEach((t, i) => {
      const g = t.gruppe || versionsGruppe(t);
      if (!(g in stelle)) { stelle[g] = gruppen.length; gruppen.push([]); }
      gruppen[stelle[g]].push(i);
    });
    $("foto-vorschlaege").innerHTML = gruppen.map((g) => g.length > 1 ? gruppeKarte(g, urteil) : einzelKarte(g[0])).join("");
  }

  function einzelKarte(i) {
    const t = zustand.vorschlaege[i];
    const vorhanden = t.vorhanden || findeVorhanden(t);
    return `<article class="vorschlag">
      <div class="vergleich">${deineFotos()}<div class="katalog-bild">${zoomBild(bildGross(t.bild, 500), t.titel)}</div></div>
      <p class="reihe">${esc([t.reihe, t.kollektion].filter(Boolean).join(" · "))}</p>
      <h3 class="titel">${esc(t.titel)}</h3>
      <div class="marken">${t.version ? versionMarke(t.version) : ""}${sicherMarke(t.sicherheit)}
        ${vorhanden ? `<span class="marke behalten">In deiner Liste: ${anzahlText(vorhanden)}</span>` : ""}</div>
      <div class="knopfreihe links">
        <button type="button" class="knopf" data-waehle="${i}">Das ist meiner</button>
        ${shopKnopf(t)}
        ${istNeu(t.version) ? `<button type="button" class="knopf leise" data-waehle="${i}" data-version="Original">Meiner ist die alte Version</button>` : ""}
      </div>
    </article>`;
  }

  function gruppeKarte(ids, urteil) {
    const ts = ids.map((i) => zustand.vorschlaege[i]);
    const empfohlen = ids.find((i) => zustand.vorschlaege[i].schluessel === urteil.schluessel);
    const namen = ts.map((t) => (versionText(t.version) || "Version ohne Angabe").replace(/^Alte /, "alte ")).join(" oder die ");
    const urteilHtml = empfohlen !== undefined
      ? `<p class="urteil ${urteil.sicher ? "sicher" : "unsicher"}">${esc(urteil.grund || "")}
          <span class="marke ${urteil.sicher ? "sicher-hoch" : "sicher-mittel"}">${urteil.sicher ? "ziemlich sicher" : "unsicher"}</span></p>
         ${urteil.sicher ? "" : `<p class="urteil-frage">Ist es die ${esc(namen)}?</p>`}`
      : `<p class="urteil-frage">Ist es die ${esc(namen)}?</p>`;
    const zwei = ts.filter((t) => t.bild).slice(0, 2);
    return `<article class="vorschlag gruppe">
      <p class="gruppe-kopf"><strong>Gleicher Tonie, ${ts.length} Versionen</strong> · ${esc(ts[0].titel)}</p>
      <p class="klein">${esc(unterschiedSatz(ts))}</p>
      ${deineFotos()}
      <div class="versionen">${ids.map((i) => {
        const t = zustand.vorschlaege[i];
        return `<div class="version-spalte${i === empfohlen ? " empfohlen" : ""}">
          <div class="katalog-bild">${zoomBild(bildGross(t.bild, 500), t.titel)}</div>
          <div class="marken">${versionMarke(t.version)}${sicherMarke(t.sicherheit)}</div>
          <button type="button" class="knopf${i === empfohlen ? "" : " leise"}" data-waehle="${i}">Diese Version</button>
          ${shopKnopf(t, true)}
        </div>`;
      }).join("")}</div>
      ${urteilHtml}
      <div class="knopfreihe links">
        <button type="button" class="knopf leise" data-waehle="${ids[0]}" data-version="unbekannt">Weiß ich nicht</button>
        ${zwei.length === 2 ? `<button type="button" class="knopf leise" data-unterschiede="${ids.filter((i) => zustand.vorschlaege[i].bild).slice(0, 2).join(",")}">Unterschiede anzeigen</button>` : ""}
      </div>
      <p class="klein unterschiede-text" hidden></p>
    </article>`;
  }

  $("foto-vorschlaege").addEventListener("click", async (ev) => {
    const w = ev.target.closest("[data-waehle]");
    if (w) return ergebnisZeigen(zustand.vorschlaege[Number(w.dataset.waehle)], w.dataset.version || null);
    const u = ev.target.closest("[data-unterschiede]");
    if (!u) return;
    const ziel = u.closest(".gruppe").querySelector(".unterschiede-text");
    u.disabled = true;
    const a = await anfrage("unterschiede", { versionen: u.dataset.unterschiede.split(",").map((i) => zustand.vorschlaege[+i].schluessel) });
    budgetZeigen(a.budget);
    ziel.hidden = false;
    ziel.textContent = a.ok ? a.unterschiede : a.fehler;
    u.disabled = !a.ok ? false : true;
  });

  // Bild antippen → groß
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("img[data-zoom]");
    if (!b) return;
    $("zoom-bild").src = bildGross(b.src, 1000);
    $("zoom").showModal();
  });
  $("zoom").addEventListener("click", (ev) => { if (ev.target === $("zoom") || ev.target.closest("[data-schliessen]")) $("zoom").close(); });

  // "Habe ich schon?" für genau diese Version; andere Versionen als Hinweis
  function inDerListe(t) {
    const gruppe = versionsGruppe(t);
    const gleich = zustand.liste.filter((x) => (t.link && linkSchluessel(x.link) === linkSchluessel(t.link)) || versionsGruppe(x) === gruppe);
    const v = vereinfachen(t.version);
    const genau = gleich.filter((x) => (t.link && linkSchluessel(x.link) === linkSchluessel(t.link)) ||
      (v && v !== "unbekannt" ? vereinfachen(x.version) === v || !x.version : true));
    return { genau: genau[0] || null, andere: gleich.filter((x) => genau.indexOf(x) < 0) };
  }

  // Quellen für Rarität und Richtwert stehen in quellen.js (Suchlink, Regeln für eingefügten Text).
  // Hier nur der Direktlink, der das Apps Script fragt.
  const Quellen = window.Quellen;
  Quellen.toytales.direktLink = async (t) => {
    const a = await anfrage("toytales", { titel: t.titel, reihe: t.reihe, kollektion: t.kollektion, format: t.format, version: t.version }, { leise: true });
    return a.ok ? { url: a.url, sicher: a.sicher } : { url: "", sicher: false, fehler: a.fehler };
  };

  // Knopf "Bei ToyTales prüfen": gespeicherte Wert-Quelle → sicherer Direktlink → Suche.
  // Erst die Suche als Link, der Direktlink ersetzt sie, sobald er da ist (kein Warten beim Klick).
  function quelleKnopfHtml(t, gespeichert) {
    const q = Quellen.toytales;
    return `<div class="knopfreihe links quelle-knoepfe">
      <a class="knopf leise" data-quelle-link href="${esc(gespeichert || q.suchLink(t))}" target="_blank" rel="noopener noreferrer">Bei ${q.name} prüfen ↗</a>
      <a class="knopf leise" data-quelle-vermutung hidden target="_blank" rel="noopener noreferrer">Vermutete Seite ↗</a>
    </div>
    <p class="klein" data-quelle-hinweis>${gespeichert ? "Öffnet deine gespeicherte Wert-Quelle." : "Öffnet die Suche auf toytales.eu …"}</p>`;
  }
  async function quelleKnopfFuellen(wurzel, t, gespeichert) {
    if (gespeichert) return;
    const d = await Quellen.toytales.direktLink(t);
    const link = wurzel.querySelector("[data-quelle-link]");
    const hinweis = wurzel.querySelector("[data-quelle-hinweis]");
    if (!link) return;
    if (d.url && d.sicher) {
      link.href = d.url;
      hinweis.textContent = "Öffnet direkt die passende ToyTales-Seite.";
    } else if (d.url) {
      const v = wurzel.querySelector("[data-quelle-vermutung]");
      v.href = d.url;
      v.hidden = false;
      hinweis.textContent = "Keine eindeutige Seite gefunden: Suche öffnen oder die vermutete Seite prüfen.";
    } else {
      hinweis.textContent = d.fehler ? `${d.fehler} Der Knopf öffnet die Suche.` : "Keine passende Seite gefunden: Der Knopf öffnet die Suche.";
    }
  }

  function ergebnisZeigen(roh, versionWahl) {
    const t = Object.assign({}, roh);
    if (versionWahl) {
      // Alte Version gewählt, im Katalog steht aber die Neuauflage: deren Link gehört nicht zu deinem Exemplar.
      if (versionWahl === "Original" && istNeu(roh.version)) t.link = "";
      t.version = versionWahl;
    }
    const { genau, andere } = inDerListe(t);
    zustand.ergebnis = { t, genau };
    const werte = wertText(genau);
    const gespeicherteQuelle = genau && genau.wertQuelle ? genau.wertQuelle : "";
    $("bereich-ergebnis").innerHTML = `<div class="karte-flaeche ergebnis">
      <div class="vergleich">${deineFotos()}<div class="katalog-bild">${zoomBild(bildGross(t.eigenesFoto || t.bild, 600), t.titel)}</div></div>
      <p class="reihe">${esc([t.reihe, t.kollektion].filter(Boolean).join(" · "))}</p>
      <h2 class="titel">${esc(t.titel)}</h2>
      <div class="marken">${versionMarke(t.version)}</div>
      ${shopKnopf(t) ? `<div class="knopfreihe links">${shopKnopf(t)}</div>` : ""}
      <div class="ergebnis-block">
        <h3>Habe ich schon?</h3>
        <p>${genau ? `<strong>Ja:</strong> ${genau.behalten}× behalten · ${genau.verkaufen}× verkaufen · ${genau.verliehenAn || genau.verliehen === "ja" ? "verliehen" : "nicht verliehen"}`
          : "<strong>Nein</strong>, diese Version ist noch nicht in deiner Sammlung."}</p>
        ${andere.length ? `<p class="klein">Du hast auch: ${andere.map((x) => `${esc(versionText(x.version) || "ohne Versionsangabe")} (${anzahlText(x)})`).join(", ")}.</p>` : ""}
      </div>
      <div class="ergebnis-block">
        <h3>Rarität und Richtwert</h3>
        <p data-werte>${werte}</p>
        ${quelleKnopfHtml(t, gespeicherteQuelle)}
        <div class="knopfreihe links"><button type="button" class="knopf" data-aktion="wert-ergebnis">Wert ermitteln (ToyTales + Kleinanzeigen)</button></div>
        ${kopierhilfeHtml()}
      </div>
      <div class="knopfreihe">
        ${genau ? `<button type="button" class="knopf" data-ergebnis="erhoehen">Anzahl erhöhen</button>
          <button type="button" class="knopf leise" data-ergebnis="andere-version">Neuer Eintrag für andere Version</button>`
          : `<button type="button" class="knopf" data-ergebnis="hinzufuegen">Zur Sammlung hinzufügen</button>`}
      </div>
      <div class="knopfreihe">
        <button type="button" class="knopf leise" data-aktion="zur-sammlung">✕ Schließen</button>
        <button type="button" class="knopf leise" data-aktion="naechsten-erkennen">Nächsten suchen</button>
      </div>
    </div>`;
    titelSetzen(CHECK);
    zeige("bereich-ergebnis");
    quelleKnopfFuellen($("bereich-ergebnis"), t, gespeicherteQuelle);
  }

  $("bereich-ergebnis").addEventListener("click", (ev) => {
    const k = ev.target.closest("[data-ergebnis]");
    if (!k) return;
    const { t, genau } = zustand.ergebnis;
    formularOeffnen(k.dataset.ergebnis === "erhoehen" ? genau : t, null);
    if (k.dataset.ergebnis === "erhoehen") ergaenzenModus(genau);
    // Aus der Kopierhilfe übernommene Werte gleich ins Formular
    if (zustand.ergebnis.werte) werteInsFormular(zustand.ergebnis.werte);
    if (k.dataset.ergebnis === "andere-version") {
      zustand.andereVersion = true;
      $("f-version").value = "";
      $("f-version").focus();
      meldung("formular-meldung", "Neuer Eintrag: Bitte die Version deines Exemplars angeben.", "hinweis");
    }
    zustand.ausErkennen = true;
    versionFrage();
  });

  function weiterZeigen(text) {
    $("weiter-text").textContent = text;
    zeige("bereich-weiter");
    listeLaden();
  }

  // Nächster Tonie im zuletzt benutzten Weg: bei Foto gleich die Kamera öffnen (muss direkt im
  // Klick passieren, sonst blockiert der Browser), bei Name ins leere Suchfeld.
  function naechsteErkennung() {
    const weg = zustand.reiter || gemerkterReiter();
    zustand.fotos = [];
    zustand.beschreibung = null;
    zustand.ausErkennen = false;
    zustand.andereVersion = false;
    $("foto-hinweis").value = "";
    $("foto-sofort").hidden = true;
    fotoAnsichtAktualisieren();
    fotoErgebnisLeeren();
    if (weg === "suchen") {
      $("suchtext").value = "";
      trefferZeigen([], "treffer");
      $("nichts-gefunden").hidden = true;
      $("mehr-suchen").hidden = true;
      return reiter("suchen");
    }
    reiter("foto");
    $("foto-kamera").click();
  }

  function datumKurz(iso) {
    const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}.${m[2]}.${m[1].slice(2)}` : iso;
  }

  // ---------- Kopierhilfe: Werte von ToyTales selbst übernehmen ----------
  // Du kopierst Text (oder machst einen Screenshot) auf der ToyTales-Seite und fügst ihn hier ein.
  // Text wird kostenlos mit Regeln gelesen (quellen.js), ein Screenshot mit einer kleinen Claude-Abfrage.
  function wertText(e) {
    if (!e || !(e.raritaet || e.richtwert || e.richtwertOvp || e.wertStand)) return `<span class="klein">Noch nicht geprüft.</span>`;
    const teile = [e.raritaet && e.raritaet !== "Normal" ? "★ " + esc(e.raritaet) : "Rarität: Normal"];
    if (e.richtwert) teile.push(`gebraucht ${esc(e.richtwert)} €`);
    if (e.richtwertOvp) teile.push(`OVP ${esc(e.richtwertOvp)} €`);
    return teile.join(" · ") + (e.wertStand ? ` <span class="klein">(von dir übernommen am ${esc(datumKurz(e.wertStand))})</span>`
      : ` <span class="klein">(noch nicht geprüft)</span>`) + (/toytales\.eu/.test(e.wertQuelle || "") ? quellenAngabe(e.wertQuelle) : "");
  }

  function kopierhilfeHtml() {
    return `<div class="kopierhilfe" data-kopierhilfe>
      <label>Text oder Screenshot von ToyTales einfügen</label>
      <textarea data-kh-text rows="3" placeholder="Auf der ToyTales-Seite alles markieren (Cmd+A), kopieren und hier einfügen"></textarea>
      <div class="knopfreihe links">
        <button type="button" class="knopf leise" data-kh="einfuegen"><span aria-hidden="true">📋</span>Einfügen</button>
        <label class="knopf leise"><span aria-hidden="true">🖼</span>Screenshot<input type="file" accept="image/*" data-kh-bild hidden></label>
      </div>
      <p class="klein" data-kh-meldung hidden></p>
      <div class="kh-ergebnis" data-kh-ergebnis hidden></div>
    </div>`;
  }
  // Kopierhilfe auch im Formular (Hinzufügen, Verwalten)
  $("form-kopierhilfe").innerHTML = kopierhilfeHtml();

  // Gehört die eingefügte Seite zu diesem Tonie? (grober Wortvergleich, nur als Hinweis)
  function passtZumTonie(befundTitel, t) {
    if (!befundTitel || !t || !t.titel) return true;
    // Füllwörter ("der", "und" …) zählen nicht, sonst passt "Der Grüffelo" zu "In der Weihnachtsbäckerei"
    const fuell = ["der", "die", "das", "und", "mit", "von", "den", "dem", "des", "ein", "eine", "the", "and", "weitere", "tonie"];
    const w = (x) => vereinfachen(x).split(/[^a-z0-9]+/).filter((y) => y.length > 2 && fuell.indexOf(y) < 0);
    const b = w(befundTitel);
    return w(t.titel).some((x) => b.indexOf(x) >= 0);
  }

  function befundZeigen(box, befund, t) {
    const erg = box.querySelector("[data-kh-ergebnis]");
    if (!befund.erkannt) {
      erg.hidden = true;
      return khMeldung(box, "In diesem Text habe ich keine Werte gefunden. Bitte die ganze ToyTales-Seite kopieren (Cmd+A, Cmd+C).");
    }
    khMeldung(box, "");
    box.befund = befund;
    const opt = (w, aktiv) => `<option${w === aktiv ? " selected" : ""}>${w}</option>`;
    erg.hidden = false;
    erg.innerHTML = `<p><strong>${befund.vorlage ? "Werte" : "Erkannt – bitte prüfen"}</strong></p>
      ${passtZumTonie(befund.titel, t) ? "" : `<p class="klein warnung-text">Die Seite gehört zu „${esc(befund.titel)}“. Passt das zu „${esc(t.titel)}“?</p>`}
      ${befund.version && t && t.version && vereinfachen(befund.version) !== vereinfachen(t.version)
        ? `<p class="klein warnung-text">Die Seite ist die ${esc(befund.version)}, gewählt ist ${esc(versionText(t.version))}.</p>` : ""}
      <div class="zweispaltig">
        <div><label>Rarität</label><select data-kh-feld="raritaet">${["Normal", "Selten", "Rarität", "Munkelität"].map((w) => opt(w, befund.raritaet || "Normal")).join("")}</select></div>
        <div><label>Richtwert gebraucht (€)</label><input data-kh-feld="richtwert" inputmode="decimal" value="${esc(befund.gebraucht)}"></div>
        <div><label>Richtwert OVP (€)</label><input data-kh-feld="richtwertOvp" inputmode="decimal" value="${esc(befund.ovp)}"></div>
        <div><label>Wert-Quelle</label><input data-kh-feld="wertQuelle" type="url" value="${esc(befund.quelle)}" placeholder="https://toytales.eu/wiki/…"></div>
      </div>
      <details class="klein"><summary>Woher die Zahlen kommen</summary><ul>${befund.belege.map((b) => `<li>${esc(b)}</li>`).join("")}</ul></details>
      ${befund.quelle && /toytales\.eu/.test(befund.quelle) ? quellenAngabe(befund.quelle) : ""}
      <div class="knopfreihe links">
        <button type="button" class="knopf" data-kh="uebernehmen">Übernehmen</button>
        <button type="button" class="knopf leise" data-kh="verwerfen">Verwerfen</button>
      </div>`;
  }
  function khMeldung(box, text, art) {
    const m = box.querySelector("[data-kh-meldung]");
    m.hidden = !text;
    m.textContent = text || "";
    m.dataset.art = art || "hinweis";
  }
  // Zu welchem Tonie gehört die Kopierhilfe gerade? Ergebnisansicht oder Formular
  function khTonie(box) {
    if (box.closest("#bereich-wert")) return zustand.wert.t;
    return box.closest("#bereich-ergebnis") ? zustand.ergebnis.t : formularWerte();
  }
  function khText(box) {
    befundZeigen(box, Quellen.toytales.textLesen(box.querySelector("[data-kh-text]").value), khTonie(box));
  }

  function werteInsFormular(w) {
    if (w.raritaet !== undefined) $("f-raritaet").value = w.raritaet === "Normal" ? "" : w.raritaet;
    ["richtwert", "richtwertOvp", "wertQuelle", "wertStand"].forEach((f) => { if (w[f] !== undefined) $("f-" + f).value = w[f]; });
    // Selbst festgelegter Preis aus dem Wert-Assistenten: steht schon drin, wenn du „Verkaufen“ anhakst
    if (w.preis) $("f-preis").value = w.preis;
    quelleKnopf();
  }

  async function khUebernehmen(box) {
    const feld = (f) => box.querySelector(`[data-kh-feld="${f}"]`).value.trim();
    const w = { raritaet: feld("raritaet"), richtwert: feld("richtwert"), richtwertOvp: feld("richtwertOvp"),
      wertQuelle: feld("wertQuelle"), wertStand: heuteBerlin() };
    if (box.closest("#bereich-wert")) return wertToytalesSetzen({ raritaet: w.raritaet, gebraucht: w.richtwert, ovp: w.richtwertOvp,
      quelle: w.wertQuelle, belege: (box.befund && box.befund.belege) || [], von: "eingefügt" });
    const imErgebnis = !!box.closest("#bereich-ergebnis");
    if (!imErgebnis) {
      werteInsFormular(w);
      box.querySelector("[data-kh-ergebnis]").hidden = true;
      return khMeldung(box, "Übernommen – bitte unten speichern.", "ok");
    }
    const { genau } = zustand.ergebnis;
    if (!genau) {
      // Noch nicht in der Sammlung: Werte merken, sie landen beim Hinzufügen im Formular
      zustand.ergebnis.werte = w;
      box.querySelector("[data-kh-ergebnis]").hidden = true;
      $("bereich-ergebnis").querySelector("[data-werte]").innerHTML = wertText(w) + ` <span class="klein">– wird beim Hinzufügen gespeichert</span>`;
      return khMeldung(box, "Übernommen. Gespeichert wird beim „Zur Sammlung hinzufügen“.", "ok");
    }
    // Schon in der Sammlung: direkt im Eintrag speichern (alle Felder mitschicken, sonst würden sie geleert)
    const felder = Object.assign({}, genau, w);
    delete felder.pruefen;
    const a = await anfrage("aendern", { id: genau.id, stand: genau.geaendertAm, felder });
    if (!a.ok) return khMeldung(box, a.code === "konflikt" ? "Dieser Tonie wurde inzwischen geändert. Bitte die Seite neu laden." : a.fehler, "fehler");
    Object.assign(genau, a.eintrag);
    box.querySelector("[data-kh-ergebnis]").hidden = true;
    box.querySelector("[data-kh-text]").value = "";
    $("bereich-ergebnis").querySelector("[data-werte]").innerHTML = wertText(genau);
    khMeldung(box, "Gespeichert.", "ok");
  }

  let khTimer;
  document.addEventListener("input", (ev) => {
    const ta = ev.target.closest("[data-kh-text]");
    if (!ta) return;
    clearTimeout(khTimer);
    khTimer = setTimeout(() => khText(ta.closest("[data-kopierhilfe]")), 300);
  });
  document.addEventListener("click", async (ev) => {
    const k = ev.target.closest("[data-kh]");
    if (!k) return;
    const box = k.closest("[data-kopierhilfe]");
    if (k.dataset.kh === "einfuegen") {
      try {
        box.querySelector("[data-kh-text]").value = await navigator.clipboard.readText();
        khText(box);
      } catch (x) {
        khMeldung(box, "Einfügen geht hier nicht direkt: bitte ins Feld tippen, lange drücken und „Einfügen“ wählen.");
        box.querySelector("[data-kh-text]").focus();
      }
    }
    if (k.dataset.kh === "verwerfen") { box.querySelector("[data-kh-ergebnis]").hidden = true; box.querySelector("[data-kh-text]").value = ""; }
    if (k.dataset.kh === "uebernehmen") khUebernehmen(box);

  });
  document.addEventListener("change", async (ev) => {
    const inp = ev.target.closest("[data-kh-bild]");
    if (!inp || !inp.files[0]) return;
    const box = inp.closest("[data-kopierhilfe]");
    khMeldung(box, "Screenshot wird ausgewertet …");
    try {
      // 1600 px: Zahlen und Schrift bleiben lesbar
      const bild = await fotoVerkleinern(inp.files[0], 1600);
      const a = await anfrage("wertbild", { bild });
      budgetZeigen(a.budget);
      if (!a.ok) return khMeldung(box, a.fehler, "fehler");
      const befund = Quellen.toytales.ausBild(a.werte);
      befund.quelle = a.werte.adresse || "";
      befundZeigen(box, befund, khTonie(box));
    } catch (x) {
      khMeldung(box, "Dieses Bild ließ sich nicht lesen.", "fehler");
    } finally {
      inp.value = "";
    }
  });

  // Letzte Preisprüfungen (privat, nur mit Passwort) in "Tonie verwalten"
  async function preisHistorie(e) {
    if (!zustand.zugang || !e.id) return;
    const a = await anfrage("preispruefungen", { id: e.id }, { leise: true, ohneSperre: true });
    if (!a.ok || !a.zeilen.length || !zustand.eintrag || zustand.eintrag.id !== e.id) return;
    const tage = {};
    a.zeilen.forEach((z) => { (tage[z.datum] = tage[z.datum] || []).push(z); });
    $("preis-historie").innerHTML = "<strong>Letzte Preisprüfungen</strong><ul>" + Object.keys(tage).slice(0, 5).map((d) => {
      const auf = tage[d].filter((z) => z.aufgenommen).map((z) => z.preis);
      const s = Quellen.statistik(auf);
      return `<li>${esc(datumKurz(d))}: ${tage[d].length} Anzeigen, ${auf.length} aufgenommen${s.anzahl ? ` · Median ${euroText(s.median)}` : ""}</li>`;
    }).join("") + "</ul>";
    $("preis-historie").hidden = false;
  }

  // ---------- Wert ermitteln: ein Bildschirm, zwei Quellen (ToyTales und Kleinanzeigen) ----------
  // ToyTales: Einzelabruf für genau diesen Tonie (wenn Zugang eingetragen), sonst Kopierhilfe.
  // Kleinanzeigen: nur Suchlink; ausgewertet werden ausschließlich deine Screenshots oder dein Text.
  // Am Ende stehen ein Richtwert gebraucht und ein Richtwert OVP, beide überschreibbar.
  const MAX_ANZEIGEN_BILDER = 8;
  zustand.wert = null;

  const quellenAngabe = (url) => /^https:\/\/toytales\.eu\//.test(url || "")
    ? `<p class="klein quelle-angabe">Quelle: <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">ToyTales.eu ↗</a></p>` : "";
  const euroText = (n) => Number.isFinite(n) ? n.toLocaleString("de-DE", { maximumFractionDigits: 2 }) + " €" : "–";

  async function wertAssistent(t, herkunft) {
    zustand.wert = { t, herkunft, tt: null, link: t.wertQuelle && /toytales\.eu\/wiki\//.test(t.wertQuelle) ? t.wertQuelle : "",
      kandidaten: [], anzeigen: [], ohneVersand: 0, bilder: [], status: null, geaendert: {}, preis: "" };
    titelSetzen("Wert ermitteln");
    wertZeichnen();
    zeige("bereich-wert");
    const [st, link] = await Promise.all([
      anfrage("wertstatus", {}, { leise: true }),
      zustand.wert.link ? Promise.resolve(null) : anfrage("toytales", { titel: t.titel, reihe: t.reihe, kollektion: t.kollektion, format: t.format, version: t.version }, { leise: true }),
    ]);
    if (!zustand.wert || zustand.wert.t !== t) return;
    zustand.wert.status = st.ok ? st.status : null;
    if (link && link.ok) {
      if (link.sicher) zustand.wert.link = link.url;
      else zustand.wert.kandidaten = link.kandidaten || [];
    }
    wertZeichnen();
  }

  function wertToytalesSetzen(tt) {
    zustand.wert.tt = tt;
    if (tt.quelle && /toytales\.eu\/wiki\//.test(tt.quelle)) zustand.wert.link = tt.quelle;
    wertZeichnen();
  }

  // Anzeigen-Tabelle → Statistik je Zustand (nur aufgenommene, nur mit Versand – die anderen kommen gar nicht an)
  function anzeigenStatistik() {
    const auf = zustand.wert.anzeigen.filter((a) => a.aufnehmen && a.art !== "verkauft");
    const ovp = auf.filter((a) => Quellen.istOvpZustand(a.zustand)).map((a) => a.preis);
    const gebr = auf.filter((a) => !Quellen.istOvpZustand(a.zustand)).map((a) => a.preis);
    const verkauft = zustand.wert.anzeigen.filter((a) => a.aufnehmen && a.art === "verkauft").map((a) => a.preis);
    return { gebraucht: Quellen.statistik(gebr), ovp: Quellen.statistik(ovp), verkauft: Quellen.statistik(verkauft), alle: Quellen.statistik(auf.map((a) => a.preis)) };
  }

  function wertVorschlag() {
    const w = zustand.wert, st = anzeigenStatistik();
    return {
      raritaet: (w.tt && w.tt.raritaet) || w.t.raritaet || "Normal",
      richtwert: Quellen.vorschlag(w.tt && w.tt.gebraucht, st.gebraucht.median),
      richtwertOvp: Quellen.vorschlag(w.tt && w.tt.ovp, st.ovp.median),
      wertQuelle: w.link || (w.anzeigen.some((a) => a.aufnehmen) ? "Kleinanzeigen" : "eigene Eingabe"),
    };
  }

  function statistikHtml(name, s) {
    if (!s.anzahl) return `<p class="klein">${name}: keine Werte.</p>`;
    return `<p class="klein"><strong>${name}:</strong> ${s.anzahl} Anzeige${s.anzahl === 1 ? "" : "n"} · Median ${euroText(s.median)} ·
      ${euroText(s.min)} bis ${euroText(s.max)} · Spanne ${esc(s.spanne)} €</p>`;
  }

  function wertZeichnen() {
    const w = zustand.wert;
    if (!w) return;
    const t = w.t, st = w.status, vor = wertVorschlag(), a = anzeigenStatistik();
    const frisch = t.wertStand && st && (Date.now() - new Date(t.wertStand + "T12:00:00")) / 86400000 < st.gueltigTage;
    const passend = w.anzeigen.filter((x) => x.passt === "ja").length;
    const nein = w.anzeigen.filter((x) => x.passt === "nein").length;
    const feld = (f, label, privat) => `<div${privat ? ' class="privat"' : ""}><label>${label}</label>
      <input data-wert-feld="${f}" inputmode="${f === "wertQuelle" ? "text" : "decimal"}" value="${esc(w.geaendert[f] !== undefined ? w.geaendert[f] : vor[f])}"></div>`;
    const ttTeil = w.tt
      ? `<div class="wert-befund">
          <p><strong>${w.tt.von === "abgerufen" ? "Von ToyTales abgerufen" : "Von ToyTales eingefügt"}</strong></p>
          <p>Rarität: ${esc(w.tt.raritaet || "–")} · gebraucht ${esc(w.tt.gebraucht || "–")} € · OVP ${esc(w.tt.ovp || "–")} €</p>
          ${quellenAngabe(w.link)}
          <details class="klein"><summary>Woher die Zahlen kommen</summary><ul>${(w.tt.belege || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul></details>
        </div>` : "";
    const linkTeil = w.link
      ? `<div class="knopfreihe links"><a class="knopf leise" href="${esc(w.link)}" target="_blank" rel="noopener noreferrer">ToyTales öffnen ↗</a>
          ${st && st.auto && st.zugang ? (frisch && !w.neu
            ? `<button type="button" class="knopf" data-wert="neu-frage">Trotzdem neu laden</button>`
            : `<button type="button" class="knopf" data-wert="abrufen">Wert ermitteln (ToyTales)</button>`) : ""}</div>
        ${frisch ? `<p class="klein">Gespeichert am ${esc(datumKurz(t.wertStand))}: ${wertText(t)}. Neu abgerufen wird frühestens nach ${st.gueltigTage} Tagen.</p>` : ""}
        <div data-wert-warnung hidden class="vorhanden"><p>ToyTales bittet, den Server nicht unnötig zu belasten. Der Wert ist erst ${Math.round((Date.now() - new Date(t.wertStand + "T12:00:00")) / 86400000)} Tage alt. Trotzdem neu laden?</p>
          <div class="knopfreihe"><button type="button" class="knopf leise" data-wert="neu-nein">Nein</button><button type="button" class="knopf" data-wert="neu-ja">Ja, neu laden</button></div></div>`
      : w.kandidaten.length
        ? `<p class="klein">Keine eindeutige Seite. Welche ist deine Version?</p>
           <div class="knopfreihe links">${w.kandidaten.map((k, i) => `<button type="button" class="knopf leise" data-wert="kandidat" data-i="${i}">${esc(versionText(k.version))} · ${esc(k.url.replace("https://toytales.eu/wiki/", ""))}</button>`).join("")}</div>`
        : `<div class="knopfreihe links"><a class="knopf leise" href="${esc(Quellen.toytales.suchLink(t))}" target="_blank" rel="noopener noreferrer">Auf ToyTales suchen ↗</a></div>`;
    const zeilen = w.anzeigen.map((x, i) => `<tr class="${x.aufnehmen ? "" : "aus"}">
        <td>${x.bild || "–"}</td><td>${esc(x.titel)}${x.grund && x.passt !== "ja" ? `<br><span class="klein">${esc(x.grund)}</span>` : ""}</td>
        <td><input data-anz="preis" data-i="${i}" inputmode="decimal" value="${esc(String(x.preis).replace(".", ","))}" aria-label="Preis"></td>
        <td>${x.art === "verkauft" ? "verkauft" : "Angebot"}</td><td>${esc(x.passt)}</td><td>${esc(x.zustand || "–")}</td>
        <td><input type="checkbox" data-anz="auf" data-i="${i}"${x.aufnehmen ? " checked" : ""} aria-label="aufnehmen"></td>
        <td><button type="button" class="foto-weg klein-weg" data-anz="weg" data-i="${i}" aria-label="Zeile löschen">×</button></td></tr>`).join("");
    $("bereich-wert").innerHTML = `<div class="karte-flaeche wert">
      ${w.herkunft === "pruefen" ? pruefFortschritt() : ""}
      <div class="pruefen-kopf">
        <div class="katalog-bild">${zoomBild(bildGross(t.eigenesFoto || t.bild, 400), t.titel)}</div>
        <div><p class="reihe">${esc([t.reihe, t.kollektion].filter(Boolean).join(" · "))}</p><h2 class="titel">${esc(t.titel)}</h2>
          <div class="marken">${t.version ? versionMarke(t.version) : ""}</div></div>
      </div>

      <h3>1. ToyTales: Rarität und Richtwert</h3>
      ${linkTeil}
      <p class="meldung" data-wert-meldung="tt" hidden></p>
      ${ttTeil}
      <details class="kh-umschlag"${w.tt ? "" : " open"}><summary>Text oder Screenshot von ToyTales einfügen</summary>${kopierhilfeHtml()}</details>

      <h3>2. Kleinanzeigen: Angebote</h3>
      <div class="knopfreihe links"><a class="knopf leise" href="${esc(Quellen.kleinanzeigen.suchLink(t))}" target="_blank" rel="noopener noreferrer">Bei Kleinanzeigen suchen ↗</a></div>
      ${Quellen.kleinanzeigen.versandImLink ? "" : `<p class="klein">Bitte dort den Filter <strong>„Versand möglich“</strong> anklicken, dann Screenshots der Liste machen.</p>`}
      <div class="anzeigen-eingabe" data-ablage>
        <label class="knopf leise">Screenshots wählen<input type="file" accept="image/*" multiple data-anz-bilder hidden></label>
        <span class="klein">bis ${MAX_ANZEIGEN_BILDER} pro Durchgang · hierher ziehen geht auch</span>
        <ul class="foto-vorschau">${w.bilder.map((b, i) => `<li><img src="${b}" alt="Screenshot ${i + 1}"><button type="button" class="foto-weg" data-anz="bild-weg" data-i="${i}" aria-label="Screenshot ${i + 1} entfernen">×</button></li>`).join("")}</ul>
        <textarea data-anz-text rows="2" placeholder="… oder Text der Anzeigenliste einfügen"></textarea>
        <div class="knopfreihe links"><button type="button" class="knopf" data-wert="anzeigen">${w.anzeigen.length ? "Mehr Anzeigen hinzufügen" : "Anzeigen auswerten"}</button>
          <span class="klein">ca. 0,3–0,8 Cent${st ? ` · Budget: ${(st.budget.verbrauchtUsd * 100).toFixed(2).replace(".", ",")} Cent von ${st.budget.budgetUsd} $` : ""}</span></div>
      </div>
      <p class="meldung" data-wert-meldung="anz" hidden></p>
      ${w.anzeigen.length || w.ohneVersand ? `<p class="klein"><strong>${passend} passende Anzeigen mit Versand</strong>, Ziel mindestens 8${w.ohneVersand ? ` · ${w.ohneVersand} Anzeigen ohne Versand ausgeblendet` : ""}</p>` : ""}
      ${w.anzeigen.length && (passend < 5 || nein > w.anzeigen.length / 2)
        ? `<p class="klein warnung-text">Noch zu wenig passende Anzeigen. Tipp: Seite 2 öffnen oder weiter nach unten scrollen, Screenshot machen und „Mehr Anzeigen hinzufügen“.</p>` : ""}
      ${w.anzeigen.length ? `<div class="tabelle-rahmen"><table class="anzeigen"><thead><tr><th>Bild</th><th>Titel</th><th>Preis €</th><th>Art</th><th>Passt</th><th>Zustand</th><th>auf&shy;nehmen</th><th></th></tr></thead>
        <tbody>${zeilen}</tbody></table></div>` : ""}
      <button type="button" class="knopf leise" data-wert="zeile">+ Eigene Zeile</button>
      ${w.anzeigen.length ? `<div class="wert-statistik">
        <p class="klein warnung-text">Das sind Angebotspreise, keine bezahlten Preise. Tatsächlich erzielte Preise liegen meist darunter.</p>
        ${statistikHtml("Gebraucht", a.gebraucht)}${statistikHtml("OVP/neu", a.ovp)}
        ${a.verkauft.anzahl ? statistikHtml("Als verkauft markiert", a.verkauft) : ""}
        ${a.alle.anzahl < 3 ? `<p class="klein warnung-text">Zu wenig Daten, Ergebnis unsicher.</p>` : ""}
      </div>` : ""}

      <h3>3. Ergebnis</h3>
      <div class="zweispaltig">
        <div><label>Rarität</label><select data-wert-feld="raritaet">${["Normal", "Selten", "Rarität", "Munkelität"].map((r) =>
          `<option${r === (w.geaendert.raritaet !== undefined ? w.geaendert.raritaet : vor.raritaet) ? " selected" : ""}>${r}</option>`).join("")}</select></div>
        ${feld("wertQuelle", "Wert-Quelle")}
        ${feld("richtwert", "Richtwert gebraucht (€)", true)}
        ${feld("richtwertOvp", "Richtwert OVP (€)", true)}
      </div>
      <div class="preis-zeile privat"><label>Preis (€, dein Verkaufspreis)</label>
        <input data-wert-feld="preis" inputmode="decimal" value="${esc(w.geaendert.preis !== undefined ? w.geaendert.preis : (t.preis !== null && t.preis !== undefined && t.preis !== "" ? preisText(t.preis) : ""))}">
        <button type="button" class="knopf leise klein-knopf" data-wert="preis">Richtwert als Preis übernehmen</button></div>
      <p class="meldung" data-wert-meldung="speichern" hidden></p>
      <div class="knopfreihe">
        ${w.herkunft === "pruefen" ? `<button type="button" class="knopf leise" data-wert="ueberspringen">Überspringen</button>`
          : `<button type="button" class="knopf leise" data-wert="zurueck">Zurück</button>`}
        <button type="button" class="knopf" data-wert="speichern">${w.herkunft === "pruefen" ? "Speichern und weiter" : "Speichern"}</button>
      </div>
    </div>`;
  }

  function wertMeldung(wo, text, art) {
    const m = $("bereich-wert").querySelector(`[data-wert-meldung="${wo}"]`);
    if (!m) return;
    m.hidden = !text; m.textContent = text || ""; m.dataset.art = art || "fehler";
  }

  async function toytalesAbrufen(neuLaden) {
    const w = zustand.wert;
    wertMeldung("tt", "Frage ToyTales für genau diesen Tonie …", "hinweis");
    const a = await anfrage("toytaleswert", { id: w.t.id || "", url: w.link, neuLaden: !!neuLaden });
    if (a.status) w.status = a.status;
    if (!a.ok) { wertZeichnen(); return wertMeldung("tt", a.fehler + (a.status ? ` (${a.status.heute} von ${a.status.tageslimit} Abrufen heute)` : "")); }
    if (a.gespeichert) { wertZeichnen(); return wertMeldung("tt", "Gespeicherter Wert ist noch aktuell – kein neuer Abruf nötig.", "hinweis"); }
    // Roboter-Browser liefert den sichtbaren Seitentext → dieselben Regeln wie die Kopierhilfe; die Schnittstelle liefert fertige Werte
    const b = a.text ? Quellen.toytales.textLesen(a.text) : Quellen.toytales.ausBild(a.werte);
    if (!b.erkannt) { wertZeichnen(); return wertMeldung("tt", "Seite geöffnet, aber keine Werte gefunden. Bitte „ToyTales öffnen“ und den Text in die Kopierhilfe einfügen."); }
    wertToytalesSetzen({ raritaet: b.raritaet, gebraucht: b.gebraucht, ovp: b.ovp, quelle: a.link, belege: b.belege, von: "abgerufen" });
    wertMeldung("tt", `Abgerufen (${a.status.heute} von ${a.status.tageslimit} heute).`, "ok");
  }

  async function anzeigenAuswerten() {
    const w = zustand.wert, box = $("bereich-wert");
    const text = box.querySelector("[data-anz-text]").value.trim();
    if (!w.bilder.length && !text) return wertMeldung("anz", "Bitte Screenshots wählen oder Text einfügen.");
    wertMeldung("anz", "Anzeigen werden ausgewertet …", "hinweis");
    const a = await anfrage("anzeigen", { bilder: w.bilder, text, titel: w.t.titel, reihe: w.t.reihe, version: w.t.version });
    budgetZeigen(a.budget);
    if (!a.ok) return wertMeldung("anz", a.fehler);
    // Doppelte (gleicher Titel und Preis) nur einmal
    const schluessel = (x) => vereinfachen(x.titel).replace(/[^a-z0-9]/g, "") + "|" + x.preis;
    const vorhanden = new Set(w.anzeigen.map(schluessel));
    let neu = 0, doppelt = 0;
    a.anzeigen.forEach((x) => {
      if (vorhanden.has(schluessel(x))) { doppelt++; return; }
      vorhanden.add(schluessel(x));
      w.anzeigen.push(Object.assign({}, x, { aufnehmen: x.passt === "ja", plattform: "Kleinanzeigen" }));
      neu++;
    });
    w.ohneVersand += a.ohneVersand || 0;
    w.bilder = [];
    wertZeichnen();
    wertMeldung("anz", a.nichts && !neu ? "Nichts erkannt: In diesem Material habe ich keine verwertbaren Anzeigen mit Versand gefunden."
      : `${neu} neue Anzeige${neu === 1 ? "" : "n"}${doppelt ? `, ${doppelt} doppelt (nur einmal gezählt)` : ""}.`, neu ? "ok" : "hinweis");
  }

  async function anzeigenBilderDazu(dateien) {
    const w = zustand.wert;
    for (const d of Array.from(dateien)) {
      if (!/^image\//.test(d.type)) continue;
      if (w.bilder.length >= MAX_ANZEIGEN_BILDER) { wertMeldung("anz", `Höchstens ${MAX_ANZEIGEN_BILDER} Screenshots pro Durchgang.`, "hinweis"); break; }
      try { w.bilder.push(await fotoVerkleinern(d, 1600)); } catch (x) { wertMeldung("anz", "Ein Bild ließ sich nicht lesen."); }
    }
    wertZeichnen();
  }

  async function wertSpeichern() {
    const w = zustand.wert, box = $("bereich-wert");
    const f = (n) => { const e = box.querySelector(`[data-wert-feld="${n}"]`); return e ? e.value.trim() : ""; };
    const werte = { raritaet: f("raritaet"), richtwert: f("richtwert"), richtwertOvp: f("richtwertOvp"), wertQuelle: f("wertQuelle"),
      wertStand: heuteBerlin(), version: w.t.version || "" };
    if (f("preis")) werte.preis = f("preis");
    const zeilen = w.anzeigen.map((x) => ({ plattform: "Kleinanzeigen", titel: x.titel, preis: x.preis, art: x.art, passt: x.passt, aufgenommen: x.aufnehmen }));
    // Noch nicht in der Sammlung (aus dem Tonie-Check): Werte für "Zur Sammlung hinzufügen" merken
    if (!w.t.id) {
      zustand.ergebnis.werte = werte;
      zeige("bereich-ergebnis");
      $("bereich-ergebnis").querySelector("[data-werte]").innerHTML = wertText(werte) + ` <span class="klein">– wird beim Hinzufügen gespeichert</span>`;
      return;
    }
    const felder = Object.assign({}, w.t, werte);
    delete felder.pruefen;
    const a = await anfrage("aendern", { id: w.t.id, stand: w.t.geaendertAm, felder });
    if (!a.ok) return wertMeldung("speichern", a.code === "konflikt" ? "Dieser Tonie wurde inzwischen geändert. Bitte neu laden." : a.fehler);
    Object.assign(w.t, a.eintrag);
    if (zeilen.length) await anfrage("preispruefung", { id: w.t.id, zeilen }, { leise: true });
    if (w.herkunft === "pruefen") return pruefenWeiter(true);
    zurueckZurSammlung(`„${w.t.titel}“: Wert gespeichert`);
  }

  // Eingaben in der Tabelle: sofort neu rechnen
  $("bereich-wert").addEventListener("input", (ev) => {
    const w = zustand.wert;
    const e = ev.target;
    if (e.dataset.wertFeld) { w.geaendert[e.dataset.wertFeld] = e.value; return; }
    if (e.dataset.anz === "preis") {
      const n = parseFloat(e.value.replace(",", "."));
      if (Number.isFinite(n) && n > 0) { w.anzeigen[+e.dataset.i].preis = n; clearTimeout(w.timer); w.timer = setTimeout(wertNeuRechnen, 400); }
    }
  });
  $("bereich-wert").addEventListener("change", (ev) => {
    const e = ev.target, w = zustand.wert;
    if (e.dataset.anz === "auf") { w.anzeigen[+e.dataset.i].aufnehmen = e.checked; wertNeuRechnen(); }
    if (e.dataset.wertFeld) w.geaendert[e.dataset.wertFeld] = e.value;
    if (e.matches("[data-anz-bilder]")) { anzeigenBilderDazu(e.files); e.value = ""; }
  });
  // Neu rechnen, ohne dass der Cursor im gerade bearbeiteten Feld verloren geht
  function wertNeuRechnen() {
    const fokus = document.activeElement;
    const merk = fokus && fokus.dataset && fokus.dataset.anz === "preis" ? { i: fokus.dataset.i, pos: fokus.selectionStart } : null;
    wertZeichnen();
    if (merk) {
      const e = $("bereich-wert").querySelector(`[data-anz="preis"][data-i="${merk.i}"]`);
      if (e) { e.focus(); try { e.setSelectionRange(merk.pos, merk.pos); } catch (x) {} }
    }
  }
  $("bereich-wert").addEventListener("dragover", (ev) => { if (ev.target.closest("[data-ablage]")) ev.preventDefault(); });
  $("bereich-wert").addEventListener("drop", (ev) => {
    if (!ev.target.closest("[data-ablage]")) return;
    ev.preventDefault();
    anzeigenBilderDazu(ev.dataTransfer.files);
  });
  $("bereich-wert").addEventListener("click", (ev) => {
    const k = ev.target.closest("[data-wert], [data-anz]");
    if (!k) return;
    const w = zustand.wert, box = $("bereich-wert");
    const was = k.dataset.wert || k.dataset.anz;
    if (was === "abrufen") toytalesAbrufen(false);
    if (was === "neu-frage") box.querySelector("[data-wert-warnung]").hidden = false;
    if (was === "neu-nein") box.querySelector("[data-wert-warnung]").hidden = true;
    if (was === "neu-ja") { w.neu = true; toytalesAbrufen(true); }
    if (was === "kandidat") { w.link = w.kandidaten[+k.dataset.i].url; w.kandidaten = []; wertZeichnen(); }
    if (was === "anzeigen") anzeigenAuswerten();
    if (was === "bild-weg") { w.bilder.splice(+k.dataset.i, 1); wertZeichnen(); }
    if (was === "weg") { w.anzeigen.splice(+k.dataset.i, 1); wertNeuRechnen(); }
    if (was === "zeile") { w.anzeigen.push({ bild: 0, titel: "eigene Eingabe", preis: 0, art: "angebot", passt: "ja", zustand: "", aufnehmen: true }); wertZeichnen(); }
    if (was === "preis") {
      // Dein Exemplar neu/OVP? Dann der OVP-Wert, sonst gebraucht; aus einer Spanne die Mitte
      const quelle = /ovp|neu/i.test(w.t.zustand || "") ? box.querySelector('[data-wert-feld="richtwertOvp"]').value : box.querySelector('[data-wert-feld="richtwert"]').value;
      const z = (quelle.replace(/,/g, ".").match(/\d+(?:\.\d+)?/g) || []).map(Number);
      if (z.length) { const p = Math.round((z.reduce((s, n) => s + n, 0) / z.length) * 2) / 2; box.querySelector('[data-wert-feld="preis"]').value = String(p).replace(".", ","); w.geaendert.preis = String(p).replace(".", ","); }
    }
    if (was === "speichern") wertSpeichern();
    if (was === "zurueck") { if (w.herkunft === "ergebnis") zeige("bereich-ergebnis"); else if (w.herkunft === "verwalten") { zeige("bereich-formular"); titelSetzen("Tonie verwalten"); } }
    if (was === "ueberspringen") pruefenWeiter(false);
  });

  // ---------- Sammlung prüfen: in Portionen, in der Reihenfolge der Übersicht ----------
  // Nur Tonies ohne Wert-Stand oder mit Wert-Stand älter als WERT_GUELTIG_TAGE. Höchstens 10 pro Durchgang.
  const PORTION = 10;
  const sitzungLesen = (k, std) => { try { return JSON.parse(sessionStorage.getItem(k)) || std; } catch (x) { return std; } };
  const sitzungSchreiben = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (x) {} };

  function pruefOffen() {
    const tage = (zustand.wert && zustand.wert.status && zustand.wert.status.gueltigTage) || zustand.gueltigTage || 30;
    const reihenfolge = sitzungLesen("tonie-pruefen-reihenfolge", null);
    const weg = sitzungLesen("tonie-pruefen-uebersprungen", []);
    let liste = zustand.liste.slice();
    if (reihenfolge && reihenfolge.length) {
      const pos = {}; reihenfolge.forEach((id, i) => { pos[id] = i; });
      liste = liste.filter((t) => t.id in pos).sort((a, b) => pos[a.id] - pos[b.id]);
    } else {
      liste.sort((a, b) => a.reihe.localeCompare(b.reihe, "de") || a.titel.localeCompare(b.titel, "de"));
    }
    const faellig = (t) => !t.wertStand || (Date.now() - new Date(t.wertStand + "T12:00:00")) / 86400000 >= tage;
    return { gesamt: liste.length, offen: liste.filter((t) => faellig(t) && weg.indexOf(t.id) < 0), faellig: liste.filter(faellig).length, weg };
  }

  function pruefFortschritt() {
    const o = pruefOffen(), d = sitzungLesen("tonie-pruefen-durchgang", 0);
    const fertig = o.gesamt - o.faellig;
    return `<p class="fortschritt-text"><strong>${fertig} von ${o.gesamt} geprüft</strong> · noch ${o.faellig} offen · Durchgang: ${d} von ${PORTION}</p>
      <div class="fortschritt"><span style="width:${o.gesamt ? Math.round(fertig / o.gesamt * 100) : 0}%"></span></div>`;
  }

  async function pruefenZeigen() {
    titelSetzen("Sammlung prüfen");
    const st = await anfrage("wertstatus", {}, { leise: true });
    zustand.gueltigTage = st.ok ? st.status.gueltigTage : 30;
    const o = pruefOffen(), d = sitzungLesen("tonie-pruefen-durchgang", 0);
    if (!o.offen.length || d >= PORTION) {
      $("bereich-pruefen").innerHTML = `<div class="karte-flaeche pruefen">${pruefFortschritt()}
        <p class="fertig">${!o.offen.length ? (o.faellig ? "Für jetzt bist du durch: Die übrigen hast du übersprungen." : `Alle ${o.gesamt} Tonies sind geprüft.`)
          : `Portion geschafft (${PORTION} Tonies). Noch ${o.offen.length} offen – gern an einem anderen Tag weitermachen.`}</p>
        ${st.ok ? `<p class="klein">ToyTales-Abrufe heute: ${st.status.heute} von ${st.status.tageslimit}.</p>` : ""}
        <div class="knopfreihe">
          ${o.offen.length && d >= PORTION ? `<button type="button" class="knopf leise" data-aktion="pruefen-portion">Nächste Portion</button>` : ""}
          ${o.weg.length && !o.offen.length ? `<button type="button" class="knopf leise" data-aktion="pruefen-neu">Übersprungene noch einmal</button>` : ""}
          <button type="button" class="knopf" data-aktion="zur-sammlung">Zur Sammlung</button>
        </div></div>`;
      return zeige("bereich-pruefen");
    }
    wertAssistent(o.offen[0], "pruefen");
  }

  function pruefenWeiter(gespeichert) {
    const w = zustand.wert;
    if (!gespeichert) { const weg = sitzungLesen("tonie-pruefen-uebersprungen", []); weg.push(w.t.id); sitzungSchreiben("tonie-pruefen-uebersprungen", weg); }
    sitzungSchreiben("tonie-pruefen-durchgang", sitzungLesen("tonie-pruefen-durchgang", 0) + 1);
    pruefenZeigen();
  }
  document.addEventListener("click", (ev) => {
    if (ev.target.closest("[data-aktion='pruefen-neu']")) { sitzungSchreiben("tonie-pruefen-uebersprungen", []); pruefenZeigen(); }
    if (ev.target.closest("[data-aktion='pruefen-portion']")) { sitzungSchreiben("tonie-pruefen-durchgang", 0); pruefenZeigen(); }
  });

  // ---------- Hilfen ----------
  function esc(text) {
    return String(text === undefined || text === null ? "" : text).replace(/[&<>"']/g, (z) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[z]);
  }

  function anzahlText(t) {
    const teile = [];
    if (t.behalten) teile.push(`${t.behalten}× behalten`);
    if (t.verkaufen) teile.push(`${t.verkaufen}× verkaufen`);
    return teile.join(", ") || "ohne Anzahl";
  }

  function preisText(p) {
    const n = typeof p === "number" ? p : parseFloat(String(p).replace(",", "."));
    return Number.isFinite(n) ? n.toLocaleString("de-DE", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }) : String(p);
  }

  function bildHtml(url, text) {
    const buchstabe = esc(String(text || "?").trim().charAt(0).toUpperCase());
    const img = /^https:\/\//i.test(url || "")
      ? `<img src="${esc(url.replace(/\bw_\d+,h_\d+\b/, "w_300,h_300"))}" alt="" loading="lazy" onerror="this.remove()">` : "";
    return `<span class="mini-bild"><span class="mini-platzhalter">${buchstabe}</span>${img}</span>`;
  }

  // ---------- Beginn ----------
  zustand.zugang = gespeicherterZugang();
  if (zustand.zugang) start();
  else if (VERWALTEN_ID) lesenStart();
  else sperren("");
})();
