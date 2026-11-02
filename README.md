# Prio-Board

Visuelles Priorisierungs-Tool für technische IT-Themen: Blöcke für **Denken** (Analyse, braucht Zeit)
und **Umsetzung** (direkt machbar), Gruppen als Abhängigkeitsblöcke, Pfeile für Abhängigkeiten.
Das Tool zeigt, was **jetzt parallel** startbar ist (Wellen), was blockiert ist und den **kritischen Pfad**.

Reines HTML/CSS/JavaScript ohne Abhängigkeiten.

**Benutzen:** `dist/prio-board.html` öffnen – eine einzige Datei mit allem drin, funktioniert überall
(auch als Mail-Anhang oder direkt aus dem ZIP).

**Entwickeln:** Quellcode liegt modular in `css/` und `js/`. `index.html` lädt diese Dateien direkt
(dafür muss der ganze Ordner entpackt sein). Nach Änderungen die Einzeldatei neu erzeugen:

```bash
node tools/build.mjs
```

## Funktionen

| Bereich | Was |
|---|---|
| Board | Blöcke anlegen, verschieben, Grösse ändern, Gruppen (Rahmen) bilden |
| Abhängigkeiten | Am runden Punkt rechts ziehen → auf den abhängigen Block loslassen |
| Priorität | Ergibt sich aus der horizontalen Position: links hoch (Prio 1) → rechts tief (Prio 5) |
| Ablauf | Wellen paralleler Arbeit, offener Aufwand Denken/Umsetzung, kritischer Pfad |
| Hover | Orange = wird vorher benötigt, Blau = wird dadurch blockiert |
| Datei ▸ Als HTML | Statische Seite nur mit dem Diagramm (zum Verschicken/Ablegen, druckbar) |
| Datei ▸ Export/Import | JSON-Format „prio-board“ (siehe unten); Import nimmt auch exportierte HTML-Seiten |

Alles wird automatisch im Browser (`localStorage`) gespeichert. Ältere Speicherstände werden beim Start migriert;
kleine Schäden werden repariert (Original wird als `prioBoard.document.backup-…` gesichert), nie stillschweigend verworfen.

**Eingebettete Vorschauen** (z. B. in Chat-Apps) blockieren oft Downloads, Browser-Dialoge und Speicher.
Das Tool nutzt deshalb eigene Dialoge, bietet beim Export „In Zwischenablage kopieren“ und beim Import „Einfügen“ an
und zeigt „⚠ Nicht gespeichert“, wenn der Browser-Speicher gesperrt ist.

## Projektstruktur

```
index.html                  Markup + Einbindung der Module (Reihenfolge = Abhängigkeiten)
css/
  theme.css                 Design-Tokens (Farben, Schrift, Radien) – hier das Corporate Design anpassen
  app.css                   Layout der App: Kopfzeile, Seitenleiste, Interaktionszustände
js/
  core/
    config.js               Konstanten (Raster, Prioritätsspalten, Labels, Formatversion, Speicher-Keys)
    util.js                 Zustandslose Helfer (Escaping, Geometrie, Zahlen)
    icons.js                SVG-Icons (Hirn, Schraubenschlüssel, Gruppe)
    ui-state.js             Flüchtiger UI-Zustand (Auswahl, Hover, Tab, Fokus)
  domain/
    model.js                Datenmodell: Zustand, Abfragen, Änderungen, Undo/Redo, Ereignisse
    analysis.js             Abhängigkeitsanalyse: Wellen, Zyklen, startbar, kritischer Pfad
  io/
    format.js               JSON-Format: serialisieren, validieren, migrieren
    storage.js              localStorage + Datei-Download/-Upload
    example.js              Beispiel-Board (identisch mit examples/beispiel.json)
    static-export.js        Statische HTML-Seite nur mit dem Diagramm
  render/
    diagram-styles.js       CSS des Diagramms (gemeinsam für App und HTML-Export)
    board.js                Diagramm-Markup + Live-Board (Zoom, Auswahl, Hervorhebung)
    sidebar.js              Seitenleiste: Details, Ablauf, Hilfe
  ui/
    dialog.js               Eigene Dialoge (Bestätigen, Hinweis, Export mit Kopieren, Import mit Einfügen)
    interactions.js         Maus: Ziehen, Grösse, Verbinden, Pannen, Zoom
  app.js                    Einstieg: verbindet alles, Werkzeugleiste, Tastatur
schema/prio-board.schema.json   JSON-Schema des Austauschformats
tools/build.mjs                 Baut dist/prio-board.html (alles inline)
dist/prio-board.html            Fertige Einzeldatei zum Benutzen und Weitergeben
examples/beispiel.json          Beispiel-Board als Datei
```

