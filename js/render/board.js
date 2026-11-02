/**
 * Darstellung der Zeitachse.
 *   x = Arbeitstage ab heute (Kalenderwochen im Kopf), y = Prioritätsbänder (1 oben).
 *   Innerhalb eines Bandes werden Balken automatisch auf Zeilen verteilt (keine Überlappung).
 *
 *  - layout()/markup(): reine Berechnung bzw. HTML/SVG – auch für den statischen Export.
 *  - render() & Co.: Live-Board mit Zoom, Auswahl, Hervorhebungen.
 */
PB.board = (() => {
  const C = PB.config;
  const U = PB.util;
  const I = PB.icons;
  const CAL = PB.calendar;
  const A = PB.analysis;
  const model = PB.model;
  const ui = PB.ui;
  const esc = U.escapeHtml;

  let dom = null;
  let analysis = null;
  let current = null; // letztes Layout (für Koordinaten-Umrechnung)

  /* =====================================================================
   * Layout (zustandslos)
   * ===================================================================== */

  const dayX = (day) => C.LABEL_WIDTH + day * C.DAY_WIDTH;

  /** Positionen aller Balken, Bänder und die Gesamtgrösse. */
  function layout() {
    const { tasks } = model.getState();
    const latest = tasks.reduce((max, t) => Math.max(max, model.endOf(t) + t.bufferDays), 0);
    const horizon = Math.ceil(Math.max(C.MIN_HORIZON_DAYS, latest + C.HORIZON_TAIL_DAYS) / 5) * 5;
    const width = dayX(horizon);
    const boxes = new Map();
    const bands = [];
    let y = C.HEADER_HEIGHT;

    for (let priority = 1; priority <= C.PRIORITY_LEVELS; priority++) {
      const list = tasks
        .filter((t) => t.priority === priority)
        .sort((a, b) => a.start - b.start || a.title.localeCompare(b.title, 'de'));
      const rowEnds = [];
      const placed = [];
      for (const task of list) {
        const x = dayX(task.start);
        const w = model.durationOf(task) * C.DAY_WIDTH;
        const bufferWidth = task.bufferDays * C.DAY_WIDTH;
        const narrow = w < C.NARROW_BAR;
        const occupiedUntil = task.ongoing ? width : x + w + bufferWidth + (narrow ? C.LABEL_RESERVE : 0);
        let row = rowEnds.findIndex((end) => end + C.DAY_WIDTH / 2 <= x);
        if (row < 0) row = rowEnds.push(0) - 1;
        rowEnds[row] = occupiedUntil;
        placed.push({ id: task.id, x, w, bufferWidth, narrow, row });
      }
      const rows = Math.max(1, rowEnds.length);
      const height = rows * C.BAR_HEIGHT + (rows - 1) * C.ROW_GAP + 2 * C.BAND_PADDING;
      for (const box of placed) {
        box.y = y + C.BAND_PADDING + box.row * (C.BAR_HEIGHT + C.ROW_GAP);
        boxes.set(box.id, box);
      }
      bands.push({ priority, y, height });
      y += height;
    }
    return { width, height: y, horizon, bands, boxes };
  }

  /* =====================================================================
   * Markup (zustandslos)
   * ===================================================================== */

  function gridHtml(L) {
    const weeks = CAL.weeks(L.horizon);
    const columns = weeks.map((w, i) => {
      const x = dayX(w.day);
      const nextX = i + 1 < weeks.length ? dayX(weeks[i + 1].day) : L.width;
      const label = i === 0 ? `Heute · KW ${w.week}` : `KW ${w.week}`;
      return `<div class="tl-week${i % 2 ? ' alt' : ''}${i === 0 ? ' today' : ''}" style="left:${x}px;width:${nextX - x}px;height:${L.height}px">
        <div class="tl-week-label"><b>${label}</b>${CAL.shortDate(w.date)}</div></div>`;
    }).join('');
    const bands = L.bands.map((b, i) => `<div class="tl-band${i % 2 ? ' alt' : ''}" style="top:${b.y}px;height:${b.height}px;width:${L.width}px">
        <div class="tl-band-label"><b>Prio ${b.priority}</b><span>${C.PRIORITY_LABELS[b.priority - 1]}</span></div></div>`).join('');
    return `<div class="tl-days"></div>${columns}${bands}
      <div class="tl-corner"><b>Prio ↓</b><br>Zeit →</div><div class="tl-today"></div>`;
  }

  function statusBadge(task, a) {
    const state = a.stateOf(task.id);
    const text = {
      done: '✓ fertig',
      cycle: '⟳ Zyklus',
      in_progress: '● läuft',
      ready: '▶ startbar',
      waiting: `⏸ wartet auf ${a.openPredecessors(task.id).length}`,
    }[state];
    return `<span class="badge ${state}">${text}</span>`;
  }

  function barHtml(task, box, a, L, interactive) {
    const duration = model.durationOf(task);
    const themes = task.themes.map(model.getTheme).filter(Boolean);
    const leverage = a.leverage.get(task.id);
    const classes = ['bar', task.kind, `int-${task.intensity}`, `st-${task.status}`,
      box.narrow && 'narrow', task.iterations.length && 'has-iterations', task.ongoing && 'ongoing'].filter(Boolean).join(' ');
    const style = `left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${C.BAR_HEIGHT}px;--buf:${box.bufferWidth}px`;

    const durationText = CAL.durationLabel(duration) + (task.bufferDays ? ` (bis ${CAL.durationLabel(duration + task.bufferDays)})` : '');
    const meta = [
      statusBadge(task, a),
      `<span>${durationText}</span>`,
      leverage ? `<span class="lev" title="Gibt ${leverage} Umsetzung(en) frei">🔓 ${leverage}</span>` : '',
    ].join('');

    const stripe = themes.length
      ? `<div class="bar-themes">${themes.map((th) => `<span style="background:${th.color}" title="Thema: ${esc(th.title)}"></span>`).join('')}</div>`
      : '';
    const iterations = task.iterations.length
      ? `<div class="bar-iterations">${task.iterations.map((it) =>
        `<div class="iter-seg${it.done ? ' done' : ''}" style="width:${it.durationDays * C.DAY_WIDTH}px" title="${esc(it.title)} · ${CAL.durationLabel(it.durationDays)}${it.done ? ' · erledigt' : ''}">${esc(it.title)}${it.done ? ' ✓' : ''}</div>`).join('')}</div>`
      : '';
    const buffer = task.bufferDays
      ? `<div class="bar-buffer" style="width:${box.bufferWidth}px" title="Puffer ${CAL.durationLabel(task.bufferDays)}"></div>`
      : '';
    const ongoing = task.ongoing
      ? `<div class="bar-ongoing" style="width:${Math.max(0, L.width - box.x - box.w - box.bufferWidth)}px" title="Läuft danach weiter"><span>∞ laufend</span></div>`
      : '';

    const tooltip = [task.title, `${CAL.longDate(CAL.dateOf(task.start))} – ${CAL.longDate(CAL.dateOf(model.endOf(task)))}`,
      ...task.notes.map((n) => `• ${n}`), task.description].filter(Boolean).join('\n');

    return `<div class="${classes}" data-id="${esc(task.id)}" style="${style}" title="${esc(tooltip)}">
      ${stripe}${buffer}${ongoing}
      <div class="bar-body"><span class="tico">${I.forKind(task.kind)}</span>
        <div class="bar-text"><div class="title">${esc(task.title)}</div><div class="meta">${meta}</div></div></div>
      ${iterations}
      ${interactive ? handlesHtml(task, box) : ''}
    </div>`;
  }

  function handlesHtml(task, box) {
    let offset = 0;
    const iterationPorts = task.iterations.slice(0, -1).map((it, i) => {
      offset += it.durationDays * C.DAY_WIDTH;
      return `<div class="port it" data-iteration="${i}" style="left:${offset - 7}px" title="Ziehen: Abhängigkeit ab „${esc(it.title)}“"></div>`;
    }).join('');
    const bufferHandle = task.bufferDays
      ? `<div class="rs buf" style="left:calc(100% + ${box.bufferWidth}px - 5px)" title="Puffer ändern"></div>` : '';
    return `<div class="rs dur" title="Dauer ändern"></div>${bufferHandle}${iterationPorts}
      <div class="port end" title="Ziehen: Pfeil zu einer Aufgabe, die hiervon abhängt"></div>`;
  }

  /** Waagrechte Kurve vom Ende des Vorgängers zum Anfang des Nachfolgers. */
  function linkPath(x1, y1, x2, y2) {
    const k = Math.max(30, Math.abs(x2 - x1) / 2);
    return `M${x1},${y1} C${x1 + k},${y1} ${x2 - k},${y2} ${x2 - 2},${y2}`;
  }

  /**
   * Themen-Abhängigkeiten nur dort zeichnen, wo sie im Thema „ankommen“ bzw. es „verlassen“:
   * Mitglieder mit einem Vorgänger (bzw. Nachfolger) im selben Thema hängen ohnehin indirekt daran.
   */
  function isVisibleEdge(e, a) {
    if (!e.viaTheme) return true;
    const dep = model.getDependency(e.depId);
    const inTheme = (themeId, other) => model.isTheme(themeId) && model.membersOf(themeId).includes(other);
    const hasPredInTheme = [...a.predecessors.get(e.to)].some((p) => inTheme(dep.to, p));
    const hasSuccInTheme = [...a.successors.get(e.from)].some((s) => inTheme(dep.from, s));
    return !(model.isTheme(dep.to) && hasPredInTheme) && !(model.isTheme(dep.from) && hasSuccInTheme);
  }

  function linksHtml(a, L) {
    const mid = C.BAR_HEIGHT / 2;
    return a.edges.filter((e) => isVisibleEdge(e, a)).map((e) => {
      const from = model.getTask(e.from);
      const fromBox = L.boxes.get(e.from);
      const toBox = L.boxes.get(e.to);
      if (!fromBox || !toBox) return '';
      const x1 = dayX(model.iterationEnd(from, e.iteration));
      const y1 = e.iteration !== null ? fromBox.y + C.BAR_HEIGHT - 8 : fromBox.y + mid;
      const d = linkPath(x1, y1, toBox.x, toBox.y + mid);
      const classes = ['link',
        e.viaTheme && 'via-theme',
        from.status === 'done' && 'done',
        a.cycle.has(e.from) && a.cycle.has(e.to) && 'bad',
        a.isRisky(e.from, e.to) && 'risky'].filter(Boolean).join(' ');
      return `<g class="${classes}" data-dep="${esc(e.depId)}" data-from="${esc(e.from)}" data-to="${esc(e.to)}">
        <path class="hit" d="${d}"/><path class="vis" d="${d}"/></g>`;
    }).join('');
  }

  /** Vollständiges Diagramm als HTML (für App und Export). */
  function markup(a, { interactive = false } = {}) {
    const L = layout();
    const bars = model.getState().tasks.map((t) => barHtml(t, L.boxes.get(t.id), a, L, interactive)).join('');
    const draft = interactive ? '<path id="draftLink" class="draft" d="" style="display:none"/>' : '';
    const html = `${gridHtml(L)}
      <svg class="pb-links" width="${L.width}" height="${L.height}" xmlns="http://www.w3.org/2000/svg">
        <defs>${PB.diagramStyles.markerDefs()}</defs>${linksHtml(a, L)}${draft}</svg>
      ${bars}`;
    return { html, width: L.width, height: L.height, layout: L };
  }

  /* =====================================================================
   * Live-Board
   * ===================================================================== */

  function init(elements) {
    dom = elements;
  }

  function render(a) {
    analysis = a;
    const m = markup(a, { interactive: true });
    current = m.layout;
    dom.world.innerHTML = m.html;
    applyView();
    applySelection();
    applyHighlight();
  }

  function applyView() {
    const { zoom } = model.getState().view;
    Object.assign(dom.world.style, { width: `${current.width}px`, height: `${current.height}px`, transform: `scale(${zoom})` });
    Object.assign(dom.sizer.style, { width: `${current.width * zoom}px`, height: `${current.height * zoom}px` });
  }

  function showDraftLink(fromId, iteration, point) {
    const draft = dom.world.querySelector('#draftLink');
    const task = model.getTask(fromId);
    const box = current.boxes.get(fromId);
    if (!draft || !task || !box) return;
    const y = iteration !== null ? box.y + C.BAR_HEIGHT - 8 : box.y + C.BAR_HEIGHT / 2;
    draft.style.display = '';
    draft.setAttribute('d', linkPath(dayX(model.iterationEnd(task, iteration)), y, point.x, point.y));
  }

  function hideDraftLink() {
    const draft = dom.world.querySelector('#draftLink');
    if (draft) draft.style.display = 'none';
  }

  function applySelection() {
    const { type, id } = ui.selection;
    dom.world.querySelectorAll('.bar').forEach((el) =>
      el.classList.toggle('selected', type === 'task' && el.dataset.id === id));
    dom.world.querySelectorAll('.link').forEach((el) =>
      el.classList.toggle('sel', type === 'dependency' && el.dataset.dep === id));
  }

  /** Hover (vorher nötig / blockiert) hat Vorrang vor dem Fokusmodus. */
  function applyHighlight() {
    const CLASSES = ['dim', 'hl', 'up', 'down', 'crit', 'ready-hl'];
    const bars = [...dom.world.querySelectorAll('.bar')];
    const links = [...dom.world.querySelectorAll('.link')];
    bars.forEach((el) => el.classList.remove(...CLASSES));
    links.forEach((el) => el.classList.remove(...CLASSES));
    if (!analysis || ui.dragging) return;
    const rule = highlightRule();
    if (!rule) return;
    bars.forEach((el) => el.classList.add(rule.taskClass(el.dataset.id) || 'dim'));
    links.forEach((el) => el.classList.add(rule.linkClass(el.dataset.from, el.dataset.to) || 'dim'));
  }

  function highlightRule() {
    if (ui.hoverId && model.getNode(ui.hoverId)) {
      const focus = new Set(model.tasksOf(ui.hoverId));
      const up = A.closure(focus, analysis.predecessors);
      const down = A.closure(focus, analysis.successors);
      return {
        taskClass: (id) => (focus.has(id) ? 'hl' : up.has(id) ? 'up' : down.has(id) ? 'down' : null),
        linkClass: (from, to) => {
          if (up.has(from) && (up.has(to) || focus.has(to))) return 'up';
          if ((focus.has(from) || down.has(from)) && down.has(to)) return 'down';
          return null;
        },
      };
    }
    if (ui.focusMode === 'ready') {
      return { taskClass: (id) => (analysis.ready.has(id) ? 'ready-hl' : null), linkClass: () => null };
    }
    if (ui.focusMode === 'critical') {
      const index = new Map(analysis.criticalPath.map((id, i) => [id, i]));
      return {
        taskClass: (id) => (index.has(id) ? 'crit' : null),
        linkClass: (from, to) => (index.has(from) && index.get(to) === index.get(from) + 1 ? 'crit' : null),
      };
    }
    return null;
  }

  /* ---------- Koordinaten, Zoom, Scrollen ---------- */

  function toWorld(clientX, clientY) {
    const rect = dom.world.getBoundingClientRect();
    const zoom = model.getState().view.zoom;
    return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom };
  }

  /** Arbeitstag an einer x-Position (≥ 0). */
  const dayAt = (x) => Math.max(0, Math.floor((x - C.LABEL_WIDTH) / C.DAY_WIDTH));

  /** Prioritätsband an einer y-Position (oberhalb → 1, unterhalb → letztes). */
  function priorityAt(y) {
    const band = current.bands.find((b) => y < b.y + b.height);
    return band ? band.priority : C.PRIORITY_LEVELS;
  }

  function viewportCenter() {
    const zoom = model.getState().view.zoom;
    const c = dom.canvas;
    return { x: (c.scrollLeft + c.clientWidth / 2) / zoom, y: (c.scrollTop + c.clientHeight / 2) / zoom };
  }

  /** Zoomen um einen Ankerpunkt (Pixel relativ zur Arbeitsfläche), Standard: Mitte. */
  function setZoom(zoom, anchor) {
    const c = dom.canvas;
    const old = model.getState().view.zoom;
    const next = U.clamp(zoom, C.ZOOM.min, C.ZOOM.max);
    const p = anchor || { x: c.clientWidth / 2, y: c.clientHeight / 2 };
    const wx = (c.scrollLeft + p.x) / old;
    const wy = (c.scrollTop + p.y) / old;
    model.setView({ zoom: next });
    applyView();
    c.scrollLeft = wx * next - p.x;
    c.scrollTop = wy * next - p.y;
  }

  /** Alle Prioritätsbänder in der Höhe zeigen (nicht kleiner als fitMin), in der Breite scrollen; ab heute. */
  function fit() {
    const c = dom.canvas;
    const zoom = U.clamp(Math.min(c.clientHeight / current.height, 1), C.ZOOM.fitMin, C.ZOOM.max);
    model.setView({ zoom });
    applyView();
    c.scrollLeft = 0;
    c.scrollTop = 0;
  }

  function scrollTo(id) {
    const box = current?.boxes.get(id);
    if (!box) return;
    const zoom = model.getState().view.zoom;
    dom.canvas.scrollTo({
      left: Math.max(0, (box.x - C.LABEL_WIDTH - 40) * zoom),
      top: Math.max(0, (box.y + C.BAR_HEIGHT / 2) * zoom - dom.canvas.clientHeight / 2),
      behavior: 'smooth',
    });
  }

  return {
    layout, markup,
    init, render, applyView, showDraftLink, hideDraftLink, applySelection, applyHighlight,
    toWorld, dayAt, priorityAt, viewportCenter, setZoom, fit, scrollTo,
  };
})();
