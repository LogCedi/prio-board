/**
 * Prio-Board – zentrale Konfiguration.
 * Alle Module hängen am globalen Namensraum `PB` (klassische Skripte,
 * damit das Tool auch per Doppelklick über file:// funktioniert).
 */
window.PB = window.PB || {};

PB.config = Object.freeze({
  /** Rasterweite in Pixeln; Positionen und Grössen rasten darauf ein. */
  GRID: 20,

  /** Breite einer Prioritätsspalte. Spalte 1 (links) = höchste Priorität. */
  ZONE_WIDTH: 480,
  PRIORITY_LEVELS: 5,
  PRIORITY_LABELS: ['sehr hoch', 'hoch', 'mittel', 'tief', 'sehr tief'],

  KIND_LABELS: { thinking: 'Denken', implementation: 'Umsetzung' },
  KIND_SUBTITLES: { thinking: 'Denken · Analyse', implementation: 'Umsetzung' },
  STATUS_LABELS: { open: 'Offen', in_progress: 'Läuft', done: 'Fertig' },

  DEFAULT_TITLES: { thinking: 'Neues Denk-Thema', implementation: 'Neue Umsetzung', group: 'Neue Gruppe' },
  DEFAULT_SIZE: {
    thinking: { width: 340, height: 150 },
    implementation: { width: 240, height: 130 },
    group: { width: 560, height: 340 },
  },
  DEFAULT_EFFORT: { thinking: 3, implementation: 1 },
  MIN_SIZE: {
    task: { width: 120, height: 80 },
    group: { width: 200, height: 120 },
  },

  /** fitMin: „Einpassen“ zoomt nie kleiner, damit Text lesbar bleibt (Rest per Scrollen). */
  ZOOM: { min: 0.25, max: 2, step: 1.2, fitMin: 0.7 },
  HISTORY_LIMIT: 100,

  /** Dateiformat für Import/Export (siehe schema/prio-board.schema.json). */
  FORMAT: { name: 'prio-board', version: 1 },

  STORAGE_KEY: 'prioBoard.document',
  /** Ältere Speicherstände: v1 hatte „hohe Prio rechts“ und wird gespiegelt. */
  LEGACY_STORAGE: [
    { key: 'prioBoard.v2', mirror: false },
    { key: 'prioBoard.v1', mirror: true },
  ],
});
