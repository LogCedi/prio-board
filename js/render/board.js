/**
 * Darstellung des Boards.
 *  - markup(): reines HTML/SVG des Diagramms – wird auch vom statischen Export genutzt.
 *  - render() & Co.: Live-Board mit Zoom, Auswahl, Hervorhebungen.
 */
PB.board = (() => {
  const C = PB.config;
  const U = PB.util;
  const I = PB.icons;
  const A = PB.analysis;
  const model = PB.model;
  const ui = PB.ui;

  let dom = null;
  let analysis = null;

  /* =====================================================================
   * Markup (zustandslos)
   * ===================================================================== */

  function zonesHtml() {
    const zones = C.PRIORITY_LABELS.map((label, i) =>
      `<div class="z" style="width:${C.ZONE_WIDTH}px"><span>Prio ${i + 1} · ${label}</span></div>`).join('');
    return `${zones}<div class="axis">Priorität hoch <i></i> tief</div>`;
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

  function taskHtml(task, a, showPriority) {
    const esc = U.escapeHtml;
    const wave = a.wave.get(task.id);
    const notes = task.notes.length ? `<ul class="notes">${task.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
    const effort = task.effortDays != null ? `<span class="meta">${U.formatNumber(task.effortDays)} PT</span>` : '';
    const priority = showPriority ? `<span class="meta">· Prio ${a.priorityOf(task.id)}</span>` : '';
    return `<div class="inner">
      ${wave ? `<span class="wave" title="Welle ${wave}">W${wave}</span>` : ''}
      <div class="thead">
        <span class="tico">${I.forKind(task.kind)}</span>
        <div><div class="tkind">${C.KIND_SUBTITLES[task.kind]}</div><div class="title">${esc(task.title || 'Ohne Titel')}</div></div>
      </div>
      ${notes}
      ${task.description ? `<div class="desc">${esc(task.description)}</div>` : ''}
      <div class="foot">${statusBadge(task, a)}${effort}${priority}</div>
    </div>`;
  }

  function groupHtml(group, a) {
    const esc = U.escapeHtml;
    const tasks = model.tasksWithin(group.id);
    const done = tasks.filter((id) => a.stateOf(id) === 'done').length;
    const ready = tasks.filter((id) => a.ready.has(id)).length;
    return `<div class="ghead"><span class="gtitle">${esc(group.title || 'Gruppe')}</span>
        <span class="gmeta">${done}/${tasks.length} fertig${ready ? ` · ${ready} startbar` : ''}</span></div>
      ${group.description ? `<div class="gdesc">${esc(group.description)}</div>` : ''}`;
  }

  const HANDLES = '<div class="port" title="Ziehen: Pfeil zu einem Block, der hiervon abhängt"></div>' +
    '<div class="rs" title="Grösse ändern"></div>';

  function nodeHtml(node, a, { interactive, showPriority, zIndex }) {
    const isGroup = model.isGroup(node.id);
    const classes = isGroup ? 'block group' : `block task ${node.kind} st-${node.status}`;
    const { x, y, width, height } = node.layout;
    const style = `left:${x}px;top:${y}px;width:${width}px;height:${height}px${zIndex ? `;z-index:${zIndex}` : ''}`;
    const body = isGroup ? groupHtml(node, a) : taskHtml(node, a, showPriority);
    return `<div class="${classes}" data-id="${U.escapeHtml(node.id)}" style="${style}">${body}${interactive ? HANDLES : ''}</div>`;
  }

  /** Gruppen zuerst (grosse hinten), dann Aufgaben. */
  function orderedNodes() {
    const { groups, tasks } = model.getState();
    const sortedGroups = [...groups].sort((a, b) => U.area(b.layout) - U.area(a.layout));
    return [
      ...sortedGroups.map((g, i) => ({ node: g, zIndex: 10 + i })),
      ...tasks.map((t) => ({ node: t, zIndex: null })),
    ];
  }

  /** Kubische Kurve zwischen zwei Rechtecken, an der Seite mit dem grösseren Abstand. */
  function linkPath(from, to) {
    const a = U.center(from);
    const b = U.center(to);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const gapX = Math.abs(dx) - (from.width + to.width) / 2;
    const gapY = Math.abs(dy) - (from.height + to.height) / 2;
    let start, end, c1, c2;
    if (gapX >= gapY) {
      const dir = dx >= 0 ? 1 : -1;
      start = { x: dir > 0 ? from.x + from.width : from.x, y: a.y };
      end = { x: dir > 0 ? to.x - 2 : to.x + to.width + 2, y: b.y };
      const k = Math.max(40, Math.abs(end.x - start.x) / 2) * dir;
      c1 = { x: start.x + k, y: start.y };
      c2 = { x: end.x - k, y: end.y };
    } else {
      const dir = dy >= 0 ? 1 : -1;
      start = { x: a.x, y: dir > 0 ? from.y + from.height : from.y };
      end = { x: b.x, y: dir > 0 ? to.y - 2 : to.y + to.height + 2 };
      const k = Math.max(40, Math.abs(end.y - start.y) / 2) * dir;
      c1 = { x: start.x, y: start.y + k };
      c2 = { x: end.x, y: end.y - k };
    }
    return `M${start.x},${start.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${end.x},${end.y}`;
  }

  function linkClasses(dep, a) {
    const fromTasks = model.tasksWithin(dep.from);
    const toTasks = model.tasksWithin(dep.to);
    const classes = ['link'];
    if (fromTasks.length && fromTasks.every((id) => a.stateOf(id) === 'done')) classes.push('done');
    if (fromTasks.some((id) => a.cycle.has(id)) && toTasks.some((id) => a.cycle.has(id))) classes.push('bad');
    return classes.join(' ');
  }

  function linksHtml(a, { interactive }) {
    return model.getState().dependencies.map((dep) => {
      const from = model.getNode(dep.from);
      const to = model.getNode(dep.to);
      if (!from || !to) return '';
      const d = linkPath(from.layout, to.layout);
      const hit = interactive ? `<path class="hit" d="${d}"/>` : '';
      return `<g class="${linkClasses(dep, a)}" data-dep="${U.escapeHtml(dep.id)}">${hit}<path class="vis" d="${d}"/></g>`;
    }).join('');
  }

  /** Benötigte Fläche (mindestens die ganze Prioritätsachse). */
  function contentSize() {
    let width = C.ZONE_WIDTH * C.PRIORITY_LEVELS;
    let height = 1400;
    for (const n of model.allNodes()) {
      width = Math.max(width, n.layout.x + n.layout.width + 400);
      height = Math.max(height, n.layout.y + n.layout.height + 400);
    }
    return { width, height };
  }

  /** Vollständiges Diagramm-Markup. */
  function markup(a, { interactive = false } = {}) {
    const showPriority = model.getState().view.showPriorityAxis;
    return {
      zones: zonesHtml(),
      nodes: orderedNodes().map(({ node, zIndex }) => nodeHtml(node, a, { interactive, showPriority, zIndex })).join(''),
      links: linksHtml(a, { interactive }),
      size: contentSize(),
    };
  }

  /* =====================================================================
   * Live-Board
   * ===================================================================== */

  function init(elements) {
    dom = elements;
    dom.links.querySelector('defs').innerHTML = PB.diagramStyles.markerDefs();
    dom.zones.innerHTML = zonesHtml();
  }

  const elementOf = (id) => dom.world.querySelector(`.block[data-id="${CSS.escape(id)}"]`);

  function render(a) {
    analysis = a;
    const m = markup(a, { interactive: true });
    dom.world.querySelectorAll('.block').forEach((el) => el.remove());
    dom.world.insertAdjacentHTML('beforeend', m.nodes);
    dom.linkLayer.innerHTML = m.links;
    applyView();
    applySelection();
    applyHighlight();
  }

  function applyView() {
    const { view } = model.getState();
    const { width, height } = contentSize();
    Object.assign(dom.world.style, { width: `${width}px`, height: `${height}px`, transform: `scale(${view.zoom})` });
    Object.assign(dom.sizer.style, { width: `${width * view.zoom}px`, height: `${height * view.zoom}px` });
    dom.links.setAttribute('width', width);
    dom.links.setAttribute('height', height);
    dom.zones.classList.toggle('off', !view.showPriorityAxis);
  }

  /** Positionen während einer Geste aktualisieren (ohne komplettes Neuzeichnen). */
  function refreshLayout(ids) {
    for (const id of ids) {
      const el = elementOf(id);
      const node = model.getNode(id);
      if (!el || !node) continue;
      const { x, y, width, height } = node.layout;
      Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
    }
    dom.linkLayer.querySelectorAll('.link').forEach((g) => {
      const dep = model.getDependency(g.dataset.dep);
      if (!dep) return;
      const d = linkPath(model.getNode(dep.from).layout, model.getNode(dep.to).layout);
      g.querySelectorAll('path').forEach((p) => p.setAttribute('d', d));
    });
  }

  function showDraftLink(fromId, point) {
    const from = model.getNode(fromId);
    dom.draft.style.display = '';
    dom.draft.setAttribute('d', linkPath(from.layout, { x: point.x, y: point.y, width: 1, height: 1 }));
  }
  function hideDraftLink() {
    dom.draft.style.display = 'none';
    dom.draft.setAttribute('d', '');
  }

  function applySelection() {
    const { type, id } = ui.selection;
    dom.world.querySelectorAll('.block').forEach((el) =>
      el.classList.toggle('selected', type === 'node' && el.dataset.id === id));
    dom.linkLayer.querySelectorAll('.link').forEach((el) =>
      el.classList.toggle('sel', type === 'dependency' && el.dataset.dep === id));
  }

  /**
   * Hervorhebung: Hover (vorher nötig / blockiert) hat Vorrang vor dem Fokusmodus.
   * taskClass(id) → CSS-Klasse oder null (= abgedunkelt); linkClass(fromTasks, toTasks) analog.
   */
  function applyHighlight() {
    const CLASSES = ['dim', 'hl', 'up', 'down', 'crit', 'ready-hl'];
    const blocks = [...dom.world.querySelectorAll('.block')];
    const links = [...dom.linkLayer.querySelectorAll('.link')];
    blocks.forEach((el) => el.classList.remove(...CLASSES));
    links.forEach((el) => el.classList.remove(...CLASSES));
    if (!analysis || ui.dragging) return;

    const rule = highlightRule();
    if (!rule) return;
    blocks.forEach((el) => {
      const id = el.dataset.id;
      if (model.isGroup(id)) {
        if (!model.tasksWithin(id).some(rule.taskClass)) el.classList.add('dim');
      } else {
        el.classList.add(rule.taskClass(id) || 'dim');
      }
    });
    links.forEach((el) => {
      const dep = model.getDependency(el.dataset.dep);
      if (dep) el.classList.add(rule.linkClass(model.tasksWithin(dep.from), model.tasksWithin(dep.to)) || 'dim');
    });
  }

  function highlightRule() {
    const any = (list, set) => list.some((x) => set.has(x));
    if (ui.hoverId && model.getNode(ui.hoverId)) {
      const focus = new Set(model.tasksWithin(ui.hoverId));
      const up = A.closure(focus, analysis.predecessors);
      const down = A.closure(focus, analysis.successors);
      return {
        taskClass: (id) => (focus.has(id) ? 'hl' : up.has(id) ? 'up' : down.has(id) ? 'down' : null),
        linkClass: (from, to) => {
          if (any(from, up) && (any(to, up) || any(to, focus))) return 'up';
          if ((any(from, focus) || any(from, down)) && any(to, down)) return 'down';
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
        linkClass: (from, to) => (from.some((f) => index.has(f) && to.some((t) => index.get(t) === index.get(f) + 1)) ? 'crit' : null),
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

  /** Alles sichtbar machen (inkl. Prioritätsachse oben links). */
  function fit() {
    const box = U.bounds(model.allNodes().map((n) => n.layout));
    if (!box) return;
    const c = dom.canvas;
    const x0 = Math.min(0, box.x - 40);
    const y0 = 0;
    const w = box.x + box.width + 40 - x0;
    const h = box.y + box.height + 40 - y0;
    const zoom = U.clamp(Math.min(c.clientWidth / w, c.clientHeight / h, 1.25), C.ZOOM.fitMin, C.ZOOM.max);
    model.setView({ zoom });
    applyView();
    // Passt alles hinein → zentrieren, sonst oben links (hohe Priorität) beginnen
    c.scrollLeft = x0 * zoom - Math.max(0, (c.clientWidth - w * zoom) / 2);
    c.scrollTop = y0 * zoom - Math.max(0, (c.clientHeight - h * zoom) / 2);
  }

  function scrollTo(id) {
    const node = model.getNode(id);
    if (!node) return;
    const zoom = model.getState().view.zoom;
    const center = U.center(node.layout);
    dom.canvas.scrollTo({
      left: center.x * zoom - dom.canvas.clientWidth / 2,
      top: center.y * zoom - dom.canvas.clientHeight / 2,
      behavior: 'smooth',
    });
  }

  return {
    markup, linkPath,
    init, render, applyView, refreshLayout, showDraftLink, hideDraftLink, applySelection, applyHighlight,
    toWorld, viewportCenter, setZoom, fit, scrollTo,
  };
})();
