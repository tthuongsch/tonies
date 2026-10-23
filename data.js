// Lädt die Tonie-Liste als CSV und macht daraus saubere JavaScript-Objekte.
// Nur die Spalten in SPALTEN werden übernommen; alles andere (z. B. "Prüfen") wird ignoriert.
(function () {
  // Spaltenname im Sheet → Feldname im Code
  const SPALTEN = {
    "Titel": "titel",
    "Reihe": "reihe",
    "Kollektion": "kollektion",
    "Format": "format",
    "Inhalt": "inhalt",
    "Thema": "thema",
    "Anzahl behalten": "behalten",
    "Anzahl verkaufen": "verkaufen",
    "Link": "link",
    "Bild-URL": "bild",
    "Preis (€)": "preis",
    "Zustand": "zustand",
    "Kommentar": "kommentar",
  };

  // Spaltenköpfe tolerant vergleichen: Leerzeichen und Groß-/Kleinschreibung egal.
  const schluessel = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const KOPF_ZU_FELD = Object.fromEntries(
    Object.entries(SPALTEN).map(([kopf, feld]) => [schluessel(kopf), feld])
  );

  // "1", "1,0", "1.0", " 2 " → Zahl; leer oder unlesbar → 0
  function anzahl(wert) {
    const n = parseFloat(String(wert || "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  }

  // "12", "12,50", "12.5 €" → Zahl; leer → null
  function preis(wert) {
    const text = String(wert || "").replace(/[^\d,.-]/g, "").replace(",", ".");
    const n = parseFloat(text);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  // Nur echte Webadressen zulassen, damit kein fremder Inhalt als Link landet.
  function webadresse(wert) {
    const text = String(wert || "").trim();
    return /^https?:\/\//i.test(text) ? text : "";
  }

  // Die Bilder von tonies.com liegen bei Cloudinary in 1920×1080. Für die Karten reicht
  // ein Quadrat mit 600 px: lädt etwa 20-mal weniger Daten, vor allem am Handy spürbar.
  function bildVerkleinern(url) {
    if (!/^https:\/\/res\.cloudinary\.com\/tonies\//.test(url)) return url;
    return url.replace(/\bw_\d+,h_\d+\b/, "w_600,h_600");
  }

  function zuTonie(zeile) {
    const roh = {};
    for (const [kopf, wert] of Object.entries(zeile)) {
      const feld = KOPF_ZU_FELD[schluessel(kopf)];
      if (feld) roh[feld] = String(wert ?? "").trim();
    }
    const t = {
      titel: roh.titel || "",
      reihe: roh.reihe || "",
      kollektion: roh.kollektion || "",
      format: roh.format || "",
      inhalt: roh.inhalt || "",
      thema: roh.thema || "",
      behalten: anzahl(roh.behalten),
      verkaufen: anzahl(roh.verkaufen),
      link: webadresse(roh.link),
      bild: bildVerkleinern(webadresse(roh.bild)),
      preis: preis(roh.preis),
      zustand: roh.zustand || "",
      kommentar: roh.kommentar || "",
    };
    // Ohne Titel und Reihe ist es keine echte Zeile (z. B. eine Leerzeile).
    if (!t.titel && !t.reihe) return null;
    if (!t.titel) t.titel = t.reihe;
    if (!t.reihe) t.reihe = t.titel;
    t.anzahlFehlt = t.behalten === 0 && t.verkaufen === 0;
    return t;
  }

  // Häufiger Fehler beim Kopieren: der Link zur Web-Ansicht (pubhtml) statt zur CSV.
  // Den wandeln wir automatisch in die CSV-Adresse um.
  function csvAdresse(url) {
    if (!/docs\.google\.com\/spreadsheets\//.test(url)) return url;
    const u = new URL(url.replace("/pubhtml", "/pub"));
    u.searchParams.set("output", "csv");
    return u.toString();
  }

  async function laden(url) {
    const antwort = await fetch(csvAdresse(url), { cache: "no-store" });
    if (!antwort.ok) throw new Error(`CSV konnte nicht geladen werden (HTTP ${antwort.status})`);
    const text = await antwort.text();
    const ergebnis = Papa.parse(text, { header: true, skipEmptyLines: "greedy" });
    // Ohne Spalte "Titel" ist es nicht unsere Liste (z. B. falscher Tab oder eine Fehlerseite).
    const koepfe = (ergebnis.meta.fields || []).map(schluessel);
    if (!koepfe.includes(schluessel("Titel"))) {
      throw new Error("Die geladene Datei enthält keine Spalte „Titel“.");
    }
    return ergebnis.data.map(zuTonie).filter(Boolean);
  }

  window.ToniesDaten = { laden, csvAdresse, SPALTEN };
})();
