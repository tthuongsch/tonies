// Baut aus der Tonie-Liste die Karten, die Ansichten und die Zähler.
(function () {
  const ANSICHTEN = ["alle", "behalten", "verkaufen"];
  const FILTER = ["reihe", "format", "inhalt", "thema"];

  const zustand = {
    tonies: [],
    ansicht: "alle",
    suche: "",
    filter: { reihe: "", format: "", inhalt: "", thema: "" },
  };

  const el = {
    karten: document.getElementById("karten"),
    hinweis: document.getElementById("hinweis"),
    knoepfe: document.querySelectorAll("[data-ansicht]"),
    zTonies: document.getElementById("z-tonies"),
    zBehalten: document.getElementById("z-behalten"),
    zVerkaufen: document.getElementById("z-verkaufen"),
    zaehlerFelder: document.querySelectorAll("[data-zaehler]"),
    suche: document.getElementById("suche"),
    filter: document.querySelectorAll("[data-filter]"),
    zuruecksetzen: document.getElementById("zuruecksetzen"),
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
    return true;
  }

  // Für die Suche vereinfachen: klein, ohne Akzente, ä/ae → a usw., ß → ss.
  // So finden "Grüffelo", "Gruffelo" und "Grueffelo" dasselbe.
  function vereinfachen(text) {
    return String(text)
      .toLowerCase()
      .replace(/ß/g, "ss")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u");
  }

  // Jedes Suchwort muss irgendwo in Titel, Reihe oder Kollektion vorkommen.
  function passtZurSuche(t, woerter) {
    return woerter.every((w) => t.suchtext.includes(w));
  }

  function passtZuFiltern(t) {
    return FILTER.every((f) => !zustand.filter[f] || t[f] === zustand.filter[f]);
  }

  // Auswahllisten aus den Daten füllen, damit neue Werte im Sheet automatisch erscheinen.
  function filterFuellen() {
    el.filter.forEach((auswahl) => {
      const feld = auswahl.dataset.filter;
      const werte = [...new Set(zustand.tonies.map((t) => t[feld]).filter(Boolean))]
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

  // Der Platzhalter liegt immer unter dem Bild. Lädt das Bild nicht, wird es entfernt
  // und der Platzhalter ist zu sehen.
  function bild(t) {
    const img = t.bild
      ? `<img src="${esc(t.bild)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">`
      : "";
    return platzhalter(t) + img;
  }

  function preisText(preis) {
    return preis.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
  }

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

    const details = [t.inhalt, t.thema].filter(Boolean).map(esc).join(" · ");

    const verkauf = [];
    if (ansicht !== "behalten" && t.verkaufen > 0) {
      if (t.preis !== null) verkauf.push(`<strong>${preisText(t.preis)}</strong>`);
      if (t.zustand) verkauf.push(esc(t.zustand));
    }

    return `<li class="karte">
      <div class="bild">
        ${bild(t)}
        ${t.format ? `<span class="format">${esc(t.format)}</span>` : ""}
      </div>
      <div class="text">
        ${oben ? `<p class="reihe">${esc(oben)}</p>` : ""}
        <h2 class="titel">${esc(t.titel)}</h2>
        <div class="marken">${marken.join("")}</div>
        ${verkauf.length ? `<p class="verkauf">${verkauf.join(" · ")}</p>` : ""}
        ${details ? `<p class="details">${details}</p>` : ""}
        ${t.kommentar ? `<p class="kommentar">${esc(t.kommentar)}</p>` : ""}
        ${t.link ? `<a class="link" href="${esc(t.link)}" target="_blank" rel="noopener">Auf tonies.com ansehen</a>` : ""}
      </div>
    </li>`;
  }

  function zeichnen() {
    const { ansicht } = zustand;
    const woerter = vereinfachen(zustand.suche).split(/\s+/).filter(Boolean);
    const sichtbar = zustand.tonies.filter((t) =>
      passtZurAnsicht(t, ansicht) && passtZuFiltern(t) && passtZurSuche(t, woerter));
    const eingeschraenkt = woerter.length > 0 || FILTER.some((f) => zustand.filter[f]);

    el.karten.innerHTML = sichtbar.map((t) => karte(t, ansicht)).join("");

    // Zähler beziehen sich auf die gerade sichtbaren Tonies.
    const summe = (feld) => sichtbar.reduce((s, t) => s + t[feld], 0);
    el.zTonies.textContent = sichtbar.length;
    el.zBehalten.textContent = summe("behalten");
    el.zVerkaufen.textContent = summe("verkaufen");
    // In "Behalten" bzw. "Verkaufen" ist der jeweils andere Zähler nicht aussagekräftig.
    el.zaehlerFelder.forEach((f) => {
      f.hidden = ansicht !== "alle" && f.dataset.zaehler !== ansicht;
    });

    el.knoepfe.forEach((k) => k.setAttribute("aria-pressed", k.dataset.ansicht === ansicht));
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

  async function start() {
    ansichtAusAdresse();
    const cfg = window.TONIE_CONFIG;
    try {
      zustand.tonies = sortieren(await datenHolen(cfg));
      // Suchtext einmal vorbereiten statt bei jedem Tastendruck neu.
      zustand.tonies.forEach((t) => {
        t.suchtext = vereinfachen([t.titel, t.reihe, t.kollektion].join(" "));
      });
      filterFuellen();
      zeichnen();
    } catch (fehler) {
      console.error(fehler);
      el.hinweis.textContent = "Die Sammlung konnte gerade nicht geladen werden. Bitte später neu laden.";
    }
  }

  start();
})();
