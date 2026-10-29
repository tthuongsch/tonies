// Quellen für Rarität und Richtwert. Jede Quelle liefert dasselbe Ergebnis ("Befund"),
// damit mehrere Quellen zusammen einen Richtwert ergeben (ToyTales, Kleinanzeigen).
// Hier wird nichts von einer fremden Seite abgerufen: ausgewertet wird nur Text,
// den du selbst kopiert und eingefügt hast.
(function () {
  // Befund: { raritaet, gebraucht: "17–22", ovp: "20–23", version, quelle, titel, belege: [Sätze, woher die Zahlen kommen] }

  const zahl = (t) => Number(String(t).replace(",", "."));
  const euro = (n) => String(Math.round(n * 100) / 100).replace(".", ",");
  // [17, 22, 17] → "17–22"; [8] → "8"; [] → ""
  function spanne(werte) {
    const z = werte.filter((n) => Number.isFinite(n));
    if (!z.length) return "";
    const min = Math.min(...z), max = Math.max(...z);
    return min === max ? euro(min) : `${euro(min)}–${euro(max)}`;
  }

  // Zustände auf dem ToyTales-Markt; "Ungeöffnet" zählt zu OVP, alles andere zu gebraucht
  const ZUSTAND = /(Ungeöffnet|Ungeoeffnet|Neu|Sehr gut|Gut|Akzeptabel)\s*(ab|bis)\s*(\d+(?:[.,]\d+)?)\s*€/gi;
  const istOvp = (z) => /^(ungeöffnet|ungeoeffnet|neu)$/i.test(z);

  function abschnitt(text, von, bis) {
    const a = text.search(von);
    if (a < 0) return "";
    const rest = text.slice(a);
    const b = rest.slice(1).search(bis);
    return b < 0 ? rest : rest.slice(0, b + 1);
  }

  const toytales = {
    name: "ToyTales",

    // DuckDuckGo: im Test gleich gute Treffer wie Bing, ohne Cookie-Banner (Google zeigte nur Übersichtsseiten)
    suchLink(t) {
      const v = t.version && !/^(original|unbekannt)$/i.test(t.version) ? t.version : "";
      return "https://duckduckgo.com/?q=" + encodeURIComponent(`site:toytales.eu ${t.titel} ${t.reihe} ${v}`.replace(/\s+/g, " ").trim());
    },

    // ToyTales-Kennzeichen → deine Stufen. "Selten" vergibst nur du von Hand.
    raritaetAus(text) {
      const t = String(text || "").toLowerCase();
      if (/keine\s+rarit/.test(t)) return "Normal";
      if (/munkel/.test(t)) return "Munkelität";
      if (/rarit/.test(t)) return "Rarität";
      return "";
    },

    /** Wertet den kopierten Text einer ToyTales-Seite aus (kostenlos, nur Regeln). */
    textLesen(roh) {
      const text = String(roh || "").replace(/\r/g, "");
      const belege = [];
      // Adresse der Seite: steht im kopierten Text (z. B. im Anmelde-Link "redirect=%2Fwiki%2Fde-…")
      let slug = "";
      const r = text.match(/redirect=%2Fwiki%2F([a-z0-9-]+)/i) || text.match(/https:\/\/toytales\.eu\/wiki\/((?:de|en|fr)-[a-z0-9-]+)/i);
      if (r) slug = decodeURIComponent(r[1]).toLowerCase();
      const quelle = slug ? "https://toytales.eu/wiki/" + slug : "";
      // Titel: die Zeile mit der Flagge, z. B. "🇩🇪 Gute Nacht, Gorilla …"
      const titelZeile = (text.match(/^\s*(?:🇩🇪|🇬🇧|🇫🇷|🇺🇸)\s*(.+)$/m) || [])[1] || "";

      // Rarität: Zeile direkt unter "Richtwert" (z. B. "Rarität", "Munkelität", "Keine Rarität"),
      // sonst das Kennzeichen oben ("Auf der Raritätenliste")
      // Der echte Abschnitt "Richtwert" ist der, in dessen Nähe "Gebraucht:" steht (nicht das Inhaltsverzeichnis)
      const richt = abschnitt(text, /^[ \t]*Richtwert[ \t]*\n(?:[^\n]*\n){0,4}?[ \t]*Gebraucht:/im, /^\s*(Inhalte|Tracklist|Rezensionen)\s*$/m)
        || abschnitt(text, /^\s*Richtwert\s*$/m, /^\s*(Inhalte|Tracklist|Rezensionen)\s*$/m);
      const unterRichtwert = (richt.split("\n").map((z) => z.trim()).filter(Boolean)[1]) || "";
      let raritaet = toytales.raritaetAus(unterRichtwert);
      if (!raritaet && titelZeile) raritaet = toytales.raritaetAus((text.split(titelZeile)[0] || "").slice(-200));
      if (raritaet) belege.push(`Rarität: „${unterRichtwert || "Kennzeichen oben"}“ → ${raritaet}`);

      const gebraucht = [], ovp = [];
      const rg = richt.match(/Gebraucht:\s*(\d+(?:[.,]\d+)?)\s*€/i);
      if (rg) { gebraucht.push(zahl(rg[1])); belege.push(`Richtwert gebraucht: ${rg[1]} €`); }
      // OVP-Richtwert gibt es nur mit Premium; wenn er doch im Text steht, zählt er mit
      const ro = richt.match(/OVP:\s*(\d+(?:[.,]\d+)?)\s*€/i);
      if (ro) { ovp.push(zahl(ro[1])); belege.push(`Richtwert OVP: ${ro[1]} €`); }

      // Markt: Angebote ("ab") und Gesuche ("bis") je Zustand
      // Der echte Abschnitt "Markt" ist der, auf den "Angebote" oder "Gesuche" folgt (Groß-/Kleinschreibung egal)
      const markt = abschnitt(text, /^[ \t]*Markt[ \t]*\n(?:[ \t]*\n)*[ \t]*(Angebote|Gesuche)\b/im, /^\s*Richtwert\s*$/m);
      let m;
      ZUSTAND.lastIndex = 0;
      while ((m = ZUSTAND.exec(markt))) {
        const wert = zahl(m[3]);
        const art = m[2].toLowerCase() === "ab" ? "Angebot" : "Gesuch";
        (istOvp(m[1]) ? ovp : gebraucht).push(wert);
        belege.push(`Markt ${m[1]}: ${art} ${m[2]} ${m[3]} €`);
      }

      const v = slug.match(/(neuauflage|relaunch)(?:-(\d{4}))?(?=-|$)/) || titelZeile.match(/\((neuauflage|relaunch)(?:\s+(\d{4}))?\)/i);
      const version = v ? (/relaunch/i.test(v[1]) ? "Relaunch" : "Neuauflage") + (v[2] ? " " + v[2] : "") : "";

      return {
        raritaet, version, quelle, titel: titelZeile.replace(/\s+/g, " ").trim(),
        gebraucht: spanne(gebraucht), ovp: spanne(ovp), belege,
        erkannt: !!(raritaet || gebraucht.length || ovp.length),
      };
    },

    /** Gleiche Zusammenfassung für das, was Claude aus einem Screenshot gelesen hat. */
    ausBild(b) {
      const gebraucht = [], ovp = [], belege = [];
      if (Number.isFinite(b.richtwert_gebraucht)) { gebraucht.push(b.richtwert_gebraucht); belege.push(`Richtwert gebraucht: ${euro(b.richtwert_gebraucht)} €`); }
      if (Number.isFinite(b.richtwert_ovp)) { ovp.push(b.richtwert_ovp); belege.push(`Richtwert OVP: ${euro(b.richtwert_ovp)} €`); }
      (b.markt || []).forEach((e) => {
        if (!Number.isFinite(e.euro)) return;
        (istOvp(e.zustand) ? ovp : gebraucht).push(e.euro);
        belege.push(`Markt ${e.zustand}: ${e.art === "angebot" ? "Angebot ab" : "Gesuch bis"} ${euro(e.euro)} €`);
      });
      const raritaet = toytales.raritaetAus(b.raritaet_text);
      if (raritaet) belege.unshift(`Rarität: „${b.raritaet_text}“ → ${raritaet}`);
      return { raritaet, version: "", quelle: "", titel: String(b.titel || ""), gebraucht: spanne(gebraucht), ovp: spanne(ovp),
        belege, erkannt: !!(raritaet || gebraucht.length || ovp.length) };
    },
  };

  // Kleinanzeigen: Die App ruft dort NIE etwas ab. Sie baut nur den Suchlink, den du selbst öffnest;
  // ausgewertet werden deine Screenshots oder dein eingefügter Text.
  // Das Adressmuster steht nur hier: Kategorie Spielzeug (c23) mit Filter "Versand möglich" (versand_s:ja).
  // {begriff} = Titel + "tonie". Die Reihe lassen wir weg: Kleinanzeigen sucht nach ALLEN Wörtern,
  // "Lieblings-Klassiker" o. Ä. steht in fast keiner Anzeige und würde fast alles ausfiltern.
  const kleinanzeigen = {
    name: "Kleinanzeigen",
    muster: "https://www.kleinanzeigen.de/s-spielzeug/{begriff}/k0c23+spielzeug.versand_s:ja",
    versandImLink: true,
    suchLink(t) {
      // Nur die ersten 3 aussagekräftigen Wörter des Titels: "Gute Nacht, Gorilla und weitere …" → "gute-nacht-gorilla-tonie"
      const fuell = ["und", "weitere", "der", "die", "das", "mit", "von", "den", "dem", "ein", "eine", "the", "and"];
      const woerter = String(t.titel || "").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter((w) => w && fuell.indexOf(w) < 0).slice(0, 3);
      const begriff = woerter.concat(woerter.indexOf("tonie") < 0 ? ["tonie"] : []).join("-");
      return kleinanzeigen.muster.replace("{begriff}", encodeURIComponent(begriff).replace(/%2D/g, "-"));
    },
  };

  // Statistik für die Prüftabelle: Anzahl, Min, Max, Median; Spanne ab 5 Werten aus den Quartilen
  function statistik(werte) {
    const z = werte.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
    if (!z.length) return { anzahl: 0 };
    const q = (p) => { const i = (z.length - 1) * p, u = Math.floor(i), o = Math.ceil(i); return z[u] + (z[o] - z[u]) * (i - u); };
    const s = { anzahl: z.length, min: z[0], max: z[z.length - 1], median: q(0.5) };
    // Quartile auf ganze Euro gerundet, damit die Spanne lesbar bleibt
    s.spanne = z.length >= 5 ? spanne([Math.round(q(0.25)), Math.round(q(0.75))]) : spanne([s.min, s.max]);
    return s;
  }

  // Zustand einer Anzeige → OVP (neu, ungeöffnet, OVP) oder gebraucht
  const istOvpZustand = (z) => /ovp|neu|unge(ö|oe)ffnet|original\s*verpackt|versiegelt/i.test(z || "") && !/wie neu/i.test(z || "");

  /**
   * Ein Vorschlag je Zustand aus allen Quellen: ToyTales-Spanne (Richtwert + Markt) und Median der
   * aufgenommenen Anzeigen. Ergebnis als Spanne vom kleinsten bis zum größten Wert.
   */
  function vorschlag(toytalesSpanne, anzeigenMedian) {
    const zahlen = String(toytalesSpanne || "").replace(/,/g, ".").match(/\d+(?:\.\d+)?/g) || [];
    const werte = zahlen.map(Number);
    if (Number.isFinite(anzeigenMedian)) werte.push(anzeigenMedian);
    return spanne(werte);
  }

  window.Quellen = { toytales, kleinanzeigen, statistik, vorschlag, istOvpZustand, spanne };
})();
