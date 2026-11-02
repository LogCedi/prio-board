/**
 * Maus-/Touch-Interaktionen auf der Zeitachse:
 *  - Balken ziehen: waagrecht = Start, senkrecht = Prioritätsband (ausgewählte Balken gemeinsam)
 *  - Strg/⌘/Shift + Klick: Balken zur Auswahl hinzufügen/entfernen
 *  - Shift + Ziehen auf leerer Fläche: Auswahlrechteck
 *  - rechte Kante = Dauer, gestrichelte Kante = Puffer
 *  - Punkt am Ende (oder an einer Iterationsgrenze) ziehen = Abhängigkeit;
 *    Punkt am Rahmen ziehen = Abhängigkeit des ganzen Themas; Loslassen im Rahmen = auf das Thema
 *  - Rahmen-Kopfzeile: ziehen = ganze Gruppe verschieben, Klick = Thema auswählen
 *  - senkrecht innerhalb eines Bandes: auf eine Zeile ablegen (Platzhalter zeigt das Ziel)
 *  - leere Fläche ziehen = verschieben, Doppelklick = neue Aufgabe, Strg+Mausrad = Zoom
 */
PB.interactions = (() => {
  const C = PB.config;
  const model = PB.model;
  const board = PB.board;
  const ui = PB.ui;
  const U = PB.util;

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
    const grip = target.closest('.tl-frame-grip');
    if (grip && event.button === 0) {
      const frame = grip.parentElement;
      return startFrameMove(event, frame.dataset.theme, Number(frame.dataset.priority));
    }
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

  /* ---------- Verschieben (Balken und ganze Rahmen) ---------- */

  /**
   * Gemeinsamer Ablauf beim Ziehen: Vorschau per Transform (Board bleibt ruhig), Übernahme beim
   * Loslassen in einem Schritt. plan(p) liefert für die Zeigerposition { preview, commit() }.
   * Ohne Bewegung wird onClick aufgerufen.
   */
  function dragWithPreview(event, plan, onClick) {
    event.preventDefault();
    const origin = board.toWorld(event.clientX, event.clientY);
    let started = false;
    let latest = null;
    track((e) => {
      const p = board.toWorld(e.clientX, e.clientY);
      if (!started && Math.hypot(p.x - origin.x, p.y - origin.y) * model.getState().view.zoom < DRAG_THRESHOLD) return;
      if (!started) {
        started = true;
        ui.dragging = true;
        board.applyHighlight();
      }
      latest = plan(p, origin);
      board.showMovePreview(latest.preview);
    }, () => {
      board.hideMovePreview();
      if (!started) onClick?.();
      else if (latest) latest.commit();
      board.applyHighlight();
    });
  }

  /**
   * Neue Start-/Prioritäts-/Zeilenwerte für eine Gruppe von Aufgaben übernehmen.
   * Alle Aufgaben bekommen ihre aktuell angezeigte Zeile fest zugewiesen, damit nichts springt;
   * ist die Zielzeile im Zielabschnitt zeitlich belegt, rutschen die Zeilen ab dort nach unten.
   */
  function commitMove(moves, layout) {
    const patches = new Map();
    layout.boxes.forEach((box, id) => patches.set(id, { row: box.row }));
    const moving = new Set(moves.map((m) => m.id));
    const lead = moves[0];
    const leadTask = model.getTask(lead.id);
    const leadAtTarget = { ...leadTask, start: lead.start };
    const neighbours = model.getState().tasks.filter((t) =>
      !moving.has(t.id) && t.priority === lead.priority && (t.theme || null) === (leadTask.theme || null));
    const blocked = neighbours.some((t) =>
      patches.get(t.id)?.row === lead.row && PB.layout.collides(t, leadAtTarget, layout.width));
    if (blocked) {
      const shift = Math.max(...moves.map((m) => m.row)) - lead.row + 1;
      neighbours.forEach((t) => {
        const row = patches.get(t.id)?.row;
        if (row !== undefined && row >= lead.row) patches.get(t.id).row = row + shift;
      });
    }
    moves.forEach((m) => patches.set(m.id, { start: m.start, priority: m.priority, row: m.row }));
    const changed = moves.some((m) => {
      const t = model.getTask(m.id);
      return t.start !== m.start || t.priority !== m.priority || layout.boxes.get(m.id)?.row !== m.row;
    });
    if (changed) model.arrangeTasks(patches);
  }

  /**
   * Balken verschieben – mit allen ausgewählten (gleicher Versatz in Zeit, Band und Zeile).
   * Waagrecht tageweise, senkrecht auf eine Zeile im Ziel-Band (gestrichelter Platzhalter).
   * Ein Klick ohne Ziehen wählt nur diesen Balken aus (auch aus einer Mehrfachauswahl heraus).
   */
  function startMove(event, id) {
    const { type, ids } = ui.selection;
    const group = type === 'task' && ids.includes(id) ? [id, ...ids.filter((x) => x !== id)] : [id];
    if (group.length === 1) actions.select('task', id);
    const layout = board.currentLayout();
    const leadTask = model.getTask(id);
    const leadBox = layout.boxes.get(id);

    dragWithPreview(event, (p, origin) => {
      const days = daysBetween(origin.x, p.x);
      const centerY = leadBox.y + C.BAR_HEIGHT / 2 + (p.y - origin.y);
      const priority = PB.layout.priorityAt(layout, centerY);
      const slot = PB.layout.slotAt(layout, priority, leadTask.theme || null, centerY);
      const priorityShift = priority - leadTask.priority;
      const rowShift = slot.row - (priority === leadTask.priority ? leadBox.row : 0);
      const moves = group.map((taskId) => {
        const t = model.getTask(taskId);
        const box = layout.boxes.get(taskId);
        return {
          id: taskId,
          start: Math.max(0, t.start + days),
          priority: U.clamp(t.priority + priorityShift, 1, C.PRIORITY_LEVELS),
          row: Math.max(0, (taskId === id ? slot.row : box.row + rowShift)),
        };
      });
      const start = moves[0].start;
      return {
        preview: {
          ids: group,
          dx: (start - leadTask.start) * C.DAY_WIDTH,
          dy: p.y - origin.y,
          priority,
          start,
          slot: { x: PB.layout.dayX(start), top: slot.top, width: leadBox.w },
        },
        commit: () => commitMove(moves, layout),
      };
    }, () => actions.select('task', id)); // Klick ohne Ziehen: nur diesen Balken auswählen
  }

  /**
   * Einordnung eines gezogenen Rahmens unter die anderen Rahmen desselben Bands.
   * Liefert die neue Themen-Reihenfolge des Bands und die Linie, an der eingefügt wird.
   */
  function frameInsertion(layout, themeId, priority, centerY) {
    const frames = layout.frames.filter((f) => f.priority === priority).sort((a, b) => a.y - b.y);
    const self = frames.find((f) => f.themeId === themeId);
    const others = frames.filter((f) => f !== self);
    const index = others.filter((f) => f.y + f.height / 2 < centerY).length;
    const order = others.map((f) => f.themeId);
    order.splice(index, 0, themeId);
    const lineY = index < others.length
      ? others[index].y - C.SECTION_GAP / 2
      : (others.length ? others[others.length - 1].y + others[others.length - 1].height : self.y) + C.SECTION_GAP / 2;
    const left = Math.min(...frames.map((f) => f.x));
    const right = Math.max(...frames.map((f) => f.x + f.width));
    const unchanged = order.every((id, i) => id === frames[i].themeId);
    return { order, unchanged, line: { x: left, top: lineY - 2, width: right - left } };
  }

  /**
   * Ganzen Rahmen (alle Aufgaben eines Themas in diesem Band) verschieben:
   *  - waagrecht: zeitlich
   *  - senkrecht im selben Band: Reihenfolge der Rahmen ändern (Linie zeigt die Einfügestelle)
   *  - in ein anderes Band: Zeilen werden unter einen bestehenden Rahmen desselben Themas gehängt
   * Ein Klick ohne Bewegung öffnet das Thema.
   */
  function startFrameMove(event, themeId, priority) {
    const layout = board.currentLayout();
    const members = model.getState().tasks.filter((t) => t.theme === themeId && t.priority === priority);
    if (!members.length) return;
    const earliest = Math.min(...members.map((t) => t.start));
    const title = model.getTheme(themeId).title;
    const frame = layout.frames.find((f) => f.themeId === themeId && f.priority === priority);

    dragWithPreview(event, (p, origin) => {
      const days = daysBetween(origin.x, p.x);
      const target = PB.layout.priorityAt(layout, p.y);
      const sameBand = target === priority;
      const rowOffset = sameBand ? 0 : PB.layout.rowsIn(layout, target, themeId);
      const insertion = sameBand ? frameInsertion(layout, themeId, priority, frame.y + frame.height / 2 + (p.y - origin.y)) : null;
      const reorder = insertion && !insertion.unchanged;
      const moves = members.map((t) => ({
        id: t.id,
        start: Math.max(0, t.start + days),
        priority: target,
        row: layout.boxes.get(t.id).row + rowOffset,
      }));
      return {
        preview: {
          ids: members.map((t) => t.id),
          dx: (Math.max(0, earliest + days) - earliest) * C.DAY_WIDTH,
          dy: p.y - origin.y,
          priority: target,
          start: Math.max(0, earliest + days),
          label: `${title} · `,
          frame: { themeId, priority },
          line: reorder ? insertion.line : null,
        },
        commit: () => {
          const patches = new Map();
          layout.boxes.forEach((box, id) => patches.set(id, { row: box.row }));
          moves.forEach((m) => patches.set(m.id, { start: m.start, priority: m.priority, row: m.row }));
          if (days !== 0 || !sameBand || reorder) model.arrangeTasks(patches, { themeOrder: reorder ? insertion.order : null });
        },
      };
    }, () => actions.select('theme', themeId));
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
