# Meine Tonie-Sammlung

Statische Website, die meine Tonie-Liste aus einem Google Sheet anzeigt: was ich behalte und was ich verkaufe.

- **Daten:** Google Sheet, Tab „Web“, veröffentlicht als CSV. Die Adresse steht in `config.js`.
- **Bilder:** `apps-script/bilder.gs` läuft im Google Sheet und trägt die Produktbilder von tonies.com in die Spalte „Bild-URL“ ein.
- **Prüfseite:** `pruefen.html` zeigt Summen und Sonderfälle, praktisch nach größeren Änderungen im Sheet.
- **Hinzufügen:** `erfassen.html` (passwortgeschützt) sucht Tonies per Text, Foto oder im Netz und schreibt sie über die Web-App in `apps-script/erfassen.gs` ins Sheet. Passwort und API-Schlüssel stehen nur in den Skripteigenschaften des Apps Script, nie in diesem Repository.

| Datei | Aufgabe |
|---|---|
| `index.html` | Seitenstruktur |
| `style.css` | Aussehen |
| `app.js` | Karten, Ansichten, Suche, Filter, Zähler |
| `data.js` | CSV laden und bereinigen (nur erlaubte Spalten) |
| `config.js` | CSV-Adresse |

Kein Build-Schritt, keine Installation. Einzige Abhängigkeit: [PapaParse](https://www.papaparse.com/) per CDN.
