# Prio-Board

Priorisierungs-Tool für technische IT-Themen als **Zeitachse**:

- **waagrecht = Zeit** in Kalenderwochen ab heute: Die **Länge** eines Balkens ist seine Dauer
- **senkrecht = Priorität**: Bänder Prio 1 (oben, sehr hoch) bis Prio 5
- **Denken** (🧠, Analyse/Konzept) und **Umsetzung** (🔧, direkt machbar) sind klar unterschieden
- **Abhängigkeiten** als Pfeile; Balken liegen frei – ein oranger Pfeil zeigt, wenn etwas vor seinem Vorgänger startet
- **Iteratives Denken**: Denk-Themen in Iterationen, jede mit eigener Dauer und Intensität; eine Umsetzung kann schon nach einer Iteration starten
- **Themen als Rahmen** innerhalb eines Prio-Bands; **Mehrfachauswahl** für gemeinsame Änderungen
- **Wichtigste Denk-Themen**: Hebel (🔓 = wie viele Umsetzungen hängen daran) × Dauer

Reines HTML/CSS/JavaScript ohne Abhängigkeiten.

**Benutzen:** `dist/prio-board.html` öffnen. Das ist eine einzige Datei mit allem drin und funktioniert überall
(auch als Mail-Anhang oder direkt aus dem ZIP).

**Entwickeln:** Der Quellcode liegt modular in `css/` und `js/`. `index.html` lädt diese Dateien direkt
(dafür muss der ganze Ordner entpackt sein). Nach Änderungen die Einzeldatei neu erzeugen:

```bash
node tools/build.mjs
```

## Darstellung

| Element | Bedeutung |
|---|---|
| Balkenlänge | Dauer in Arbeitstagen (Mo–Fr) |
| Voll / dicht / licht schraffiert | intensiv / mittel / nebenbei bzw. reift |
| Gestricheltes Ende | Puffer (Unsicherheit), z. B. „2 Wo (bis 3 Wo)“ |
| ∞ laufend | Denk-Thema läuft nach der Dauer weiter (blockiert danach nichts mehr) |
| Abschnitte im Balken | Iterationen mit eigener Intensität (✓ = erledigt, aufgehellt) |
| Rahmen mit Namen | Thema (Aufgaben eines Themas liegen im Band zusammen) |
| 🔓 n | Hebel: gibt n offene Umsetzungen frei |
| Pfeil grau / gestrichelt | Abhängigkeit zwischen Aufgaben / mit einem Thema (ein Pfeil von Rahmen zu Rahmen) |
| Pfeil orange | Hinweis: startet, bevor der Vorgänger (inkl. Puffer) fertig ist |
| Hover | Orange = wird vorher benötigt, Blau = wird dadurch blockiert |

Steht ein Prio-1-Balken weit rechts, wartet etwas Wichtiges zu lange. Idealerweise ergibt sich eine
Diagonale von oben links nach unten rechts.

## Bedienung

| Aktion | Wirkung |
|---|---|
| Balken waagrecht ziehen | Start frei verschieben (Abhängigkeiten schieben nichts automatisch) |
| Balken senkrecht ziehen | Priorität ändern |
| Strg/⌘ oder Shift + Klick | Balken zur Auswahl hinzufügen / entfernen |
| Shift + Ziehen auf freier Fläche | Auswahlrechteck |
| Ausgewählten Balken ziehen | Alle ausgewählten gemeinsam verschieben |
| Klick auf Rahmen-Namen | Thema öffnen (Farbe, Mitglieder, Abhängigkeiten) |
| Punkt rechts am Rahmen ziehen → in anderem Rahmen loslassen | Abhängigkeit Thema → Thema (ein Pfeil; gilt für alle Aufgaben) |
| Balken-Punkt in einen Rahmen ziehen | Abhängigkeit Aufgabe → Thema |
| Rechte Kante / gestricheltes Ende ziehen | Dauer / Puffer ändern |
| Punkt am Ende ziehen → auf Aufgabe loslassen | Abhängigkeit anlegen |
| Punkt an einer Iterationsgrenze ziehen | „braucht nur bis zu dieser Iteration“ |
| Doppelklick auf freie Fläche | Neue Aufgabe an diesem Tag in diesem Prio-Band |
| Seitenleiste „Details“ | Titel, Art, Status, Priorität, Start, Thema, Dauer/Puffer (mit Schnellwahl), Arbeitsweise, Iterationen, Notizen, Abhängigkeiten. Bei mehreren Aufgaben: Thema, Priorität, Status und Arbeitsweise gemeinsam setzen |
| Seitenleiste „Ablauf“ | Wichtigste Denk-Themen, jetzt startbar, kritischer Pfad, Plan-Ende, Themen |
| Datei ▸ Als HTML | Statische Seite nur mit dem Diagramm (zum Verschicken/Ablegen, druckbar, wieder importierbar) |
| Datei ▸ Export / Import | JSON-Format „prio-board“ (siehe unten) |

