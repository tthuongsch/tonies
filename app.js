// Baut aus der Tonie-Liste die Karten, die Ansichten und die Zähler.
(function () {
  const ANSICHTEN = ["alle", "behalten", "verkaufen", "verliehen"];
  const FILTER = ["reihe", "format", "inhalt", "thema", "zustand", "raritaet", "version", "geprueft"];
  const TESTMODUS = /testmodus/.test(location.search) ? "&testmodus" : ""; // nur lokal

  const zustand = {
    tonies: [],
    ansicht: "alle",
    suche: "",
    filter: { reihe: "", format: "", inhalt: "", thema: "", zustand: "", raritaet: "", version: "", geprueft: "" },
    sortierung: "titel",
    entsperrt: false, // mit PIN oder Passwort: private Felder sichtbar
  };

  const el = {
    karten: document.getElementById("karten"),
    hinweis: document.getElementById("hinweis"),
    knoepfe: document.querySelectorAll("[data-ansicht]"),
    zaehler: document.getElementById("zaehler"),
    suche: document.getElementById("suche"),
    filter: document.querySelectorAll("[data-filter]"),
    filterKnopf: document.getElementById("filter-knopf"),
    filterText: document.getElementById("filter-text"),
    filterFenster: document.getElementById("filter-fenster"),
    filterAnzeigen: document.getElementById("filter-anzeigen"),
    filterZurueck: document.getElementById("filter-zuruecksetzen"),
    aktiveFilter: document.getElementById("aktive-filter"),
    sortierung: document.getElementById("sortierung"),
    menueKnopf: document.getElementById("menue-knopf"),
    menue: document.getElementById("menue"),
    infoFenster: document.getElementById("info-fenster"),
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
  const nachTitel = (a, b) => sortierer.compare(a.titel, b.titel) || sortierer.compare(a.reihe, b.reihe);
  // Neueste zuerst; ohne Datum ("unbekannt") ans Ende
  const nachDatum = (feld) => (a, b) => (b[feld] || "").localeCompare(a[feld] || "") || nachTitel(a, b);

  // Was einem Tonie noch fehlt (für "Unvollständige zuerst"). Den Preis prüfen wir nur entsperrt.
  function fehlendes(t) {
    const f = [];
    if (!t.eigenesFoto && !t.bild) f.push("Bild");
    if (!t.link) f.push("Link");
    if (!t.thema) f.push("Thema");
    if (t.verkaufen > 0 && !t.zustand) f.push("Zustand");
    if (t.verkaufen > 0 && zustand.entsperrt && t.preis === null) f.push("Preis");
    return f;
  }

  // Sortierungen; "privat" nur entsperrt sichtbar. Tonies ohne Preis kommen immer ans Ende.
  const SORTIERUNGEN = {
    titel: { text: "A–Z Titel", vergleich: nachTitel },
    reihe: { text: "A–Z Reihe", vergleich: (a, b) => sortierer.compare(a.reihe, b.reihe) || nachTitel(a, b) },
    neu: { text: "Neueste zuerst", vergleich: nachDatum("hinzugefuegtAm") },
    geaendert: { text: "Zuletzt geändert", vergleich: nachDatum("geaendertAm") },
    anzahl: { text: "Meiste zuerst", vergleich: (a, b) => (b.behalten + b.verkaufen) - (a.behalten + a.verkaufen) || nachTitel(a, b) },
    "preis-auf": { text: "Preis ↑", privat: true,
      vergleich: (a, b) => (a.preis === null) - (b.preis === null) || (a.preis || 0) - (b.preis || 0) || nachTitel(a, b) },
    "preis-ab": { text: "Preis ↓", privat: true,
      vergleich: (a, b) => (a.preis === null) - (b.preis === null) || (b.preis || 0) - (a.preis || 0) || nachTitel(a, b) },
    richtwert: { text: "Richtwert ↓", privat: true,
      vergleich: (a, b) => (richtwertZahl(a.richtwert) === null) - (richtwertZahl(b.richtwert) === null) ||
        (richtwertZahl(b.richtwert) || 0) - (richtwertZahl(a.richtwert) || 0) || nachTitel(a, b) },
    unvollstaendig: { text: "Unvollständige", vergleich: (a, b) => fehlendes(b).length - fehlendes(a).length || nachTitel(a, b) },
  };
  // "Original" heißt für Menschen "Alte Version"; alles andere wie im Sheet ("Neuauflage 2024")
  function versionText(v) {
    return /^original$/i.test(String(v).trim()) ? "Alte Version" : String(v).trim();
  }
  // "20–30" → 25, "25" → 25; leer → null (für die Sortierung)
  function richtwertZahl(r) {
    const z = String(r || "").replace(",", ".").match(/\d+(?:\.\d+)?/g);
    return z ? z.map(Number).reduce((a, b) => a + b, 0) / z.length : null;
  }

  function sortieren(liste) {
    return liste.slice().sort(SORTIERUNGEN[zustand.sortierung].vergleich);
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
    if (feld === "version") return t.version ? [versionText(t.version)] : [];
    // "Geprüft" heißt: Wert-Stand ist gefüllt. Der ist privat, also nur entsperrt filterbar.
    if (feld === "geprueft") return zustand.entsperrt ? [t.wertStand ? "Geprüft" : "Noch nicht geprüft"] : [];
    return String(t[feld] || "").split(",").map((w) => w.trim()).filter(Boolean);
  };

  // Auswahllisten aus den Daten füllen, damit neue Werte im Sheet automatisch erscheinen.
  function filterFuellen() {
    el.filter.forEach((auswahl) => {
      auswahl.length = 1;
      const feld = auswahl.dataset.filter;
      const werte = [...new Set(zustand.tonies.flatMap((t) => werteVon(t, feld)))]
        .sort(sortierer.compare);
      auswahl.insertAdjacentHTML("beforeend",
        werte.map((w) => `<option value="${esc(w)}">${esc(w)}</option>`).join(""));
      // Ein gewählter Wert, den es nicht mehr gibt, wird zurückgesetzt.
      auswahl.value = zustand.filter[feld];
      if (auswahl.value !== zustand.filter[feld]) zustand.filter[feld] = "";
    });
    // Filter auf private Werte nur entsperrt anbieten
    document.querySelectorAll("[data-nur-entsperrt]").forEach((l) => { l.hidden = !zustand.entsperrt; });
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
    // Verkaufsgruppe: Preis und Zustand gehören zum Exemplar im Verkauf, deshalb direkt dahinter.
    if (ansicht !== "behalten" && t.verkaufen > 0) {
      const info = [];
      if (!zustand.entsperrt) info.push(gesperrt("Preis")); // der Preis ist privat
      else if (t.preis !== null) info.push(`<strong>${preisText(t.preis)}</strong>`);
      if (t.zustand) info.push(esc(t.zustand));
      marken.push(`<span class="verkauf-gruppe"><span class="marke verkaufen">${t.verkaufen}× verkaufen</span>` +
        `${info.length ? `<span class="verkauf-info">${info.join(" · ")}</span>` : ""}</span>`);
    }
    if (ansicht !== "verkaufen" && t.behalten > 0) {
      marken.push(`<span class="marke behalten">${t.behalten}× behalten</span>`);
    }
    if (t.anzahlFehlt) marken.push(`<span class="marke fehlt">Anzahl fehlt</span>`);
    if (t.raritaet && t.raritaet !== "Normal") marken.push(`<span class="marke raritaet">★ ${esc(t.raritaet)}</span>`);
    if (t.version && !/^unbekannt$/i.test(t.version)) marken.push(`<span class="marke version">${esc(versionText(t.version))}</span>`);
    if (zustand.entsperrt && t.richtwert) marken.push(`<span class="marke richtwert">Richtwert ${esc(t.richtwert)} €</span>`);
    if (zustand.sortierung === "unvollstaendig" && fehlendes(t).length) {
      marken.push(`<span class="marke fehlt">Fehlt: ${esc(fehlendes(t).join(", "))}</span>`);
    }
    if (t.verliehen) {
      marken.push(zustand.entsperrt && t.verliehenAn
        ? `<span class="marke verliehen">Verliehen an ${esc(t.verliehenAn)} ${kurzDatum(t.verliehenAm)}</span>`
        : zustand.entsperrt ? `<span class="marke verliehen">verliehen</span>` : gesperrt("verliehen"));
    }

    const details = [t.inhalt, t.thema].filter(Boolean).map(esc).join(" · ");

    // Der Link liegt über der ganzen Karte; "Auf tonies.com ansehen" und 🔒 liegen darüber.
    return `<li class="karte">
      ${t.id ? `<a class="karte-link" href="erfassen.html?id=${encodeURIComponent(t.id)}${TESTMODUS}" data-id="${esc(t.id)}" aria-label="${esc(t.titel)} verwalten"></a>` : ""}
      <div class="bild">
        ${bild(t)}
        ${t.format ? `<span class="format">${esc(t.format)}</span>` : ""}
      </div>
      <div class="text">
        ${oben ? `<p class="reihe">${markiert(oben)}</p>` : ""}
        <h2 class="titel">${markiert(t.titel)}</h2>
        <div class="marken">${marken.join("")}</div>
        ${details ? `<p class="details">${details}</p>` : ""}
        ${zustand.entsperrt && t.kommentar ? `<p class="kommentar">${markiert(t.kommentar)}</p>` : ""}
        ${t.link ? quelleKnopf(t.link) : ""}
      </div>
    </li>`;
  }

  const FILTER_NAMEN = { reihe: "Reihe", format: "Format", inhalt: "Inhalt", thema: "Thema", zustand: "Zustand", raritaet: "Rarität",
    version: "Version", geprueft: "Geprüft" };

  // Tonies nach Ansicht, Filtern und Suche; mit Suchtext die besten Treffer zuerst,
  // außer es ist bewusst eine andere Sortierung als "A–Z Titel" gewählt.
  function sichtbareTonies(filter) {
    const suche = zustand.suche.trim();
    let liste = zustand.tonies.filter((t) => passtZurAnsicht(t, zustand.ansicht) &&
      FILTER.every((f) => !filter[f] || werteVon(t, f).includes(filter[f])));
    if (suche) {
      const felder = zustand.entsperrt ? SUCHFELDER_PRIVAT : SUCHFELDER;
      liste = TonieSuche.suchen(liste, suche, { felder }).map((x) => x.eintrag);
      return zustand.sortierung === "titel" ? liste : sortieren(liste);
    }
    return sortieren(liste);
  }

  function zeichnen() {
    const { ansicht } = zustand;
    const sichtbar = sichtbareTonies(zustand.filter);
    const aktiv = FILTER.filter((f) => zustand.filter[f]);
    const eingeschraenkt = zustand.suche.trim().length > 0 || aktiv.length > 0;

    el.karten.innerHTML = sichtbar.map((t) => karte(t, ansicht)).join("");

    // Zähler als eine Zeile, bezogen auf die sichtbaren Tonies. In "Behalten" bzw.
    // "Verkaufen" ist der jeweils andere Wert nicht aussagekräftig.
    const summe = (feld) => sichtbar.reduce((s, t) => s + t[feld], 0);
    const verliehen = sichtbar.filter((t) => t.verliehen).length;
    const teile = [`${sichtbar.length} ${sichtbar.length === 1 ? "Tonie" : "Tonies"}`];
    if (ansicht === "alle" || ansicht === "behalten") teile.push(`${summe("behalten")} behalten`);
    if (ansicht === "alle" || ansicht === "verkaufen") teile.push(`${summe("verkaufen")} verkaufen`);
    if (verliehen && ansicht !== "verliehen") teile.push(`${verliehen} verliehen`);
    el.zaehler.textContent = teile.join(" · ");

    // Filter-Knopf mit Anzahl, darunter die aktiven Filter zum Einzeln-Entfernen
    el.filterText.textContent = aktiv.length ? `Filter (${aktiv.length})` : "Filter";
    el.filterKnopf.classList.toggle("an", aktiv.length > 0);
    el.aktiveFilter.hidden = !aktiv.length;
    el.aktiveFilter.innerHTML = aktiv.map((f) =>
      `<button type="button" class="filter-chip" data-weg="${f}" aria-label="Filter ${FILTER_NAMEN[f]} entfernen">` +
      `${FILTER_NAMEN[f]}: ${esc(zustand.filter[f])} <span aria-hidden="true">✕</span></button>`).join("") +
      (aktiv.length > 1 ? `<button type="button" class="filter-chip leise" data-weg="alle">Alle entfernen</button>` : "");

    el.knoepfe.forEach((k) => k.setAttribute("aria-pressed", k.dataset.ansicht === ansicht));
    el.schloss.textContent = zustand.entsperrt ? "🔓" : "🔒";
    el.schloss.setAttribute("aria-label", zustand.entsperrt ? "Entsperrt – Zugang verwalten" : "Mit PIN entsperren");
    el.hinweis.hidden = sichtbar.length > 0;
    if (!sichtbar.length) {
      el.hinweis.textContent = eingeschraenkt
        ? "Keine Tonies gefunden. Suche oder Filter anpassen."
        : "Keine Tonies in dieser Ansicht.";
    }
    filterAnzeigeAktualisieren();
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

  // ---------- Filterfenster ----------
  // Änderungen wirken sofort; der Knopf unten zeigt, wie viele Tonies übrig bleiben.
  function filterAnzeigeAktualisieren() {
    const n = sichtbareTonies(zustand.filter).length;
    el.filterAnzeigen.textContent = n === 1 ? "1 Ergebnis anzeigen" : `${n} Ergebnisse anzeigen`;
  }
  el.filterKnopf.addEventListener("click", () => { filterAnzeigeAktualisieren(); el.filterFenster.showModal(); });
  el.filter.forEach((auswahl) => auswahl.addEventListener("change", () => {
    zustand.filter[auswahl.dataset.filter] = auswahl.value;
    zeichnen();
  }));
  function filterLeeren() {
    el.filter.forEach((auswahl) => { auswahl.value = ""; zustand.filter[auswahl.dataset.filter] = ""; });
    zeichnen();
  }
  el.filterZurueck.addEventListener("click", filterLeeren);
  el.aktiveFilter.addEventListener("click", (ev) => {
    const k = ev.target.closest("[data-weg]");
    if (!k) return;
    if (k.dataset.weg === "alle") return filterLeeren();
    zustand.filter[k.dataset.weg] = "";
    document.querySelector(`[data-filter="${k.dataset.weg}"]`).value = "";
    zeichnen();
  });

  // Fenster: ✕, Klick daneben (auf den abgedunkelten Rand) und Escape schließen.
  document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (ev) => {
    if (ev.target === d || ev.target.closest("[data-schliessen]")) d.close();
  }));

  // ---------- Sortierung (wird auf diesem Gerät gemerkt) ----------
  const SORT_SPEICHER = "tonie-sortierung";
  function sortierungFuellen() {
    const erlaubt = Object.keys(SORTIERUNGEN).filter((k) => !SORTIERUNGEN[k].privat || zustand.entsperrt);
    let gewaehlt = zustand.sortierung;
    try { gewaehlt = localStorage.getItem(SORT_SPEICHER) || gewaehlt; } catch {}
    zustand.sortierung = erlaubt.includes(gewaehlt) ? gewaehlt : "titel";
    el.sortierung.innerHTML = erlaubt.map((k) => `<option value="${k}">${SORTIERUNGEN[k].text}</option>`).join("");
    el.sortierung.value = zustand.sortierung;
  }
  el.sortierung.addEventListener("change", () => {
    zustand.sortierung = el.sortierung.value;
    try { localStorage.setItem(SORT_SPEICHER, zustand.sortierung); } catch {}
    zeichnen();
  });

  // ---------- Menü ☰ ----------
  function menueZeigen(offen) {
    el.menue.hidden = !offen;
    el.menueKnopf.setAttribute("aria-expanded", offen);
  }
  el.menueKnopf.addEventListener("click", (ev) => { ev.stopPropagation(); menueZeigen(el.menue.hidden); });
  document.addEventListener("click", (ev) => { if (!el.menue.hidden && !ev.target.closest("#menue")) menueZeigen(false); });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !el.menue.hidden) { menueZeigen(false); el.menueKnopf.focus(); }
  });

  const INFOS = {
    fototipps: ["Foto-Tipps", `<p>So erkennt die Fotoerkennung deinen Tonie am besten:</p><ul>
      <li>nur ein Tonie im Bild</li><li>hell, ohne Blitz-Spiegelung</li><li>von vorn und nah dran</li>
      <li>ruhiger Hintergrund</li><li>unsicher? Ein zweites Foto vom Boden oder der Verpackung</li></ul>
      <p>Eigene Fotos für die Karte: nur den Tonie fotografieren, keine Personen – die Fotos sind per Link sichtbar.</p>`],
    hilfe: ["Hilfe", `<ul>
      <li><strong>Alle / Behalten / Verkaufen / Verliehen</strong> wählen, welche Tonies du siehst.</li>
      <li><strong>Suche</strong> verzeiht Tippfehler und Umlaute, z. B. „pinokio“ oder „Bibi Blocksbeg“.</li>
      <li><strong>Filter</strong> grenzen weiter ein; aktive Filter entfernst du mit ✕.</li>
      <li><strong>🔒</strong> mit PIN entsperren: zeigt Preise, Kommentare und an wen ein Tonie verliehen ist.</li>
      <li><strong>Bild antippen</strong> öffnet „Tonie verwalten“ (nur mit Passwort).</li></ul>`],
  };
  el.menue.addEventListener("click", (ev) => {
    const k = ev.target.closest("[data-info]");
    if (!k) return;
    const [titel, text] = INFOS[k.dataset.info];
    document.getElementById("info-titel").textContent = titel;
    document.getElementById("info-text").innerHTML = text;
    menueZeigen(false);
    el.infoFenster.showModal();
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

  // ---------- Zustand der Übersicht merken (für die Rückkehr von "Tonie verwalten") ----------
  // sessionStorage gilt nur in diesem Tab. Die Verwalten-Seite springt mit history.back() zurück,
  // damit kein neuer Verlaufseintrag entsteht; hier wird dann alles wiederhergestellt.
  const UEBERSICHT_SPEICHER = "tonie-uebersicht";
  const AUSWAHL_SPEICHER = "tonie-auswahl";
  const MELDUNG_SPEICHER = "tonie-meldung";
  const sitzung = {
    lesen(name) { try { return JSON.parse(sessionStorage.getItem(name)); } catch { return null; } },
    schreiben(name, wert) { try { sessionStorage.setItem(name, JSON.stringify(wert)); } catch {} },
    weg(name) { try { sessionStorage.removeItem(name); } catch {} },
  };
  function uebersichtMerken() {
    sitzung.schreiben(UEBERSICHT_SPEICHER, { ansicht: zustand.ansicht, suche: zustand.suche,
      filter: zustand.filter, scroll: window.scrollY });
  }
  function uebersichtHolen() {
    const g = sitzung.lesen(UEBERSICHT_SPEICHER);
    if (!g) return null;
    // Steht eine Ansicht in der Adresse (#verkaufen), gilt diese; sonst die gemerkte.
    if (!location.hash && ANSICHTEN.includes(g.ansicht) && g.ansicht !== "alle") {
      zustand.ansicht = g.ansicht;
      history.replaceState(null, "", "#" + g.ansicht);
    }
    zustand.suche = el.suche.value = String(g.suche || "");
    FILTER.forEach((f) => { zustand.filter[f] = (g.filter && g.filter[f]) || ""; });
    return g;
  }
  window.addEventListener("pagehide", uebersichtMerken);
  // Klick auf eine Karte: Zustand merken und die Angaben des Tonies mitgeben,
  // damit "Tonie verwalten" sofort etwas zeigt.
  el.karten.addEventListener("click", (ev) => {
    const link = ev.target.closest(".karte-link");
    if (!link) return;
    uebersichtMerken();
    const t = zustand.tonies.find((x) => x.id === link.dataset.id);
    if (t) sitzung.schreiben(AUSWAHL_SPEICHER, t);
  });

  // Kurze Bestätigung wie "„Pinocchio“ gespeichert"
  let toastTimer;
  function meldungZeigen() {
    const text = sitzung.lesen(MELDUNG_SPEICHER);
    sitzung.weg(MELDUNG_SPEICHER);
    if (!text) return;
    const t = document.getElementById("toast");
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }

  // Zurück aus dem Zwischenspeicher des Browsers (Zurück-Taste, history.back()):
  // Zustand und Scroll-Position sind noch da, die Daten aber frisch holen.
  window.addEventListener("pageshow", async (ev) => {
    if (!ev.persisted) return;
    const scroll = window.scrollY;
    await neuLaden();
    window.scrollTo(0, scroll);
    meldungZeigen();
  });

  async function neuLaden() {
    const cfg = window.TONIE_CONFIG;
    zustand.tonies = await sammlungLaden(cfg);
    sortierungFuellen();
    filterFuellen();
    zeichnen();
  }

  async function start() {
    ansichtAusAdresse();
    const gemerkt = uebersichtHolen();
    const cfg = window.TONIE_CONFIG;
    try {
      zustand.tonies = await sammlungLaden(cfg);
      sortierungFuellen();
      filterFuellen();
      zeichnen();
      if (gemerkt && gemerkt.scroll) window.scrollTo(0, gemerkt.scroll);
      meldungZeigen();
    } catch (fehler) {
      console.error(fehler);
      el.hinweis.textContent = "Die Sammlung konnte gerade nicht geladen werden. Bitte später neu laden.";
    }
  }

  start();
})();
