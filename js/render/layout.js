/**
 * Geometrie der Zeitachse (reine Berechnung, kein DOM).
 *
 *   x = Arbeitstage ab heute, y = Prioritätsbänder (1 oben).
 *   Jedes Band besteht aus Abschnitten: je ein Abschnitt pro Thema (mit Rahmen, Reihenfolge wie
 *   die Themenliste) und zuletzt einer für Aufgaben ohne Thema. Innerhalb eines Abschnitts liegen
 *   Balken auf Zeilen: bevorzugt auf ihrer gespeicherten Zeile (task.row), bei zeitlicher
 *   Überschneidung auf der nächsten freien darunter. Aufgaben ohne Zeile füllen Lücken auf.
 */
PB.layout = (() => {
  const C = PB.config;
  const model = PB.model;

  const ROW_STEP = C.BAR_HEIGHT + C.ROW_GAP;
  const dayX = (day) => C.LABEL_WIDTH + day * C.DAY_WIDTH;
  const rowsHeight = (rows) => rows * C.BAR_HEIGHT + (rows - 1) * C.ROW_GAP;

  /** Horizontale Ausdehnung eines Balkens inkl. Puffer, ∞ und Platz für einen Titel daneben. */
  function extentOf(task, width) {
    const x = dayX(task.start);
    const w = model.durationOf(task) * C.DAY_WIDTH;
    const bufferWidth = task.bufferDays * C.DAY_WIDTH;
    const narrow = w < C.NARROW_BAR;
    const right = task.ongoing ? width : x + w + bufferWidth + (narrow ? C.LABEL_RESERVE : 0);
    return { x, w, bufferWidth, narrow, right };
  }

  /**
   * Verteilt Aufgaben auf Zeilen. Gespeicherte Zeilen haben Vorrang (in Zeilen-Reihenfolge),
   * leere Zeilen werden am Ende entfernt (Anzeige kompakt, gespeicherte Werte bleiben unberührt).
   */
  /** Zwei Ausdehnungen überschneiden sich (mit halbem Tag Mindestabstand). */
  const extentsOverlap = (a, b) => a.x < b.right + C.DAY_WIDTH / 2 && b.x < a.right + C.DAY_WIDTH / 2;

  /** Würden zwei Aufgaben auf derselben Zeile kollidieren? (gleiche Regel wie beim Verteilen) */
  const collides = (taskA, taskB, width) => extentsOverlap(extentOf(taskA, width), extentOf(taskB, width));

  function packRows(tasks, width) {
    const rows = []; // je Zeile: Liste belegter Ausdehnungen
    const fits = (row, e) => !(rows[row] || []).some((other) => extentsOverlap(e, other));
    const place = (row, e) => {
      while (!fits(row, e)) row++;
      (rows[row] ||= []).push(e);
      return row;
    };
    const byStart = (a, b) => a.start - b.start || a.title.localeCompare(b.title, 'de');
    const fixed = tasks.filter((t) => Number.isInteger(t.row)).sort((a, b) => a.row - b.row || byStart(a, b));
    const free = tasks.filter((t) => !Number.isInteger(t.row)).sort(byStart);

    const placed = [];
    for (const task of fixed) {
      const e = extentOf(task, width);
      placed.push({ id: task.id, ...e, row: place(task.row, e) });
    }
    for (const task of free) {
      const e = extentOf(task, width);
      placed.push({ id: task.id, ...e, row: place(0, e) });
    }
    // Leere Zeilen entfernen
    const used = [...new Set(placed.map((b) => b.row))].sort((a, b) => a - b);
    const compact = new Map(used.map((row, i) => [row, i]));
    placed.forEach((b) => { b.row = compact.get(b.row); });
    return { boxes: placed, rows: Math.max(1, used.length) };
  }

  /** Abschnitte eines Bandes: Themen in der Reihenfolge der Themenliste, danach ohne Thema. */
  function sectionsOf(tasks) {
    const { themes } = model.getState();
    const themed = themes
      .map((th) => ({ themeId: th.id, tasks: tasks.filter((t) => t.theme === th.id) }))
      .filter((s) => s.tasks.length);
    const loose = tasks.filter((t) => !t.theme || !model.getTheme(t.theme));
    return loose.length ? [...themed, { themeId: null, tasks: loose }] : themed;
  }

  /**
   * Komplettes Layout:
   *   { width, height, horizon,
   *     bands    [{ priority, y, height }],
   *     sections [{ priority, themeId, barsTop, rows }],
   *     boxes    Map<taskId, { x, y, w, bufferWidth, narrow, row, priority, themeId }>,
   *     frames   [{ themeId, priority, x, y, width, height }] }
   */
  function compute() {
    const { tasks } = model.getState();
    const latest = tasks.reduce((max, t) => Math.max(max, model.endOf(t) + t.bufferDays), 0);
    const horizon = Math.ceil(Math.max(C.MIN_HORIZON_DAYS, latest + C.HORIZON_TAIL_DAYS) / 5) * 5;
    const width = dayX(horizon);
    const boxes = new Map();
    const bands = [];
    const sections = [];
    const frames = [];
    let y = C.HEADER_HEIGHT;

    for (let priority = 1; priority <= C.PRIORITY_LEVELS; priority++) {
      const bandTop = y;
      let cursor = bandTop + C.BAND_PADDING;

      sectionsOf(tasks.filter((t) => t.priority === priority)).forEach((section, i) => {
        if (i > 0) cursor += C.SECTION_GAP;
        const framed = section.themeId !== null;
        const packed = packRows(section.tasks, width);
        const barsTop = cursor + (framed ? C.FRAME_HEADER : 0);
        for (const box of packed.boxes) {
          box.y = barsTop + box.row * ROW_STEP;
          box.priority = priority;
          box.themeId = section.themeId;
          boxes.set(box.id, box);
        }
        sections.push({ priority, themeId: section.themeId, barsTop, rows: packed.rows });
        const height = (framed ? C.FRAME_HEADER + C.FRAME_PADDING : 0) + rowsHeight(packed.rows);
        if (framed) {
          const left = Math.max(C.LABEL_WIDTH + 2, Math.min(...packed.boxes.map((b) => b.x)) - C.FRAME_PADDING);
          const right = Math.min(width, Math.max(...packed.boxes.map((b) => b.right)) + C.FRAME_PADDING);
          frames.push({ themeId: section.themeId, priority, x: left, y: cursor, width: right - left, height });
        }
        cursor += height;
      });

      const height = Math.max(cursor - bandTop + C.BAND_PADDING, rowsHeight(1) + 2 * C.BAND_PADDING);
      bands.push({ priority, y: bandTop, height });
      y = bandTop + height;
    }
    return { width, height: y, horizon, bands, sections, boxes, frames };
  }

  /** Arbeitstag an einer x-Position (≥ 0). */
  const dayAt = (x) => Math.max(0, Math.floor((x - C.LABEL_WIDTH) / C.DAY_WIDTH));

  /** Prioritätsband an einer y-Position (oberhalb → 1, unterhalb → letztes). */
  function priorityAt(layout, y) {
    const band = layout.bands.find((b) => y < b.y + b.height);
    return band ? band.priority : C.PRIORITY_LEVELS;
  }

  /**
   * Zielzeile für einen Balken, dessen Mitte bei y liegt, im Abschnitt (priority, themeId).
   * Liefert { row, top }: row ∈ [0, rows] (rows = neue Zeile unten), top = y-Position dieser Zeile.
   * Gibt es den Abschnitt im Ziel-Band noch nicht, ist es Zeile 0 eines neuen Abschnitts.
   */
  function slotAt(layout, priority, themeId, y) {
    const section = layout.sections.find((s) => s.priority === priority && s.themeId === themeId);
    if (!section) {
      const band = layout.bands.find((b) => b.priority === priority);
      return { row: 0, top: band.y + C.BAND_PADDING + (themeId ? C.FRAME_HEADER : 0) };
    }
    const row = Math.max(0, Math.min(section.rows, Math.round((y - section.barsTop - C.BAR_HEIGHT / 2) / ROW_STEP)));
    return { row, top: section.barsTop + row * ROW_STEP };
  }

  /** Zeilenzahl eines Abschnitts (0, wenn es ihn nicht gibt). */
  function rowsIn(layout, priority, themeId) {
    return layout.sections.find((s) => s.priority === priority && s.themeId === themeId)?.rows ?? 0;
  }

  return { compute, collides, dayX, dayAt, priorityAt, slotAt, rowsIn };
})();
