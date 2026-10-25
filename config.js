// Einstellungen der Website. Nur diese Datei musst du für die Live-Anbindung ändern.
window.TONIE_CONFIG = {
  // Adresse der veröffentlichten CSV aus Google Sheets (Tab "Web").
  // Leer lassen, solange nur mit den Testdaten gearbeitet wird.
  csvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRo2T-x48g_fWOo0uY5MK8q27PGFs08HDHWm-5waLGnXmQOkD_jrm6ffFfT_qfhU1yMqN_xpCgN4ARy/pub?gid=1213435380&single=true&output=csv",

  // Testdaten aus der Excel-Datei. Werden genutzt, wenn csvUrl leer ist.
  ersatzUrl: "data/tonies.csv",

  // Adresse der Web-App aus dem Apps Script (für die Seite "Hinzufügen").
  erfassenUrl: "https://script.google.com/macros/s/AKfycbwRS-c5ENhgvAS71gQvaYqlv2MCx_T2RuRxpnGCpACBJNXKdJ6NAEcVQCIYxp26MdhuZw/exec",
};
