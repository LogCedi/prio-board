/**
 * Maus-/Touch-Interaktionen auf der Arbeitsfläche:
 * Verschieben, Grösse ändern, Abhängigkeiten ziehen, Pannen, Hover, Zoom mit Strg+Mausrad.
 */
PB.interactions = (() => {
  const C = PB.config;
  const U = PB.util;
  const model = PB.model;
  const board = PB.board;
  const ui = PB.ui;

  /** Ab dieser Mausbewegung (px) gilt ein Klick als Ziehen. */
  const DRAG_THRESHOLD = 4;

  let dom = null;
  let actions = null;

  function init(elements, callbacks) {
    dom = elements;
    actions = callbacks;
    dom.canvas.addEventListener('pointerdown', onPointerDown);
    dom.canvas.addEventListener('wheel', onWheel, { passive: false });
    dom.world.addEventListener('pointerover', onPointerOver);
    dom.world.addEventListener('pointerleave', () => actions.hover(null));
    dom.world.addEventListener('dblclick', onDoubleClick);
  }

  /* ---------- Verteilung ---------- */

  function onPointerDown(event) {
    if (event.button !== 0 && event.button !== 1) return;
    const target = event.target;
    const block = target.closest('.block');
    const id = block?.dataset.id;
    if (block && target.closest('.port')) return startLink(event, id);
    if (block && target.closest('.rs')) return startResize(event, id);
    if (block && event.button === 0) return startMove(event, id);
    const link = target.closest('.link');
    if (link) return actions.select('dependency', link.dataset.dep);
    return startPan(event);
  }

  /** Verfolgt eine Zeigerbewegung bis zum Loslassen. */
  function track(onMove, onEnd) {
    const move = (e) => onMove(e);
    const end = (e) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      ui.dragging = false;
      onEnd(e);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  /** Startet eine Geste beim ersten echten Bewegen (damit Klicks keinen Historieneintrag erzeugen). */
  function gesture() {
    let started = false;
    return {
      get started() { return started; },
      start() {
        if (started) return;
        started = true;
        ui.dragging = true;
        model.beginGesture();
        board.applyHighlight();
      },
    };
  }

  /* ---------- Verschieben ---------- */

  function startMove(event, id) {
    event.preventDefault();
    actions.select('node', id);
    const origin = board.toWorld(event.clientX, event.clientY);
    // Gruppen nehmen ihren Inhalt mit
    const moving = [id, ...model.descendantsOf(id)].map((nodeId) => {
      const { x, y } = model.getNode(nodeId).layout;
      return { id: nodeId, x, y };
    });
    const lead = moving[0];
    const g = gesture();

    track((e) => {
      const p = board.toWorld(e.clientX, e.clientY);
      const dx = p.x - origin.x;
      const dy = p.y - origin.y;
      if (!g.started && Math.hypot(dx, dy) * model.getState().view.zoom < DRAG_THRESHOLD) return;
      g.start();
      const offsetX = Math.max(0, U.snap(lead.x + dx)) - lead.x;
      const offsetY = Math.max(0, U.snap(lead.y + dy)) - lead.y;
      moving.forEach((m) => model.setLayout(m.id, { x: m.x + offsetX, y: m.y + offsetY }));
      board.refreshLayout(moving.map((m) => m.id));
    }, () => {
      if (g.started) model.endGesture();
    });
  }

  /* ---------- Grösse ändern ---------- */

  function startResize(event, id) {
    event.preventDefault();
    event.stopPropagation();
    actions.select('node', id);
    const node = model.getNode(id);
    const origin = board.toWorld(event.clientX, event.clientY);
    const start = { width: node.layout.width, height: node.layout.height };
    const min = model.isGroup(id) ? C.MIN_SIZE.group : C.MIN_SIZE.task;
    const g = gesture();

    track((e) => {
      g.start();
      const p = board.toWorld(e.clientX, e.clientY);
      model.setLayout(id, {
        width: Math.max(min.width, U.snap(start.width + p.x - origin.x)),
        height: Math.max(min.height, U.snap(start.height + p.y - origin.y)),
      });
      board.refreshLayout([id]);
    }, () => {
      if (g.started) model.endGesture();
    });
  }

  /* ---------- Abhängigkeit ziehen ---------- */

  function startLink(event, fromId) {
    event.preventDefault();
    event.stopPropagation();
    ui.dragging = true;
    document.body.classList.add('linking');
    board.applyHighlight();

    track((e) => {
      board.showDraftLink(fromId, board.toWorld(e.clientX, e.clientY));
    }, (e) => {
      document.body.classList.remove('linking');
      board.hideDraftLink();
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.block');
      if (target && target.dataset.id !== fromId) actions.addDependency(fromId, target.dataset.id);
      else board.applyHighlight();
    });
  }

  /* ---------- Pannen ---------- */

  function startPan(event) {
    const canvas = dom.canvas;
    const start = { left: canvas.scrollLeft, top: canvas.scrollTop, x: event.clientX, y: event.clientY };
    let moved = false;
    canvas.classList.add('panning');
    track((e) => {
      if (Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) > DRAG_THRESHOLD) moved = true;
      canvas.scrollLeft = start.left - (e.clientX - start.x);
      canvas.scrollTop = start.top - (e.clientY - start.y);
    }, () => {
      canvas.classList.remove('panning');
      if (!moved) actions.clearSelection();
    });
  }

  /* ---------- Hover, Doppelklick, Zoom ---------- */

  function onPointerOver(event) {
    if (ui.dragging) return;
    actions.hover(event.target.closest('.block')?.dataset.id ?? null);
  }

  function onDoubleClick(event) {
    const block = event.target.closest('.block');
    if (!block) return;
    actions.select('node', block.dataset.id);
    actions.focusTitle();
  }

  function onWheel(event) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const rect = dom.canvas.getBoundingClientRect();
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    board.setZoom(model.getState().view.zoom * factor, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    actions.viewChanged();
  }

  return { init };
})();