Tastatur: **Entf** löschen · **Strg+D** duplizieren · **Strg+A** alle auswählen · **Strg+Z/Y** rückgängig/wiederholen · **Strg+Mausrad** zoomen.

Die Zeitachse beginnt immer **heute**. Was vor heute geplant war, rückt auf heute nach.

Alles wird automatisch im Browser (`localStorage`) gespeichert. Ältere Stände werden beim Start migriert
(mit Hinweis), kleine Schäden repariert. Das Original wird jeweils als `prioBoard.document.backup-…` gesichert.

**Eingebettete Vorschauen** (z. B. in Chat-Apps) blockieren oft Downloads, Browser-Dialoge und Speicher.
Das Tool nutzt deshalb eigene Dialoge, bietet beim Export „In Zwischenablage kopieren“ und beim Import „Einfügen“ an
und zeigt „⚠ Nicht gespeichert“, wenn der Browser-Speicher gesperrt ist.

## Projektstruktur

```
index.html                  Markup + Einbindung der Module (Reihenfolge = Abhängigkeiten)
css/
  theme.css                 Design-Tokens (Farben, Schrift, Radien) – hier das Corporate Design anpassen
  app.css                   Layout der App: Kopfzeile, Seitenleiste, Griffe, Dialoge
js/
  core/
    config.js               Konstanten (Tagesbreite, Bänder, Labels, Standarddauern, Formatversion)
    util.js                 Zustandslose Helfer
    calendar.js             Arbeitstage ↔ Datum, Kalenderwochen, Dauer-Labels
    icons.js                SVG-Icons (Hirn, Schraubenschlüssel)
    ui-state.js             Flüchtiger UI-Zustand (Auswahl, Hover, Tab, Fokus)
  domain/
    model.js                Datenmodell, Startvorschlag für ungeplante Aufgaben, Undo/Redo, Ereignisse
    analysis.js             Kanten, Wellen, Zyklen, startbar, Hebel, kritischer Pfad, Risiken
  io/
    format.js               JSON-Format v3: serialisieren, validieren/reparieren, Migration v2, v1 + Altstände
    storage.js              localStorage (mit Sicherung) + Download
    example.js              Beispiel-Board
    static-export.js        Statische HTML-Seite nur mit dem Diagramm
  render/
    diagram-styles.js       CSS der Zeitachse (gemeinsam für App und HTML-Export)
    layout.js               Geometrie: Bänder, Themen-Abschnitte mit Rahmen, Zeilenverteilung
    board.js                Markup + Live-Ansicht (Zoom, Auswahl, Auswahlrechteck, Hervorhebung)
    sidebar.js              Seitenleiste: Details (einzeln/mehrere), Ablauf, Hilfe
  ui/
    dialog.js               Eigene Dialoge (Bestätigen, Hinweis, Export mit Kopieren, Import mit Einfügen)
    interactions.js         Maus: Ziehen (auch gemeinsam), Mehrfachauswahl, Dauer/Puffer, Verbinden, Pannen, Zoom
  app.js                    Einstieg: verbindet alles, Werkzeugleiste, Tastatur
schema/prio-board.schema.json   JSON-Schema des Austauschformats
examples/beispiel.json          Beispiel-Board als Datei
examples/beispiel-diagramm.html Beispiel für „Als HTML“
tools/build.mjs                 Baut dist/prio-board.html (alles inline)
dist/prio-board.html            Fertige Einzeldatei zum Benutzen und Weitergeben
```

**Datenfluss:** Benutzeraktion → `PB.model` ändert den Zustand → Ereignis →
`app.onModelChange()` → `PB.analysis.analyze()` → `board.render()` + `sidebar.render()` → Speichern.

Die Module sind klassische Skripte im Namensraum `PB` statt ES-Module, weil Browser ES-Module über
`file://` blockieren. So funktioniert das Tool ohne Webserver.

