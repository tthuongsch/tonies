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

  const BEREICHE = ["bereich-sperre", "bereich-start", "bereich-formular", "bereich-fertig"];
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
  async function anfrage(aktion, daten) {
    const body = Object.assign({ aktion, schluessel: zustand.zugang && zustand.zugang.schluessel }, daten);
    $("laden").hidden = false;
    try {
      let antwort;
      if (window.ERFASSEN_TESTBACKEND) {
        antwort = await window.ERFASSEN_TESTBACKEND(body);
      } else {
        if (!cfg.erfassenUrl) throw new Error("In config.js fehlt die Adresse der Web-App (erfassenUrl).");
        // text/plain vermeidet eine Vorab-Anfrage, die Apps Script nicht beantwortet.
        const r = await fetch(cfg.erfassenUrl, {
          method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "text/plain;charset=utf-8" },
        });
        antwort = await r.json();
      }
      if (antwort.code === "schluessel" && aktion !== "entsperren") {
        sperren("Bitte erneut entsperren (der Zugang gilt 24 Stunden).");
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
    [["reihe"], ["kollektion"], ["format"], ["inhalt"], ["thema", true]].forEach(([feld, trennen]) => {
      $("vorschlag-" + feld).innerHTML = werte(feld, trennen).map((w) => `<option value="${esc(w)}">`).join("");
    });
  }

  async function start() {
    zeige("bereich-start");
    reiter("suchen");
    await listeLaden();
    const b = await anfrage("budget");
    if (b.ok) budgetZeigen(b.budget);
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
    if (name === "suchen") $("suchtext").focus();
  }
  document.addEventListener("click", (ev) => {
    const k = ev.target.closest("[data-reiter]");
    if (k) reiter(k.dataset.reiter);
  });

  // ---------- Suchen ----------
  $("form-suche").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const text = $("suchtext").value.trim();
    trefferZeigen([], "treffer");
    $("nichts-gefunden").hidden = true;
    $("mehr-suchen").hidden = true;
    if (!text) return;
    const a = await anfrage("suchen", { text });
    if (!a.ok) return meldung("such-meldung", a.fehler);
    meldung("such-meldung", "");
    trefferZeigen(a.treffer, "treffer");
    $("nichts-gefunden").hidden = a.treffer.length > 0;
    $("mehr-suchen").hidden = a.treffer.length === 0;
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

  function trefferZeigen(liste, ulId) {
    zustand.treffer = liste;
    $(ulId).innerHTML = liste.map(trefferKarte).join("");
  }

  const SICHERHEIT = { hoch: "sehr wahrscheinlich", mittel: "wahrscheinlich", niedrig: "vielleicht" };

  function trefferKarte(t, i) {
    const oben = [t.reihe, t.kollektion].filter(Boolean).join(" · ");
    const marken = [];
    if (t.vorhanden) marken.push(`<span class="marke behalten">In deiner Liste: ${anzahlText(t.vorhanden)}</span>`);
    else if (t.format) marken.push(`<span class="marke">${esc(t.format)}</span>`);
    if (t.sicherheit) marken.push(`<span class="marke">${SICHERHEIT[t.sicherheit] || esc(t.sicherheit)}</span>`);
    if (t.quelle === "netz" || t.herkunft === "Community") marken.push(`<span class="marke">Quelle: ${esc(t.herkunft)}</span>`);
    return `<li><button type="button" class="treffer-karte" data-treffer="${i}">
      ${bildHtml(t.bild, t.reihe || t.titel)}
      <span class="text">
        <span class="reihe">${esc(oben)}</span>
        <span class="titel">${esc(t.titel)}</span>
        ${marken.join("")}
      </span></button></li>`;
  }

  ["treffer", "foto-treffer"].forEach((id) => $(id).addEventListener("click", (ev) => {
    const k = ev.target.closest("[data-treffer]");
    if (!k) return;
    const t = zustand.treffer[Number(k.dataset.treffer)];
    formularOeffnen(t, t.vorhanden);
  }));

  // ---------- Foto ----------
  zustand.fotos = [];

  // Fotos im Browser auf höchstens 1024 px verkleinern: schneller und günstiger.
  async function fotoVerkleinern(datei) {
    const bild = await createImageBitmap(datei);
    const faktor = Math.min(1, 1024 / Math.max(bild.width, bild.height));
    const leinwand = document.createElement("canvas");
    leinwand.width = Math.round(bild.width * faktor);
    leinwand.height = Math.round(bild.height * faktor);
    leinwand.getContext("2d").drawImage(bild, 0, 0, leinwand.width, leinwand.height);
    return leinwand.toDataURL("image/jpeg", 0.8);
  }

  async function fotosHinzufuegen(dateien) {
    for (const datei of Array.from(dateien).slice(0, 2)) {
      try {
        zustand.fotos.push(await fotoVerkleinern(datei));
      } catch (e) {
        meldung("foto-meldung", "Dieses Bild ließ sich nicht lesen. Bitte ein anderes Foto versuchen.");
      }
    }
    zustand.fotos = zustand.fotos.slice(-2);
    fotoAnsichtAktualisieren();
  }
  ["foto-kamera", "foto-datei"].forEach((id) => $(id).addEventListener("change", (ev) => {
    fotosHinzufuegen(ev.target.files);
    ev.target.value = "";
  }));

  function fotoAnsichtAktualisieren() {
    $("foto-vorschau").innerHTML = zustand.fotos.map((f) => `<img src="${f}" alt="Dein Foto">`).join("");
    const hinweis = $("foto-hinweis").value.trim();
    $("foto-los").textContent = hinweis ? "Kostenlos suchen" : "Per Foto erkennen (ca. 0,2 Cent)";
  }
  $("foto-hinweis").addEventListener("input", fotoAnsichtAktualisieren);

  function fotoErgebnisLeeren() {
    trefferZeigen([], "foto-treffer");
    $("foto-ueberschrift").hidden = true;
    $("foto-weiter").hidden = true;
    meldung("foto-meldung", "");
  }

  function fotoErgebnis(ueberschrift, treffer, knoepfe) {
    trefferZeigen(treffer, "foto-treffer");
    $("foto-ueberschrift").textContent = ueberschrift;
    $("foto-ueberschrift").hidden = false;
    $("foto-weiter").hidden = false;
    $("foto-ki").hidden = !knoepfe.ki || !zustand.fotos.length;
    $("foto-netz").hidden = !knoepfe.netz;
  }

  // Stufe 1 (mit Hinweis, kostenlos) oder direkt Stufe 2 (ohne Hinweis)
  async function fotoLos() {
    fotoErgebnisLeeren();
    const hinweis = $("foto-hinweis").value.trim();
    if (hinweis) {
      const a = await anfrage("suchen", { text: hinweis });
      if (!a.ok) return meldung("foto-meldung", a.fehler);
      return fotoErgebnis(a.treffer.length ? "Gefunden – ohne KI, kostenlos:" : "Ohne KI nichts gefunden.",
        a.treffer, { ki: true, netz: true });
    }
    return fotoKi();
  }

  async function fotoKi() {
    if (!zustand.fotos.length) return meldung("foto-meldung", "Bitte zuerst ein Foto aufnehmen oder hochladen.");
    fotoErgebnisLeeren();
    meldung("foto-meldung", "Foto wird erkannt …", "hinweis");
    const a = await anfrage("erkennen", { fotos: zustand.fotos, hinweis: $("foto-hinweis").value.trim() });
    budgetZeigen(a.budget);
    if (!a.ok) return meldung("foto-meldung", a.fehler);
    meldung("foto-meldung", "");
    zustand.vermutung = a.vermutung;
    const text = a.beschreibung ? `Auf dem Foto: ${a.beschreibung}` : "";
    fotoErgebnis(a.treffer.length ? `${text} Passende Tonies:` : `${text} Kein passender Tonie in Liste oder Katalog.`,
      a.treffer, { ki: false, netz: true });
  }

  async function netzSuchenFoto() {
    const text = $("foto-hinweis").value.trim() || zustand.vermutung || "";
    fotoErgebnisLeeren();
    meldung("foto-meldung", "Suche im Netz … das dauert etwa 10–30 Sekunden.", "hinweis");
    const a = await anfrage("netz", { text, fotos: zustand.fotos });
    budgetZeigen(a.budget);
    if (!a.ok) return meldung("foto-meldung", a.fehler);
    meldung("foto-meldung", "");
    fotoErgebnis(a.treffer.length ? "Gefunden im Netz – bitte die Angaben im nächsten Schritt prüfen:"
      : "Auch im Netz nichts gefunden. Bitte von Hand eintragen.", a.treffer, { ki: false, netz: false });
  }

  document.addEventListener("click", (ev) => {
    const k = ev.target.closest("[data-aktion]");
    if (!k) return;
    const aktion = k.dataset.aktion;
    if (aktion === "anders-schreiben") { $("suchtext").select(); $("suchtext").focus(); }
    if (aktion === "abbrechen") abbrechen();
    if (aktion === "ergaenzen") ergaenzenModus(zustand.vorhanden);
    if (aktion === "auslesen") auslesen();
    if (aktion === "naechster") abbrechen();
    if (aktion === "netz-text") netzSuchenText();
    if (aktion === "foto-los") fotoLos();
    if (aktion === "foto-ki") fotoKi();
    if (aktion === "netz-foto") netzSuchenFoto();
    if (aktion === "fotos-neu") {
      zustand.fotos = [];
      zustand.vermutung = "";
      fotoAnsichtAktualisieren();
      fotoErgebnisLeeren();
    }
  });

  function abbrechen() {
    $("suchtext").value = "";
    $("treffer").innerHTML = "";
    $("nichts-gefunden").hidden = true;
    $("mehr-suchen").hidden = true;
    meldung("such-meldung", "");
    zustand.fotos = [];
    zustand.vermutung = "";
    $("foto-hinweis").value = "";
    fotoAnsichtAktualisieren();
    fotoErgebnisLeeren();
    zeige("bereich-start");
    reiter("suchen");
  }

  // ---------- Formular ----------
  const FELDER = ["link", "bild", "titel", "reihe", "kollektion", "format", "inhalt", "thema", "preis", "zustand", "kommentar"];

  function feldSetzen(name, wert) {
    $("f-" + name).value = wert === null || wert === undefined ? "" : (name === "preis" ? preisText(wert) : String(wert));
  }

  function formularOeffnen(felder, vorhanden) {
    zustand.modus = "neu";
    zustand.ziel = null;
    $("form-tonie").reset();
    FELDER.forEach((f) => feldSetzen(f, felder[f]));
    ["behalten", "verkaufen"].forEach((art) => { $("h-" + art).checked = false; $("f-" + art).value = 1; });
    neupreisZeigen(felder.neupreis);
    beschriftungen();
    meldung("formular-meldung", "");
    meldung("auslesen-meldung", "");
    bildVorschau();
    vorhandenZeigen(vorhanden || null);
    zeige("bereich-formular");
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
    $("eintragen").textContent = erg ? "Eintrag aktualisieren" : "Eintragen";
    $("ergaenzen-titel").hidden = !erg;
    anzahlAktualisieren();
  }

  function anzahlen() {
    const wert = (art) => $("h-" + art).checked ? Math.max(0, parseInt($("f-" + art).value, 10) || 0) : 0;
    return { behalten: wert("behalten"), verkaufen: wert("verkaufen") };
  }

  function anzahlAktualisieren() {
    ["behalten", "verkaufen"].forEach((art) => { $("f-" + art).disabled = !$("h-" + art).checked; });
    const n = anzahlen();
    const ziel = zustand.ziel;
    $("verkaufsfelder").hidden = !(n.verkaufen > 0 || (ziel && ziel.verkaufen > 0));
    if (ziel) {
      $("anzahl-vorschau").textContent = "Danach: " + anzahlText({ behalten: ziel.behalten + n.behalten, verkaufen: ziel.verkaufen + n.verkaufen });
    } else {
      $("anzahl-vorschau").textContent = n.behalten || n.verkaufen ? "" : "Ohne Anzahl erscheint der Tonie mit „Anzahl fehlt“.";
    }
  }
  ["h-behalten", "h-verkaufen", "f-behalten", "f-verkaufen"].forEach((id) => $(id).addEventListener("input", anzahlAktualisieren));

  // ---------- Doppelte ----------
  function vereinfachen(text) {
    return String(text || "").toLowerCase().replace(/ß/g, "ss")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u").trim();
  }
  const linkSchluessel = (u) => String(u || "").trim().toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "");

  function findeVorhanden(f) {
    const link = linkSchluessel(f.link);
    const name = vereinfachen(f.titel) + "|" + vereinfachen(f.reihe);
    return zustand.liste.find((t) => (link && linkSchluessel(t.link) === link) ||
      (f.titel && f.reihe && vereinfachen(t.titel) + "|" + vereinfachen(t.reihe) === name)) || null;
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

  // ---------- Bild ----------
  function bildVorschau() {
    const url = $("f-bild").value.trim();
    const img = $("bild-vorschau");
    img.hidden = !/^https:\/\//i.test(url);
    if (!img.hidden) img.src = url.replace(/\bw_\d+,h_\d+\b/, "w_300,h_300");
  }
  $("f-bild").addEventListener("change", bildVorschau);
  $("bild-vorschau").addEventListener("error", () => { $("bild-vorschau").hidden = true; });

  // ---------- Eintragen ----------
  function formularWerte() {
    const w = {};
    FELDER.forEach((f) => { w[f] = $("f-" + f).value.trim(); });
    return w;
  }

  $("form-tonie").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const felder = formularWerte();
    if (!felder.titel || !felder.reihe) {
      meldung("formular-meldung", "Bitte Titel und Reihe ausfüllen.");
      $(felder.titel ? "f-reihe" : "f-titel").focus();
      return;
    }
    const n = anzahlen();
    let daten;
    if (zustand.modus === "ergaenzen") {
      const ziel = zustand.ziel;
      if (!n.behalten && !n.verkaufen && !confirm("Keine Anzahl hinzugefügt. Nur die Angaben aktualisieren?")) return;
      daten = { modus: "ergaenzen", ziel: { link: ziel.link, titel: ziel.titel, reihe: ziel.reihe },
        plusBehalten: n.behalten, plusVerkaufen: n.verkaufen, felder };
    } else {
      daten = { modus: "neu", felder: Object.assign(felder, n) };
    }
    const a = await anfrage("eintragen", daten);
    if (!a.ok && a.code === "vorhanden") {
      await listeLaden();
      vorhandenZeigen(findeVorhanden(a.vorhanden) || a.vorhanden);
      return window.scrollTo(0, 0);
    }
    if (!a.ok) return meldung("formular-meldung", a.fehler);
    $("fertig-text").innerHTML = a.ergebnis === "ergaenzt"
      ? `<strong>${esc(a.titel)}</strong> ist aktualisiert: jetzt ${anzahlText(a)}.`
      : `<strong>${esc(a.titel)}</strong> ist eingetragen${a.behalten || a.verkaufen ? ": " + anzahlText(a) : ""}.`;
    zeige("bereich-fertig");
    listeLaden();
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
  if (zustand.zugang) start(); else sperren("");
})();
