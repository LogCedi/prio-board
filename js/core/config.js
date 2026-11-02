/**
 * Prio-Board – zentrale Konfiguration.
 * Alle Module hängen am globalen Namensraum `PB` (klassische Skripte,
 * damit das Tool auch per Doppelklick über file:// funktioniert).
 */
window.PB = window.PB || {};

PB.config = Object.freeze({
  /* ---------- Zeitachse (x) ---------- */
  /** Breite eines Arbeitstags in Pixeln (1 Woche = 5 Tage). */
  DAY_WIDTH: 28,
  /** Mindestens so viele Arbeitstage werden angezeigt (12 Wochen). */
  MIN_HORIZON_DAYS: 60,
  /** Freier Platz nach dem spätesten Ende (4 Wochen). */
  HORIZON_TAIL_DAYS: 20,

  /* ---------- Prioritätsbänder (y) ---------- */
  PRIORITY_LEVELS: 5,
  PRIORITY_LABELS: ['sehr hoch', 'hoch', 'mittel', 'tief', 'sehr tief'],
  LABEL_WIDTH: 132,
  HEADER_HEIGHT: 50,
  BAR_HEIGHT: 58,
  ROW_GAP: 12,
  BAND_PADDING: 14,
  /** Schmaler als das → Titel steht rechts neben dem Balken. */
  NARROW_BAR: 150,
  /** Platz, der für einen Titel neben einem schmalen Balken reserviert wird. */
  LABEL_RESERVE: 190,

  /* ---------- Inhalte ---------- */
  KIND_LABELS: { thinking: 'Denken', implementation: 'Umsetzung' },
  STATUS_LABELS: { open: 'Offen', in_progress: 'Läuft', done: 'Fertig' },
  INTENSITY_LABELS: { focused: 'Intensiv', background: 'Nebenbei / reift' },
  DEFAULT_TITLES: { thinking: 'Neues Denk-Thema', implementation: 'Neue Umsetzung', theme: 'Neues Thema' },
  DEFAULT_DURATION: { thinking: 10, implementation: 5 },
  DURATION_PRESETS: [
    { label: '1 T', days: 1 },
    { label: '1 Wo', days: 5 },
    { label: '2 Wo', days: 10 },
    { label: '1 Mt', days: 20 },
    { label: '1 Qu', days: 60 },
  ],
  THEME_COLORS: ['#7b5ea7', '#e07a1f', '#2a9d8f', '#c2417a', '#4a6fd1', '#8a9a2b', '#b5651d', '#5c7080'],

  ZOOM: { min: 0.3, max: 2, step: 1.2, fitMin: 0.75 },
  HISTORY_LIMIT: 100,

  /** Dateiformat für Import/Export (siehe schema/prio-board.schema.json). */
  FORMAT: { name: 'prio-board', version: 2 },

  STORAGE_KEY: 'prioBoard.document',
  /** Ältere Speicherstände: v1 hatte „hohe Prio rechts“ und wird gespiegelt. */
  LEGACY_STORAGE: [
    { key: 'prioBoard.v2', mirror: false },
    { key: 'prioBoard.v1', mirror: true },
  ],
});
