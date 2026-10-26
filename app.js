// Baut aus der Tonie-Liste die Karten, die Ansichten und die Zähler.
(function () {
  const ANSICHTEN = ["alle", "behalten", "verkaufen", "verliehen"];
  const FILTER = ["reihe", "format", "inhalt", "thema", "zustand", "raritaet"];

  const zustand = {
    tonies: [],
    ansicht: "alle",
    suche: "",
    filter: { reihe: "", format: "", inhalt: "", thema: "", zustand: "", raritaet: "" },
    entsperrt: false, // mit PIN oder Passwort: private Felder sichtbar
  };

  const el = {
    karten: document.getElementById("karten"),
    hinweis: document.getElementById("hinweis"),
    knoepfe: document.querySelectorAll("[data-ansicht]"),
    zTonies: document.getElementById("z-tonies"),
    zBehalten: document.getElementById("z-behalten"),
    zVerkaufen: document.getElementById("z-verkaufen"),
    zVerliehen: document.getElementById("z-verliehen"),
    zaehlerFelder: document.querySelectorAll("[data-zaehler]"),
    suche: document.getElementById("suche"),
    filter: document.querySelectorAll("[data-filter]"),
    zuruecksetzen: document.getElementById("zuruecksetzen"),
    schloss: document.getElementById("schloss"),
    pinFenster: document.getElementById("pin-fenster"),
    pinEingabe: document.getElementById("pin-eingabe"),
    pinMeldung: document.getElementById("pin-meldung"),
    pinZu: document.getElementById("pin-zu"),
    pinOffen: document.getElementById("pin-offen"),
    pinBis: document.getElementById("pin-bis"),
  };

  // Text sicher in HTML einsetzen (verhindert, dass Zeichen wie < aus dem Sheet die Seite stören).
  function esc(text) {
    return String(text).replace(/[&<>"']/g, (z) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[z]);
  }

  // Deutsche Sortierung: "Ä" bei "A", Groß-/Kleinschreibung egal, Zahlen natürlich (2 vor 10).
  const sortierer = new Intl.Collator("de", { sensitivity: "base", numeric: true });
  function sortieren(liste) {
    return liste.slice().sort((a, b) =>
      sortierer.compare(a.reihe, b.reihe) || sortierer.compare(a.titel, b.titel));
  }

  function passtZurAnsicht(t, ansicht) {
    if (ansicht === "behalten") return t.behalten > 0;
    if (ansicht === "verkaufen") return t.verkaufen > 0;
    if (ansicht === "verliehen") return t.verliehen; // ohne PIN sichtbar: nur "ja", nicht an wen
    return true;
  }

  // Suchen erledigt TonieSuche (suche.js): tolerant bei Umlauten, Tippfehlern und Wortreihenfolge.
  // Private Felder (Ausleiher, Kommentar) werden nur entsperrt durchsucht.
  const SUCHFELDER = [["titel", 3], ["reihe", 2.5], ["kollektion", 1.5], ["thema", 1]];
  const SUCHFELDER_PRIVAT = SUCHFELDER.concat([["verliehenAn", 2], ["kommentar", 1]]);

  // Ein Feld kann mehrere Werte mit Komma enthalten, z. B. Thema "Märchen, Abenteuer".
  // Besonderheiten: Zustand zählt nur beim Verkauf, leere Rarität heißt "Normal".
  const werteVon = (t, feld) => {
    if (feld === "zustand") return t.verkaufen > 0 && t.zustand ? [t.zustand] : [];
    if (feld === "raritaet") return [t.raritaet || "Normal"];
    return String(t[feld] || "").split(",").map((w) => w.trim()).filter(Boolean);
  };

  function passtZuFiltern(t) {
    return FILTER.every((f) => !zustand.filter[f] || werteVon(t, f).includes(zustand.filter[f]));
  }

  // Auswahllisten aus den Daten füllen, damit neue Werte im Sheet automatisch erscheinen.
  function filterFuellen() {
    el.filter.forEach((auswahl) => {
      const feld = auswahl.dataset.filter;
      const werte = [...new Set(zustand.tonies.flatMap((t) => werteVon(t, feld)))]
        .sort(sortierer.compare);
      auswahl.insertAdjacentHTML("beforeend",
        werte.map((w) => `<option value="${esc(w)}">${esc(w)}</option>`).join(""));
    });
  }

  // Immer gleiche Pastellfarbe pro Reihe, damit Platzhalter einer Reihe zusammenpassen.
  function farbton(text) {
    let h = 0;
    for (const z of text) h = (h * 31 + z.codePointAt(0)) % 360;
    return h;
  }

  function platzhalter(t) {
    const buchstabe = (t.reihe || t.titel || "?").trim().charAt(0).toUpperCase();
    return `<div class="platzhalter" style="--farbton:${farbton(t.reihe)}" aria-hidden="true">
      <span>${esc(buchstabe)}</span></div>`;
  }

  // Reihenfolge: eigenes Foto → Bild-URL → Platzhalter. Der Platzhalter liegt immer unter
  // dem Bild. Lädt ein Bild nicht, kommt das nächste; lädt keins, bleibt der Platzhalter.
  function bild(t) {
    const quellen = [t.eigenesFoto, ...ersatzVonDrive(t.eigenesFoto), t.bild].filter(Boolean);
    if (!quellen.length) return platzhalter(t);
    const ersatz = quellen.slice(1).join(" ");
    return platzhalter(t) + `<img src="${esc(quellen[0])}" alt="" loading="lazy" decoding="async"` +
      `${ersatz ? ` data-ersatz="${esc(ersatz)}"` : ""} onerror="tonieBildFehler(this)">`;
  }
  // Fotos aus Google Drive: Klappt die schnelle Bildadresse nicht, die Vorschau-Adresse probieren.
  function ersatzVonDrive(url) {
    const m = String(url || "").match(/^https:\/\/lh3\.googleusercontent\.com\/d\/([\w-]+)/);
    return m ? [`https://drive.google.com/thumbnail?id=${m[1]}&sz=w800`] : [];
  }
  window.tonieBildFehler = (img) => {
    const rest = (img.dataset.ersatz || "").split(" ").filter(Boolean);
    if (!rest.length) return img.remove();
    img.dataset.ersatz = rest.slice(1).join(" ");
    img.src = rest[0];
  };

  // Knopf zur Quelle: "Auf tonies.com ansehen", sonst "Quelle ansehen (domain)"
  function quelleKnopf(link) {
    let host = "";
    try { host = new URL(link).hostname.replace(/^www\./, ""); } catch (x) { return ""; }
    const text = /(^|\.)tonies\.com$/.test(host) ? "Auf tonies.com ansehen" : `Quelle ansehen (${host})`;
    return `<a class="link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;
  }

  // "2026-10-20" → "20.10.26"
  function kurzDatum(iso) {
    const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}.${m[2]}.${m[1].slice(2)}` : "";
  }
  // Ein Schloss-Knopf auf der Karte öffnet das PIN-Fenster.
  const gesperrt = (text) => `<button type="button" class="marke gesperrt" data-pin>🔒 ${esc(text)}</button>`;

  function preisText(preis) {
    return preis.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
  }

  // Suchtreffer im Text gelb markieren
  const markiert = (text) => zustand.suche.trim() ? TonieSuche.markieren(text, zustand.suche, esc) : esc(text);

  function karte(t, ansicht) {
    // Obere Zeile: Reihe, bei vorhandener Kollektion "Reihe · Kollektion".
    // Ist der Titel gleich der Reihe, erscheint die Reihe nicht doppelt.
    const titelIstReihe = sortierer.compare(t.titel, t.reihe) === 0;
    const oben = [titelIstReihe ? "" : t.reihe, t.kollektion].filter(Boolean).join(" · ");

    const marken = [];
    if (ansicht !== "behalten" && t.verkaufen > 0) {
      marken.push(`<span class="marke verkaufen">${t.verkaufen}× zu verkaufen</span>`);
    }
    if (ansicht !== "verkaufen" && t.behalten > 0) {
      marken.push(`<span class="marke behalten">${t.behalten}× behalten</span>`);
    }
    if (t.anzahlFehlt) marken.push(`<span class="marke fehlt">Anzahl fehlt</span>`);
    if (t.raritaet && t.raritaet !== "Normal") marken.push(`<span class="marke raritaet">★ ${esc(t.raritaet)}</span>`);
    if (t.verliehen) {
      marken.push(zustand.entsperrt && t.verliehenAn
        ? `<span class="marke verliehen">Verliehen an ${esc(t.verliehenAn)} ${kurzDatum(t.verliehenAm)}</span>`
        : zustand.entsperrt ? `<span class="marke verliehen">verliehen</span>` : gesperrt("verliehen"));
    }

    const details = [t.inhalt, t.thema].filter(Boolean).map(esc).join(" · ");

    const verkauf = [];
    if (ansicht !== "behalten" && t.verkaufen > 0) {
      // Der Preis ist privat: ohne PIN nur ein Schloss.
      if (!zustand.entsperrt) verkauf.push(gesperrt("Preis"));
      else if (t.preis !== null) verkauf.push(`<strong>${preisText(t.preis)}</strong>`);
      if (t.zustand) verkauf.push(esc(t.zustand));
    }

    return `<li class="karte">
      <div class="bild">
        ${bild(t)}
        ${t.id ? `<a class="bild-link" href="erfassen.html?id=${encodeURIComponent(t.id)}" aria-label="${esc(t.titel)} verwalten"></a>` : ""}
        ${t.format ? `<span class="format">${esc(t.format)}</span>` : ""}
      </div>
      <div class="text">
        ${oben ? `<p class="reihe">${markiert(oben)}</p>` : ""}
        <h2 class="titel">${markiert(t.titel)}</h2>
        <div class="marken">${marken.join("")}</div>
        ${verkauf.length ? `<p class="verkauf">${verkauf.join(" · ")}</p>` : ""}
        ${details ? `<p class="details">${details}</p>` : ""}
        ${zustand.entsperrt && t.kommentar ? `<p class="kommentar">${markiert(t.kommentar)}</p>` : ""}
        ${t.link ? quelleKnopf(t.link) : ""}
      </div>
    </li>`;
  }

  function zeichnen() {
    const { ansicht } = zustand;
    const suche = zustand.suche.trim();
    let sichtbar = zustand.tonies.filter((t) =>
      passtZurAnsicht(t, ansicht) && passtZuFiltern(t));
    // Mit Suchtext: nur passende Tonies, die besten zuerst.
    if (suche) {
      const felder = zustand.entsperrt ? SUCHFELDER_PRIVAT : SUCHFELDER;
      sichtbar = TonieSuche.suchen(sichtbar, suche, { felder }).map((x) => x.eintrag);
    }
    const eingeschraenkt = suche.length > 0 || FILTER.some((f) => zustand.filter[f]);

    el.karten.innerHTML = sichtbar.map((t) => karte(t, ansicht)).join("");

    // Zähler beziehen sich auf die gerade sichtbaren Tonies.
    const summe = (feld) => sichtbar.reduce((s, t) => s + t[feld], 0);
    el.zTonies.textContent = sichtbar.length;
    el.zBehalten.textContent = summe("behalten");
    el.zVerkaufen.textContent = summe("verkaufen");
    el.zVerliehen.textContent = sichtbar.filter((t) => t.verliehen).length;
    // In "Behalten" bzw. "Verkaufen" ist der jeweils andere Zähler nicht aussagekräftig.
    el.zaehlerFelder.forEach((f) => {
      f.hidden = ansicht !== "alle" && f.dataset.zaehler !== ansicht;
      if (f.dataset.zaehler === "verliehen" && ansicht === "alle") f.hidden = !sichtbar.some((t) => t.verliehen);
    });

    el.knoepfe.forEach((k) => k.setAttribute("aria-pressed", k.dataset.ansicht === ansicht));
    el.schloss.textContent = zustand.entsperrt ? "🔓" : "🔒";
    el.schloss.setAttribute("aria-label", zustand.entsperrt ? "Entsperrt – Zugang verwalten" : "Mit PIN entsperren");
    el.zuruecksetzen.hidden = !eingeschraenkt;
    el.hinweis.hidden = sichtbar.length > 0;
    if (!sichtbar.length) {
      el.hinweis.textContent = eingeschraenkt
        ? "Keine Tonies gefunden. Suche oder Filter anpassen."
        : "Keine Tonies in dieser Ansicht.";
    }
  }

  // Die Ansicht steht in der Adresse (#verkaufen), damit man sie direkt verlinken kann.
  function ansichtAusAdresse() {
    const wunsch = location.hash.replace("#", "");
    zustand.ansicht = ANSICHTEN.includes(wunsch) ? wunsch : "alle";
  }

  el.knoepfe.forEach((k) => k.addEventListener("click", () => {
    history.replaceState(null, "", k.dataset.ansicht === "alle" ? location.pathname : "#" + k.dataset.ansicht);
    zustand.ansicht = k.dataset.ansicht;
    zeichnen();
  }));
  window.addEventListener("hashchange", () => { ansichtAusAdresse(); zeichnen(); });

  el.suche.addEventListener("input", () => { zustand.suche = el.suche.value; zeichnen(); });
  el.filter.forEach((auswahl) => auswahl.addEventListener("change", () => {
    zustand.filter[auswahl.dataset.filter] = auswahl.value;
    zeichnen();
  }));
  el.zuruecksetzen.addEventListener("click", () => {
    zustand.suche = el.suche.value = "";
    el.filter.forEach((auswahl) => { auswahl.value = ""; zustand.filter[auswahl.dataset.filter] = ""; });
    zeichnen();
  });

  // Letzter erfolgreich geladener Stand, falls Google mal nicht erreichbar ist.
  // Liegt nur im Browser des Besuchers; try/catch, weil private Fenster das blockieren können.
  const SPEICHER = "tonies-letzter-stand";
  function merken(tonies) {
    try { localStorage.setItem(SPEICHER, JSON.stringify({ zeit: Date.now(), tonies })); } catch {}
  }
  function erinnern() {
    try { return JSON.parse(localStorage.getItem(SPEICHER)); } catch { return null; }
  }

  async function datenHolen(cfg) {
    // Ohne Live-Adresse: Testdaten aus der Excel.
    if (!cfg.csvUrl) return ToniesDaten.laden(cfg.ersatzUrl);
    try {
      const tonies = await ToniesDaten.laden(cfg.csvUrl);
      merken(tonies);
      return tonies;
    } catch (fehler) {
      const alt = erinnern();
      if (!alt || !Array.isArray(alt.tonies)) throw fehler;
      console.warn("Live-Daten nicht erreichbar, nutze gespeicherten Stand.", fehler);
      const wann = new Date(alt.zeit).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
      const stand = document.getElementById("stand");
      stand.textContent = `Die aktuelle Liste ist gerade nicht erreichbar. Angezeigt wird der Stand vom ${wann}.`;
      stand.hidden = false;
      return alt.tonies;
    }
  }

  // ---------- Zugang mit PIN (oder Passwort von der Seite "Hinzufügen") ----------
  const PIN_SPEICHER = "tonie-pin";
  const ADMIN_SPEICHER = "tonie-zugang";
  function gespeichert(name) {
    try { const z = JSON.parse(localStorage.getItem(name)); return z && z.schluessel && z.bis > Date.now() ? z : null; }
    catch { return null; }
  }
  // Das Passwort schließt den PIN ein, deshalb zuerst den Passwort-Schlüssel nehmen.
  const zugang = () => gespeichert(ADMIN_SPEICHER) || gespeichert(PIN_SPEICHER);
  function zugangLoeschen() {
    try { localStorage.removeItem(PIN_SPEICHER); localStorage.removeItem(ADMIN_SPEICHER); } catch {}
  }

  async function webApp(daten) {
    if (window.ERFASSEN_TESTBACKEND) return window.ERFASSEN_TESTBACKEND(daten); // nur lokaler Testmodus
    const r = await fetch(window.TONIE_CONFIG.erfassenUrl, {
      method: "POST", body: JSON.stringify(daten), headers: { "Content-Type": "text/plain;charset=utf-8" },
    });
    return r.json();
  }

  // Entsperrt: frisch vom Apps Script (mit privaten Feldern, Änderungen sofort sichtbar).
  // Sonst oder bei einem Fehler: die öffentliche CSV.
  async function sammlungLaden(cfg) {
    const z = zugang();
    if (z && cfg.erfassenUrl) {
      try {
        const a = await webApp({ aktion: "sammlung", schluessel: z.schluessel });
        if (a.ok) { zustand.entsperrt = true; return ToniesDaten.ausSammlung(a.tonies); }
        if (a.code === "schluessel") zugangLoeschen(); // abgelaufen oder PIN geändert
      } catch (fehler) {
        console.warn("Apps Script nicht erreichbar, nutze die öffentliche Liste.", fehler);
      }
    }
    zustand.entsperrt = false;
    return datenHolen(cfg);
  }

  // PIN-Fenster: prüft automatisch nach der 4. Ziffer.
  function pinFensterOeffnen() {
    const z = zugang();
    el.pinZu.hidden = !!(zustand.entsperrt && z);
    el.pinOffen.hidden = !(zustand.entsperrt && z);
    if (z) el.pinBis.textContent = new Date(z.bis).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
    el.pinEingabe.value = "";
    el.pinMeldung.hidden = true;
    el.pinFenster.showModal();
    if (!el.pinZu.hidden) el.pinEingabe.focus();
  }
  el.schloss.addEventListener("click", pinFensterOeffnen);
  el.karten.addEventListener("click", (ev) => { if (ev.target.closest("[data-pin]")) pinFensterOeffnen(); });

  el.pinEingabe.addEventListener("input", async () => {
    el.pinEingabe.value = el.pinEingabe.value.replace(/\D/g, "").slice(0, 4);
    if (el.pinEingabe.value.length < 4) return;
    el.pinEingabe.disabled = true;
    el.pinMeldung.hidden = false;
    el.pinMeldung.dataset.art = "hinweis";
    el.pinMeldung.textContent = "Prüfe …";
    let a;
    try { a = await webApp({ aktion: "pin", pin: el.pinEingabe.value }); }
    catch { a = { ok: false, fehler: "Keine Verbindung. Bitte später erneut versuchen." }; }
    el.pinEingabe.disabled = false;
    if (!a.ok) {
      el.pinMeldung.dataset.art = "fehler";
      el.pinMeldung.textContent = a.code === "falsch" ? "PIN falsch." : a.fehler;
      el.pinEingabe.value = "";
      el.pinEingabe.focus();
      return;
    }
    try { localStorage.setItem(PIN_SPEICHER, JSON.stringify({ schluessel: a.schluessel, bis: a.bis })); } catch {}
    el.pinFenster.close();
    neuLaden();
  });

  document.getElementById("pin-sperren").addEventListener("click", () => {
    zugangLoeschen();
    el.pinFenster.close();
    neuLaden();
  });

  async function neuLaden() {
    const cfg = window.TONIE_CONFIG;
    zustand.tonies = sortieren(await sammlungLaden(cfg));
    el.filter.forEach((auswahl) => { auswahl.length = 1; });
    filterFuellen();
    zeichnen();
  }

  async function start() {
    ansichtAusAdresse();
    const cfg = window.TONIE_CONFIG;
    try {
      zustand.tonies = sortieren(await sammlungLaden(cfg));
      filterFuellen();
      zeichnen();
    } catch (fehler) {
      console.error(fehler);
      el.hinweis.textContent = "Die Sammlung konnte gerade nicht geladen werden. Bitte später neu laden.";
    }
  }

  start();
})();
