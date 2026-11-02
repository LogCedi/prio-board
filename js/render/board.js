/**
 * Darstellung der Zeitachse (Geometrie kommt aus PB.layout).
 *  - markup(): HTML/SVG des Diagramms – auch für den statischen Export.
 *  - render() & Co.: Live-Ansicht mit Zoom, Auswahl, Hervorhebungen.
 */
PB.board = (() => {
  const C = PB.config;
  const U = PB.util;
  const I = PB.icons;
  const CAL = PB.calendar;
  const A = PB.analysis;
  const L = PB.layout;
  const model = PB.model;
  const ui = PB.ui;
  const esc = U.escapeHtml;

  let dom = null;
  let analysis = null;
  let current = null; // letztes Layout (für Koordinaten-Umrechnung)

  /* =====================================================================
   * Markup (zustandslos)
   * ===================================================================== */

  function gridHtml(layout) {
    const weeks = CAL.weeks(layout.horizon);
    const columns = weeks.map((w, i) => {
      const x = L.dayX(w.day);
      const nextX = i + 1 < weeks.length ? L.dayX(weeks[i + 1].day) : layout.width;
      const label = i === 0 ? `Heute · KW ${w.week}` : `KW ${w.week}`;
      return `<div class="tl-week${i % 2 ? ' alt' : ''}${i === 0 ? ' today' : ''}" style="left:${x}px;width:${nextX - x}px;height:${layout.height}px">
        <div class="tl-week-label"><b>${label}</b>${CAL.shortDate(w.date)}</div></div>`;
    }).join('');
    const bands = layout.bands.map((b, i) => `<div class="tl-band${i % 2 ? ' alt' : ''}" style="top:${b.y}px;height:${b.height}px;width:${layout.width}px">
        <div class="tl-band-label"><b>Prio ${b.priority}</b><span>${C.PRIORITY_LABELS[b.priority - 1]}</span></div></div>`).join('');
    return `<div class="tl-days"></div>${columns}${bands}
      <div class="tl-corner"><b>Prio ↓</b><br>Zeit →</div><div class="tl-today"></div>`;
  }

  function framesHtml(layout) {
    return layout.frames.map((f) => {
      const theme = model.getTheme(f.themeId);
      return `<div class="tl-frame" data-theme="${esc(theme.id)}" style="left:${f.x}px;top:${f.y}px;width:${f.width}px;height:${f.height}px;--c:${theme.color}">
        <span class="tl-frame-label"><i></i>${esc(theme.title)}</span></div>`;
    }).join('');
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

  /** Iterationen als Phasen über die ganze Balkenhöhe, jede mit eigener Intensität. */
  function phasesHtml(task) {
    if (!task.iterations.length) return '';
    return `<div class="bar-phases">${task.iterations.map((it) => {
      const tip = `${it.title} · ${CAL.durationLabel(it.durationDays)} · ${C.INTENSITY_LABELS[it.intensity]}${it.done ? ' · erledigt' : ''}`;
      return `<div class="phase int-${it.intensity}${it.done ? ' done' : ''}" style="width:${it.durationDays * C.DAY_WIDTH}px" title="${esc(tip)}">
        <span>${esc(it.title)}${it.done ? ' ✓' : ''}</span></div>`;
    }).join('')}</div>`;
  }

  function barHtml(task, box, a, layout, interactive) {
    const duration = model.durationOf(task);
    const leverage = a.leverage.get(task.id);
    const classes = ['bar', task.kind, `st-${task.status}`,
      task.iterations.length ? 'has-iterations' : `int-${task.intensity}`,
      box.narrow && 'narrow', task.ongoing && 'ongoing'].filter(Boolean).join(' ');
    const style = `left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${C.BAR_HEIGHT}px;--buf:${box.bufferWidth}px`;

    const durationText = CAL.durationLabel(duration) + (task.bufferDays ? ` (bis ${CAL.durationLabel(duration + task.bufferDays)})` : '');
    const meta = [
      statusBadge(task, a),
      `<span>${durationText}</span>`,
      leverage ? `<span class="lev" title="Gibt ${leverage} Umsetzung(en) frei">🔓 ${leverage}</span>` : '',
    ].join('');
    const buffer = task.bufferDays
      ? `<div class="bar-buffer" style="width:${box.bufferWidth}px" title="Puffer ${CAL.durationLabel(task.bufferDays)}"></div>`
      : '';
    const ongoing = task.ongoing
      ? `<div class="bar-ongoing" style="width:${Math.max(0, layout.width - box.x - box.w - box.bufferWidth)}px" title="Läuft danach weiter"><span>∞ laufend</span></div>`
      : '';
    const tooltip = [task.title, `${CAL.longDate(CAL.dateOf(task.start))} – ${CAL.longDate(CAL.dateOf(model.endOf(task)))}`,
      ...task.notes.map((n) => `• ${n}`), task.description].filter(Boolean).join('\n');

    return `<div class="${classes}" data-id="${esc(task.id)}" style="${style}" title="${esc(tooltip)}">
      ${buffer}${ongoing}${phasesHtml(task)}
      <div class="bar-body"><span class="tico">${I.forKind(task.kind)}</span>
        <div class="bar-text"><div class="title">${esc(task.title)}</div><div class="meta">${meta}</div></div></div>
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

  /** Startpunkt eines Pfeils: Ende der Aufgabe (Mitte) oder Ende einer Iteration (unten). */
  function linkStart(task, box, iteration) {
    const x = L.dayX(model.iterationEnd(task, iteration));
    return { x, y: iteration !== null ? box.y + C.BAR_HEIGHT - 8 : box.y + C.BAR_HEIGHT / 2 };
  }

  /**
   * Themen-Abhängigkeiten nur dort zeichnen, wo sie im Thema „ankommen“ bzw. es „verlassen“:
   * Mitglieder mit einem Vorgänger (bzw. Nachfolger) im selben Thema hängen ohnehin indirekt daran.
   */
  function isVisibleEdge(e, a) {
    if (!e.viaTheme) return true;
    const dep = model.getDependency(e.depId);
    const inTheme = (themeId, taskId) => model.isTheme(themeId) && model.getTask(taskId).theme === themeId;
    const entersInside = [...a.predecessors.get(e.to)].some((p) => inTheme(dep.to, p));
    const leavesInside = [...a.successors.get(e.from)].some((s) => inTheme(dep.from, s));
    return !(model.isTheme(dep.to) && entersInside) && !(model.isTheme(dep.from) && leavesInside);
  }

  function linksHtml(a, layout) {
    return a.edges.filter((e) => isVisibleEdge(e, a)).map((e) => {
      const from = model.getTask(e.from);
      const fromBox = layout.boxes.get(e.from);
      const toBox = layout.boxes.get(e.to);
      const start = linkStart(from, fromBox, e.iteration);
      const d = linkPath(start.x, start.y, toBox.x, toBox.y + C.BAR_HEIGHT / 2);
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
    const layout = L.compute();
    const bars = model.getState().tasks.map((t) => barHtml(t, layout.boxes.get(t.id), a, layout, interactive)).join('');
    const extras = interactive ? '<path id="draftLink" class="draft" d="" style="display:none"/>' : '';
    const html = `${gridHtml(layout)}${framesHtml(layout)}
      <svg class="pb-links" width="${layout.width}" height="${layout.height}" xmlns="http://www.w3.org/2000/svg">
        <defs>${PB.diagramStyles.markerDefs()}</defs>${linksHtml(a, layout)}${extras}</svg>
      ${bars}${interactive ? '<div id="lasso" class="lasso" hidden></div>' : ''}`;
    return { html, width: layout.width, height: layout.height, layout };
  }

  /* =====================================================================
   * Live-Ansicht
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
    const box = current.boxes.get(fromId);
    if (!draft || !box) return;
    const start = linkStart(model.getTask(fromId), box, iteration);
    draft.style.display = '';
    draft.setAttribute('d', linkPath(start.x, start.y, point.x, point.y));
  }

  function hideDraftLink() {
    const draft = dom.world.querySelector('#draftLink');
    if (draft) draft.style.display = 'none';
  }

  /** Auswahlrechteck (Weltkoordinaten); null blendet es aus. Liefert die getroffenen Aufgaben. */
  function showLasso(rect) {
    const lasso = dom.world.querySelector('#lasso');
    if (!lasso) return [];
    lasso.hidden = !rect;
    if (!rect) return [];
    Object.assign(lasso.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    const hits = [];
    current.boxes.forEach((box, id) => {
      const right = box.x + box.w;
      const bottom = box.y + C.BAR_HEIGHT;
      if (box.x < rect.x + rect.width && right > rect.x && box.y < rect.y + rect.height && bottom > rect.y) hits.push(id);
    });
    return hits;
  }

  function applySelection() {
    const { type, ids } = ui.selection;
    const selected = new Set(ids);
    dom.world.querySelectorAll('.bar').forEach((el) =>
      el.classList.toggle('selected', type === 'task' && selected.has(el.dataset.id)));
    dom.world.querySelectorAll('.tl-frame').forEach((el) =>
      el.classList.toggle('selected', type === 'theme' && selected.has(el.dataset.theme)));
    dom.world.querySelectorAll('.link').forEach((el) =>
      el.classList.toggle('sel', type === 'dependency' && selected.has(el.dataset.dep)));
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

  const priorityAt = (y) => L.priorityAt(current, y);

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
    markup,
    init, render, applyView, showDraftLink, hideDraftLink, showLasso, applySelection, applyHighlight,
    toWorld, dayAt: L.dayAt, priorityAt, viewportCenter, setZoom, fit, scrollTo,
  };
})();
