/**
 * Maus-/Touch-Interaktionen auf der Zeitachse:
 *  - Balken ziehen: waagrecht = Start, senkrecht = Prioritätsband
 *  - rechte Kante = Dauer, gestrichelte Kante = Puffer
 *  - Punkt am Ende (oder an einer Iterationsgrenze) ziehen = Abhängigkeit
 *  - leere Fläche ziehen = verschieben, Doppelklick = neue Aufgabe, Strg+Mausrad = Zoom
 */
PB.interactions = (() => {
  const C = PB.config;
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
    const bar = target.closest('.bar');
    const id = bar?.dataset.id;
    if (bar && event.button === 0) {
      const port = target.closest('.port');
      if (port) return startLink(event, id, port.dataset.iteration === undefined ? null : Number(port.dataset.iteration));
      if (target.closest('.rs.dur')) return startResize(event, id, 'duration');
      if (target.closest('.rs.buf')) return startResize(event, id, 'buffer');
      return startMove(event, id);
    }
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

  /** Geste, die erst bei echter Bewegung beginnt (Klicks erzeugen keinen Historieneintrag). */
  function gesture() {
    let started = false;
    return {
      get started() { return started; },
      start() {
        if (started) return;
        started = true;
        ui.dragging = true;
        model.beginGesture();
      },
    };
  }

  /** Verschiebung in ganzen Arbeitstagen seit Gestenbeginn. */
  const daysBetween = (fromX, toX) => Math.round((toX - fromX) / C.DAY_WIDTH);

  /* ---------- Balken verschieben ---------- */

  function startMove(event, id) {
    event.preventDefault();
    actions.select('task', id);
    const task = model.getTask(id);
    const origin = board.toWorld(event.clientX, event.clientY);
    const start = task.start;
    const g = gesture();

    track((e) => {
      const p = board.toWorld(e.clientX, e.clientY);
      if (!g.started && Math.hypot(p.x - origin.x, p.y - origin.y) * model.getState().view.zoom < DRAG_THRESHOLD) return;
      g.start();
      model.previewTask(id, {
        start: Math.max(0, start + daysBetween(origin.x, p.x)),
        priority: board.priorityAt(p.y),
      });
      actions.preview();
    }, () => {
      if (g.started) model.endGesture();
    });
  }

  /* ---------- Dauer / Puffer ändern ---------- */

  function startResize(event, id, mode) {
    event.preventDefault();
    event.stopPropagation();
    actions.select('task', id);
    const task = model.getTask(id);
    const origin = board.toWorld(event.clientX, event.clientY);
    const lastIteration = task.iterations.length - 1;
    const initial = {
      duration: lastIteration >= 0 ? task.iterations[lastIteration].durationDays : task.durationDays,
      buffer: task.bufferDays,
    };
    const g = gesture();

    track((e) => {
      g.start();
      const delta = daysBetween(origin.x, board.toWorld(e.clientX, e.clientY).x);
      if (mode === 'buffer') model.previewTask(id, { bufferDays: Math.max(0, initial.buffer + delta) });
      else if (lastIteration >= 0) model.previewIteration(id, lastIteration, initial.duration + delta);
      else model.previewTask(id, { durationDays: Math.max(1, initial.duration + delta) });
      actions.preview();
    }, () => {
      if (g.started) model.endGesture();
    });
  }

  /* ---------- Abhängigkeit ziehen ---------- */

  function startLink(event, fromId, iteration) {
    event.preventDefault();
    event.stopPropagation();
    ui.dragging = true;
    document.body.classList.add('linking');
    board.applyHighlight();

    track((e) => {
      board.showDraftLink(fromId, iteration, board.toWorld(e.clientX, e.clientY));
    }, (e) => {
      document.body.classList.remove('linking');
      board.hideDraftLink();
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.bar');
      if (target && target.dataset.id !== fromId) actions.addDependency(fromId, target.dataset.id, iteration);
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
    actions.hover(event.target.closest('.bar')?.dataset.id ?? null);
  }

  function onDoubleClick(event) {
    const bar = event.target.closest('.bar');
    if (bar) {
      actions.select('task', bar.dataset.id);
      actions.focusTitle();
      return;
    }
    const p = board.toWorld(event.clientX, event.clientY);
    if (p.x < C.LABEL_WIDTH || p.y < C.HEADER_HEIGHT) return;
    actions.createAt({ start: board.dayAt(p.x), priority: board.priorityAt(p.y) }, event.clientX, event.clientY);
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