## JSON-Format „prio-board“ (Version 3)

```json
{
  "format": "prio-board",
  "version": 3,
  "exportedAt": "2026-11-02T08:00:00.000Z",
  "board": { "title": "IT-Priorisierung" },
  "view": { "zoom": 1 },
  "themes": [
    { "id": "th-skalierung", "title": "Skalierung", "color": "#7b5ea7" }
  ],
  "tasks": [
    { "id": "t-denken-prozessdaten", "kind": "thinking", "title": "Denken Prozessdaten",
      "description": "", "notes": [], "status": "open",
      "priority": 2, "start": "2026-11-16", "durationDays": 15, "bufferDays": 0,
      "intensity": "focused", "ongoing": false,
      "iterations": [
        { "title": "Level 1", "durationDays": 5, "intensity": "focused", "done": true },
        { "title": "Level 2", "durationDays": 5, "intensity": "medium", "done": false }
      ],
      "theme": "th-skalierung" }
  ],
  "dependencies": [
    { "id": "d-1", "from": "t-denken-prozessdaten", "fromIteration": 0, "to": "t-umsetzung-level1" }
  ],
  "analysis": { "…": "nur im Export, wird beim Import ignoriert" }
}
```

| Feld | Bedeutung |
|---|---|
| `tasks[].kind` | `thinking` = Denken · `implementation` = Umsetzung |
| `tasks[].status` | `open` · `in_progress` · `done` |
| `tasks[].priority` | 1 (sehr hoch, oben) … 5 (sehr tief) |
| `tasks[].start` | Starttag `JJJJ-MM-TT`; Daten vor heute werden auf heute gesetzt. Fehlt er, wird beim Laden einmalig ein Start aus den Abhängigkeiten vorgeschlagen |
| `tasks[].durationDays` | Dauer in Arbeitstagen (5 = 1 Woche); bei Iterationen ist die Summe der Iterationen massgebend |
| `tasks[].bufferDays` | Puffer/Unsicherheit in Arbeitstagen |
| `tasks[].intensity` | `focused` = intensiv · `medium` = mittel · `background` = nebenbei / reift (gilt ohne Iterationen) |
| `tasks[].ongoing` | nur Denken: läuft danach weiter (∞) |
| `tasks[].iterations[]` | nur Denken: Schritte mit Titel, Dauer, Intensität, erledigt |
| `tasks[].theme` | ID des Themas oder `null` (höchstens eines je Aufgabe) |
| `dependencies[]` | `from` muss fertig sein, bevor `to` startet. Beides darf eine Aufgabe oder ein Thema sein (Thema = alle Aufgaben darin). `fromIteration`: Es genügt diese Iteration von `from` |
| `analysis` | Beim Export berechnet: Ende, Welle, Zustand, Hebel und Blocker je Aufgabe, wichtigste Denk-Themen, kritischer Pfad, Plan-Ende. Praktisch für Excel, Power BI usw. |

Dauern sind ganze Arbeitstage statt Wochen, damit keine Kommazahlen entstehen; angezeigt wird „2 Wo 3 T“.

**Migration:** Ältere Dateien und Speicherstände werden beim Import bzw. Start automatisch umgestellt:
- **Version 2 → 3:** Jede Aufgabe behält ihr erstes Thema. Abhängigkeiten weiterer Themen werden direkt auf die
  Aufgabe übertragen, damit nichts verloren geht. Iterationen übernehmen die Intensität der Aufgabe.
- **Version 1 (freies Board) → 3:** Die Priorität kommt aus der x-Position, die Dauer aus den Personentagen
  (1 PT ≈ 1 Arbeitstag), die innerste Gruppe wird zum Thema, und Startdaten werden einmalig aus den Abhängigkeiten vorgeschlagen.

Beim Import wird die Datei vollständig geprüft. Fehler werden gesammelt mit Pfad gemeldet,
z. B. `tasks[2]: "priority" muss eine Zahl zwischen 1 und 5 sein`.

## Anpassen

- **Farben/Schrift:** `css/theme.css`
- **Tagesbreite, Bänder, Standarddauern, Schnellwahl:** `js/core/config.js`
- **Format erweitern:** `C.FORMAT.version` erhöhen, in `format.js` eine Migration ergänzen (wie `migrateV1`),
  Schema anpassen.