**Datenfluss:** Benutzeraktion → `PB.model` ändert den Zustand → Ereignis → `app.onModelChange()`
→ `PB.analysis.analyze()` → `board.render()` + `sidebar.render()` → Speichern.

Die Module sind klassische Skripte im Namensraum `PB` statt ES-Module, weil Browser ES-Module über
`file://` blockieren. So funktioniert das Tool ohne Webserver.

## JSON-Format „prio-board“ (Version 1)

```json
{
  "format": "prio-board",
  "version": 1,
  "exportedAt": "2026-11-02T08:00:00.000Z",
  "board": { "title": "IT-Priorisierung" },
  "view": { "zoom": 1, "showPriorityAxis": true },
  "groups": [
    { "id": "g-skalierung", "title": "Skalierung", "description": "",
      "layout": { "x": 920, "y": 120, "width": 920, "height": 520 } }
  ],
  "tasks": [
    { "id": "t-denken-harness", "kind": "thinking", "title": "Denken Harness",
      "description": "", "notes": ["Skills", "Workflow", "Sprache"],
      "status": "open", "effortDays": 5,
      "layout": { "x": 980, "y": 180, "width": 540, "height": 180 } }
  ],
  "dependencies": [
    { "id": "d-harness", "from": "t-denken-harness", "to": "t-umsetzung-harness" }
  ],
  "analysis": { "…": "nur im Export, wird beim Import ignoriert" }
}
```

| Feld | Bedeutung |
|---|---|
| `tasks[].kind` | `thinking` = Denken · `implementation` = Umsetzung |
| `tasks[].status` | `open` · `in_progress` · `done` |
| `tasks[].effortDays` | Aufwand in Personentagen (`null` = unbekannt, zählt als 1) |
| `tasks[].notes` | Stichpunkte, je ein String |
| `layout` | Position/Grösse in px. `x` bestimmt die Priorität (Spalten à 480 px, links = hoch) |
| `dependencies[]` | `from` muss fertig sein, bevor `to` startet. Beides darf eine Aufgabe oder Gruppe sein |
| Gruppen | Zugehörigkeit wird **nicht gespeichert**, sondern aus dem Layout abgeleitet (kleinste Gruppe, die den Mittelpunkt enthält). Eine Abhängigkeit auf eine Gruppe gilt für alle Aufgaben darin |
| `analysis` | Beim Export berechnet: Priorität, Gruppe, Welle, Zustand und Blocker je Aufgabe, Wellen, kritischer Pfad. Praktisch für Auswertungen in Excel, Power BI usw. |

Beim Import wird die Datei vollständig geprüft. Fehler werden gesammelt mit Pfad gemeldet,
z. B. `tasks[2]: "kind" muss "thinking" oder "implementation" sein`.
Das vollständige Schema liegt in `schema/prio-board.schema.json`.

## Anpassen

- **Farben/Schrift:** `css/theme.css`
- **Prioritätsstufen, Spaltenbreite, Standardgrössen:** `js/core/config.js`
- **Format erweitern:** `C.FORMAT.version` erhöhen, in `format.js` die ältere Version in `normalize()` migrieren,
  Schema anpassen.
