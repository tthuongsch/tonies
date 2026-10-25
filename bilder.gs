/**
 * Trägt für jeden Tonie das Produktbild in die Spalte "Bild-URL" ein.
 *
 * So funktioniert es: Das Skript öffnet den Link jeder Zeile, deren "Bild-URL" noch
 * leer ist, und liest dort das Vorschaubild (og:image) aus. Das klappt bei tonies.com
 * und bei den meisten anderen Seiten. Ausgefüllte Zellen werden nie überschrieben.
 * Ein selbst eingetragenes Bild bleibt also erhalten.
 *
 * Einrichtung: siehe PLAN.md, Abschnitt "Apps Script für Bilder".
 */

const BLATT = "Tonies";
const SPALTE_LINK = "Link";
const SPALTE_BILD = "Bild-URL";
const PRO_DURCHLAUF = 40; // begrenzt, damit ein Durchlauf sicher unter Googles Zeitlimit bleibt

/** Fügt beim Öffnen des Sheets das Menü "Tonies" hinzu. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Tonies")
    .addItem("Bilder nachtragen", "bilderNachtragen")
    .addItem("Katalog von tonies.com aktualisieren", "katalogAktualisieren")
    .addItem("Automatik einschalten", "automatikEinschalten")
    .addToUi();
}

/** Sucht Zeilen mit Link, aber ohne Bild, und trägt das Bild ein. */
function bilderNachtragen() {
  const sheet = SpreadsheetApp.getActive();
  const blatt = sheet.getSheetByName(BLATT);
  if (!blatt) throw new Error(`Tab "${BLATT}" nicht gefunden.`);

  const werte = blatt.getDataRange().getValues();
  const kopf = werte[0].map((k) => String(k).trim());
  const spLink = kopf.indexOf(SPALTE_LINK);
  const spBild = kopf.indexOf(SPALTE_BILD);
  if (spLink < 0 || spBild < 0) {
    throw new Error(`Spalten "${SPALTE_LINK}" und "${SPALTE_BILD}" müssen in Zeile 1 stehen.`);
  }

  // Nur echte Webadressen (https), keine anderen Einträge.
  const offen = [];
  for (let i = 1; i < werte.length; i++) {
    const link = String(werte[i][spLink]).trim();
    const bild = String(werte[i][spBild]).trim();
    if (!bild && /^https:\/\//i.test(link)) {
      offen.push({ zeile: i + 1, link: link });
    }
  }

  const stapel = offen.slice(0, PRO_DURCHLAUF);
  // fetchAll ruft alle Seiten gleichzeitig ab. Das ist viel schneller als nacheinander.
  const antworten = UrlFetchApp.fetchAll(stapel.map((o) => ({
    url: o.link,
    muteHttpExceptions: true,
    followRedirects: true,
    headers: { "User-Agent": "Mozilla/5.0 (Tonie-Sammlung)" },
  })));

  let eingetragen = 0;
  antworten.forEach((antwort, j) => {
    if (antwort.getResponseCode() !== 200) return;
    const url = ogImage(antwort.getContentText());
    if (url) {
      blatt.getRange(stapel[j].zeile, spBild + 1).setValue(url);
      eingetragen++;
    }
  });

  const rest = offen.length - stapel.length;
  sheet.toast(
    `${eingetragen} von ${stapel.length} Bildern eingetragen.` +
      (rest > 0 ? ` ${rest} weitere folgen beim nächsten Durchlauf.` : ""),
    "Tonie-Bilder"
  );
}

/** Liest die Adresse des Vorschaubilds aus dem HTML einer Seite. */
function ogImage(html) {
  // Das Attribut "content" kann vor oder hinter "property" stehen.
  const treffer =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (!treffer) return "";
  const url = treffer[1].replace(/&amp;/g, "&");
  return /^https:\/\//i.test(url) ? url : "";
}

/** Legt die Zeitpläne an: Bilder stündlich, Katalog täglich (nur einmal nötig). */
function automatikEinschalten() {
  const vorhanden = ScriptApp.getProjectTriggers().map((t) => t.getHandlerFunction());
  if (vorhanden.indexOf("bilderNachtragen") < 0) {
    ScriptApp.newTrigger("bilderNachtragen").timeBased().everyHours(1).create();
  }
  if (vorhanden.indexOf("katalogAktualisieren") < 0) {
    ScriptApp.newTrigger("katalogAktualisieren").timeBased().everyDays(1).atHour(4).create();
  }
  SpreadsheetApp.getActive().toast(
    "Bilder werden stündlich nachgetragen, der Katalog täglich gegen 4 Uhr aktualisiert.", "Tonie-Automatik");
}
