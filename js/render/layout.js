/**
 * Geometrie der Zeitachse (reine Berechnung, kein DOM).
 *
 *   x = Arbeitstage ab heute, y = Prioritätsbänder (1 oben).
 *   Jedes Band besteht aus Abschnitten: je ein Abschnitt pro Thema (mit Rahmen) und
 *   ein Abschnitt für Aufgaben ohne Thema. Innerhalb eines Abschnitts werden Balken
 *   so auf Zeilen verteilt, dass sie sich nicht überlappen.
 */
PB.layout = (() => {
  const C = PB.config;
  const model = PB.model;

  const dayX = (day) => C.LABEL_WIDTH + day * C.DAY_WIDTH;
  const rowsHeight = (rows) => rows * C.BAR_HEIGHT + (rows - 1) * C.ROW_GAP;

  /** Verteilt Aufgaben (nach Start sortiert) auf Zeilen; liefert Boxen und Zeilenzahl. */
  function packRows(tasks, width) {
    const rowEnds = [];
    const boxes = tasks.map((task) => {
      const x = dayX(task.start);
      const w = model.durationOf(task) * C.DAY_WIDTH;
      const bufferWidth = task.bufferDays * C.DAY_WIDTH;
      const narrow = w < C.NARROW_BAR;
      const right = task.ongoing ? width : x + w + bufferWidth + (narrow ? C.LABEL_RESERVE : 0);
      let row = rowEnds.findIndex((end) => end + C.DAY_WIDTH / 2 <= x);
      if (row < 0) row = rowEnds.push(0) - 1;
      rowEnds[row] = right;
      return { id: task.id, x, w, bufferWidth, narrow, row, right };
    });
    return { boxes, rows: Math.max(1, rowEnds.length) };
  }

  /** Abschnitte eines Bandes: Themen (nach frühestem Start), danach Aufgaben ohne Thema. */
  function sectionsOf(tasks) {
    const byTheme = new Map();
    const loose = [];
    for (const task of tasks) {
      if (task.theme && model.getTheme(task.theme)) {
        if (!byTheme.has(task.theme)) byTheme.set(task.theme, []);
        byTheme.get(task.theme).push(task);
      } else {
        loose.push(task);
      }
    }
    const themed = [...byTheme.entries()]
      .map(([themeId, list]) => ({ themeId, tasks: list }))
      .sort((a, b) => a.tasks[0].start - b.tasks[0].start);
    return loose.length ? [...themed, { themeId: null, tasks: loose }] : themed;
  }

  /**
   * Komplettes Layout:
   *   { width, height, horizon, bands[{ priority, y, height }],
   *     boxes Map<taskId, { x, y, w, bufferWidth, narrow }>, frames[{ themeId, x, y, width, height }] }
   */
  function compute() {
    const { tasks } = model.getState();
    const latest = tasks.reduce((max, t) => Math.max(max, model.endOf(t) + t.bufferDays), 0);
    const horizon = Math.ceil(Math.max(C.MIN_HORIZON_DAYS, latest + C.HORIZON_TAIL_DAYS) / 5) * 5;
    const width = dayX(horizon);
    const boxes = new Map();
    const bands = [];
    const frames = [];
    let y = C.HEADER_HEIGHT;

    for (let priority = 1; priority <= C.PRIORITY_LEVELS; priority++) {
      const bandTasks = tasks
        .filter((t) => t.priority === priority)
        .sort((a, b) => a.start - b.start || a.title.localeCompare(b.title, 'de'));
      const bandTop = y;
      let cursor = bandTop + C.BAND_PADDING;

      sectionsOf(bandTasks).forEach((section, i) => {
        if (i > 0) cursor += C.SECTION_GAP;
        const framed = section.themeId !== null;
        const packed = packRows(section.tasks, width);
        const barsTop = cursor + (framed ? C.FRAME_HEADER : 0);
        for (const box of packed.boxes) {
          box.y = barsTop + box.row * (C.BAR_HEIGHT + C.ROW_GAP);
          boxes.set(box.id, box);
        }
        const height = (framed ? C.FRAME_HEADER + C.FRAME_PADDING : 0) + rowsHeight(packed.rows);
        if (framed) {
          const left = Math.max(C.LABEL_WIDTH + 2, Math.min(...packed.boxes.map((b) => b.x)) - C.FRAME_PADDING);
          const right = Math.min(width, Math.max(...packed.boxes.map((b) => b.right)) + C.FRAME_PADDING);
          frames.push({ themeId: section.themeId, x: left, y: cursor, width: right - left, height });
        }
        cursor += height;
      });

      const height = Math.max(cursor - bandTop + C.BAND_PADDING, rowsHeight(1) + 2 * C.BAND_PADDING);
      bands.push({ priority, y: bandTop, height });
      y = bandTop + height;
    }
    return { width, height: y, horizon, bands, boxes, frames };
  }

  /** Arbeitstag an einer x-Position (≥ 0). */
  const dayAt = (x) => Math.max(0, Math.floor((x - C.LABEL_WIDTH) / C.DAY_WIDTH));

  /** Prioritätsband an einer y-Position (oberhalb → 1, unterhalb → letztes). */
  function priorityAt(layout, y) {
    const band = layout.bands.find((b) => y < b.y + b.height);
    return band ? band.priority : C.PRIORITY_LEVELS;
  }

  return { compute, dayX, dayAt, priorityAt };
})();
