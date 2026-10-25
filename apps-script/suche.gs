// Tolerante Suche für Tonies – ohne Abhängigkeiten.
// Läuft im Browser (window.TonieSuche) und, als Kopie apps-script/suche.gs, im Apps Script.
//
// Was sie verzeiht:
//  - Groß-/Kleinschreibung, Umlaute (ä = a = ae), ß = ss, Satzzeichen
//  - ähnliche Schreibweisen (Connie = Conni, Pinokio = Pinocchio)
//  - Tippfehler (Bibi Blocksbeg) und angefangene Wörter (kokos, pika)
//  - beliebige Reihenfolge der Wörter
var TonieSuche = (function () {
  // Felder und wie stark ein Treffer darin zählt (Titel am wichtigsten).
  var STANDARD_FELDER = [["titel", 3], ["reihe", 2.5], ["kollektion", 1.5], ["untertitel", 1.5], ["thema", 1]];

  /** Ein Wort auf seine "Grundform" bringen, damit ähnliche Schreibweisen gleich werden. */
  function grundform(wort) {
    return wort
      .replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u")
      .replace(/ph/g, "f").replace(/th/g, "t")
      .replace(/cch/g, "k").replace(/ck/g, "k").replace(/c(?!h)/g, "k")
      .replace(/y/g, "i")
      .replace(/ie$/, "i")
      .replace(/(.)\1+/g, "$1"); // doppelte Buchstaben zusammenziehen
  }

  /** Text → Liste von Wörtern in Grundform. */
  function woerter(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/\?\?\?/g, " fragezeichen ") // "Die drei ???"
      .replace(/ß/g, "ss")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .map(grundform)
      .filter(Boolean);
  }

  /** Damerau-Levenshtein-Abstand (Tippfehler: falscher, fehlender, zusätzlicher oder vertauschter Buchstabe). */
  function abstand(a, b, grenze) {
    if (Math.abs(a.length - b.length) > grenze) return grenze + 1;
    var d = [];
    for (var i = 0; i <= a.length; i++) { d[i] = [i]; }
    for (var j = 0; j <= b.length; j++) { d[0][j] = j; }
    for (i = 1; i <= a.length; i++) {
      var zeilenMin = Infinity;
      for (j = 1; j <= b.length; j++) {
        var kosten = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + kosten);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
        zeilenMin = Math.min(zeilenMin, d[i][j]);
      }
      if (zeilenMin > grenze) return grenze + 1; // früh aufhören, spart Zeit
    }
    return d[a.length][b.length];
  }

  function erlaubteFehler(wort) {
    return wort.length >= 7 ? 2 : wort.length >= 4 ? 1 : 0;
  }

  /** Wie gut passt ein Suchwort zu einem Wort des Eintrags? 0 = gar nicht. */
  function wortPunkte(such, wort) {
    if (wort === such) return 10;
    if (such.length >= 2 && wort.indexOf(such) === 0) return 8;       // angefangenes Wort
    if (such.length >= 3 && wort.indexOf(such) > 0) return 5;         // Teil eines Worts
    var fehler = erlaubteFehler(such);
    if (!fehler) return 0;
    if (abstand(such, wort, fehler) <= fehler) return 4;               // Tippfehler
    // Tippfehler in einem angefangenen Wort ("blocksbe" für "blocksberg")
    if (wort.length > such.length && abstand(such, wort.slice(0, such.length), fehler) <= fehler) return 3;
    return 0;
  }

  /** Bereitet einen Eintrag einmal vor (Wörter je Feld), damit das Suchen schnell bleibt. */
  function vorbereiten(eintrag, felder) {
    felder = felder || STANDARD_FELDER;
    var liste = [];
    felder.forEach(function (f) {
      woerter(eintrag[f[0]]).forEach(function (w) { liste.push({ wort: w, feld: f[0], gewicht: f[1] }); });
    });
    return liste;
  }

  /**
   * Durchsucht Einträge. optionen:
   *  - felder: [[feldname, gewicht], …]
   *  - modus: "und" (jedes Suchwort muss passen, Standard) oder "oder" (je mehr, desto besser)
   *  - max: höchstens so viele Ergebnisse
   * Ergebnis: [{ eintrag, punkte }], beste zuerst.
   */
  function suchen(eintraege, anfrage, optionen) {
    optionen = optionen || {};
    var suchWoerter = woerter(anfrage);
    if (!suchWoerter.length) return [];
    var felder = optionen.felder || STANDARD_FELDER;
    var schluessel = "_such_" + felder.map(function (f) { return f[0]; }).join("_");
    var oder = optionen.modus === "oder";
    var ergebnis = [];

    eintraege.forEach(function (e) {
      if (!e[schluessel]) {
        Object.defineProperty(e, schluessel, { value: vorbereiten(e, felder), enumerable: false });
      }
      var wortListe = e[schluessel];
      var summe = 0;
      var gefunden = 0;
      var unscharf = false; // brauchte mindestens ein Wort die Tippfehler-Toleranz?
      var roh = [];         // je Suchwort: beste Trefferart (10 ganzes Wort, 8 Anfang, 5 Teil, ≤4 Tippfehler)
      for (var i = 0; i < suchWoerter.length; i++) {
        var beste = 0;
        var besteRoh = 0;
        for (var k = 0; k < wortListe.length; k++) {
          var p = wortPunkte(suchWoerter[i], wortListe[k].wort);
          if (p && p * wortListe[k].gewicht > beste) beste = p * wortListe[k].gewicht;
          if (p > besteRoh) besteRoh = p;
        }
        roh.push(besteRoh);
        if (beste) { summe += beste; gefunden++; if (besteRoh <= 4) unscharf = true; } else if (!oder) return;
      }
      if (!gefunden) return;
      ergebnis.push({ eintrag: e, punkte: summe + (oder ? gefunden * 5 : 0), unscharf: unscharf, roh: roh });
    });

    // Tippfehler-Treffer nur, wenn es keine genauen gibt: "pika" soll Pikachu finden, nicht "Pizza".
    if (!oder && ergebnis.some(function (r) { return !r.unscharf; })) {
      ergebnis = ergebnis.filter(function (r) { return !r.unscharf; });
    }
    // Gibt es ein Suchwort irgendwo als ganzes Wort, zählen dafür keine bloßen Wortanfänge:
    // "Connie" (= Conni) soll nicht "König" finden, "kokos" (kein ganzes Wort) aber "Kokosnuss".
    if (!oder) {
      suchWoerter.forEach(function (w, i) {
        if (ergebnis.some(function (r) { return r.roh[i] === 10; })) {
          ergebnis = ergebnis.filter(function (r) { return r.roh[i] === 10; });
        }
      });
    }

    ergebnis.sort(function (a, b) {
      return b.punkte - a.punkte ||
        String(a.eintrag.titel || "").localeCompare(String(b.eintrag.titel || ""), "de");
    });
    return optionen.max ? ergebnis.slice(0, optionen.max) : ergebnis;
  }

  /**
   * Markiert die passenden Wörter in einem Text mit <mark>.
   * esc: Funktion zum sicheren Einsetzen von Text in HTML.
   */
  function markieren(text, anfrage, esc) {
    var suchWoerter = woerter(anfrage);
    text = String(text || "");
    if (!suchWoerter.length) return esc(text);
    return text.split(/([^\p{L}\p{N}]+)/u).map(function (teil) {
      var w = woerter(teil);
      var passt = w.length && suchWoerter.some(function (s) {
        return w.some(function (x) { return wortPunkte(s, x) > 0; });
      });
      return passt ? "<mark>" + esc(teil) + "</mark>" : esc(teil);
    }).join("");
  }

  return { suchen: suchen, markieren: markieren, woerter: woerter, wortPunkte: wortPunkte, abstand: abstand };
})();
