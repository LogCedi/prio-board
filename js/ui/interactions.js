/**
 * Maus-/Touch-Interaktionen auf der Zeitachse:
 *  - Balken ziehen: waagrecht = Start, senkrecht = Prioritätsband (ausgewählte Balken gemeinsam)
 *  - Strg/⌘/Shift + Klick: Balken zur Auswahl hinzufügen/entfernen
 *  - Shift + Ziehen auf leerer Fläche: Auswahlrechteck
 *  - rechte Kante = Dauer, gestrichelte Kante = Puffer
 *  - Punkt am Ende (oder an einer Iterationsgrenze) ziehen = Abhängigkeit;
 *    Punkt am Rahmen ziehen = Abhängigkeit des ganzen Themas; Loslassen im Rahmen = auf das Thema
 *  - Klick auf ein Rahmen-Etikett = Thema auswählen
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
      if (event.ctrlKey || event.metaKey || event.shiftKey) return actions.toggleTask(id);
      return startMove(event, id);
    }
    const themePort = target.closest('.theme-port');
    if (themePort && event.button === 0) return startLink(event, themePort.parentElement.dataset.theme, null);
    const frameLabel = target.closest('.tl-frame-label');
    if (frameLabel) return actions.select('theme', frameLabel.parentElement.dataset.theme);
    const link = target.closest('.link');
    if (link) return actions.select('dependency', link.dataset.dep);
    if (event.shiftKey && event.button === 0) return startLasso(event);
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

  /**
   * Verschiebt den gegriffenen Balken – und alle anderen ausgewählten mit (gleicher Versatz).
   * Während des Ziehens bleibt das Board unverändert: Die Balken folgen als Vorschau der Maus
   * (waagrecht tageweise, senkrecht frei), das Ziel-Band wird markiert. Erst beim Loslassen
   * wird übernommen – so springt nichts, wenn sich Bandhöhen durch das Verschieben ändern.
   */
  function startMove(event, id) {
    event.preventDefault();
    const { type, ids } = ui.selection;
    const group = type === 'task' && ids.includes(id) ? ids : [id];
    if (group.length === 1) actions.select('task', id);
    const origin = board.toWorld(event.clientX, event.clientY);
    const leadPriority = model.getTask(id).priority;
    const initial = group.map((taskId) => {
      const t = model.getTask(taskId);
      return { id: taskId, start: t.start, priority: t.priority };
    });
    let started = false;
    let target = null;

    track((e) => {
      const p = board.toWorld(e.clientX, e.clientY);
      if (!started && Math.hypot(p.x - origin.x, p.y - origin.y) * model.getState().view.zoom < DRAG_THRESHOLD) return;
      if (!started) {
        started = true;
        ui.dragging = true;
        board.applyHighlight();
      }
      const days = daysBetween(origin.x, p.x);
      const priorityShift = board.priorityAt(p.y) - leadPriority;
      target = initial.map((t) => ({
        id: t.id,
        start: Math.max(0, t.start + days),
        priority: Math.min(C.PRIORITY_LEVELS, Math.max(1, t.priority + priorityShift)),
      }));
      const lead = target.find((t) => t.id === id);
      board.showMovePreview([id, ...group.filter((x) => x !== id)], (lead.start - model.getTask(id).start) * C.DAY_WIDTH, p.y - origin.y,
        { priority: lead.priority, start: lead.start, point: p });
    }, () => {
      board.hideMovePreview();
      if (!started || !target) return;
      const changed = target.some((t, i) => t.start !== initial[i].start || t.priority !== initial[i].priority);
      if (!changed) {
        board.applyHighlight();
        return;
      }
      model.beginGesture();
      model.previewTasks(new Map(target.map((t) => [t.id, { start: t.start, priority: t.priority }])));
      model.endGesture();
    });
  }

  /* ---------- Auswahlrechteck ---------- */

  function startLasso(event) {
    event.preventDefault();
    const origin = board.toWorld(event.clientX, event.clientY);
    let hits = [];
    ui.dragging = true;
    track((e) => {
      const p = board.toWorld(e.clientX, e.clientY);
      hits = board.showLasso({
        x: Math.min(origin.x, p.x), y: Math.min(origin.y, p.y),
        width: Math.abs(p.x - origin.x), height: Math.abs(p.y - origin.y),
      });
    }, () => {
      board.showLasso(null);
      if (hits.length) actions.selectTasks(hits);
      else actions.clearSelection();
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

  /**
   * Pfeil ziehen – von einer Aufgabe (optional ab einer Iteration) oder einem Thema (Rahmen-Punkt).
   * Ziel ist der Balken unter dem Zeiger, sonst das Thema, in dessen Rahmen losgelassen wird.
   */
  function startLink(event, fromId, iteration) {
    event.preventDefault();
    event.stopPropagation();
    ui.dragging = true;
    document.body.classList.add('linking');
    board.applyHighlight();

    const targetAt = (e) => {
      const bar = document.elementFromPoint(e.clientX, e.clientY)?.closest('.bar');
      if (bar) return { id: bar.dataset.id, theme: null };
      const theme = board.themeAt(board.toWorld(e.clientX, e.clientY));
      return { id: theme, theme };
    };

    track((e) => {
      board.showDraftLink(fromId, iteration, board.toWorld(e.clientX, e.clientY));
      board.markDropTheme(targetAt(e).theme);
    }, (e) => {
      document.body.classList.remove('linking');
      board.hideDraftLink();
      board.markDropTheme(null);
      const target = targetAt(e).id;
      if (target && target !== fromId) actions.addDependency(fromId, target, iteration);
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
