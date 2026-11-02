/**
 * Datenmodell des Boards: Zustand, Abfragen, Änderungen und Undo/Redo.
 *
 * Zustand (identisch mit dem Datenteil des JSON-Formats):
 *   { board: { title }, view: { zoom, showPriorityAxis },
 *     groups: [{ id, title, description, layout }],
 *     tasks:  [{ id, kind, title, description, notes[], status, effortDays, layout }],
 *     dependencies: [{ id, from, to }] }      // from muss vor to fertig sein
 *
 * Gruppenzugehörigkeit wird NICHT gespeichert, sondern aus der Geometrie
 * abgeleitet: ein Element gehört zur kleinsten (grösseren) Gruppe, die seinen
 * Mittelpunkt enthält.
 *
 * Änderungen melden sich über subscribe(fn) mit einem meta-Objekt { type, source }.
 */
PB.model = (() => {
  const C = PB.config;
  const U = PB.util;

  let state = createEmptyState();
  let parents = new Map();
  const past = [];
  const future = [];
  const listeners = new Set();

  function createEmptyState(title = 'Prio-Board', view = { zoom: 1, showPriorityAxis: true }) {
    return { board: { title }, view: { ...view }, groups: [], tasks: [], dependencies: [] };
  }

  /* ---------- Ereignisse ---------- */

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function emit(meta) {
    listeners.forEach((fn) => fn(meta));
  }

  /* ---------- Abfragen ---------- */

  const getState = () => state;
  const allNodes = () => [...state.groups, ...state.tasks];
  const getNode = (id) => state.tasks.find((n) => n.id === id) || state.groups.find((n) => n.id === id) || null;
  const isGroup = (id) => state.groups.some((g) => g.id === id);
  const getDependency = (id) => state.dependencies.find((d) => d.id === id) || null;

  const parentOf = (id) => parents.get(id) ?? null;
  const childrenOf = (id) => allNodes().filter((n) => parents.get(n.id) === id);

  function descendantsOf(id) {
    const result = [];
    const walk = (parentId) => childrenOf(parentId).forEach((child) => {
      result.push(child.id);
      walk(child.id);
    });
    walk(id);
    return result;
  }

  function ancestorsOf(id) {
    const result = [];
    for (let p = parentOf(id); p && !result.includes(p); p = parentOf(p)) result.push(p);
    return result;
  }

  /** Alle Aufgaben-IDs, die ein Knoten repräsentiert (Aufgabe selbst oder Inhalt einer Gruppe). */
  function tasksWithin(id) {
    if (!isGroup(id)) return getNode(id) ? [id] : [];
    return descendantsOf(id).filter((d) => !isGroup(d));
  }

  const areNested = (a, b) => ancestorsOf(a).includes(b) || ancestorsOf(b).includes(a);

  /* ---------- Hierarchie ---------- */

  function rebuildHierarchy() {
    parents = new Map();
    for (const node of allNodes()) {
      const c = U.center(node.layout);
      const ownArea = U.area(node.layout);
      let best = null;
      let bestArea = Infinity;
      for (const group of state.groups) {
        if (group.id === node.id) continue;
        const a = U.area(group.layout);
        if (a > ownArea && a < bestArea && U.containsPoint(group.layout, c)) {
          best = group.id;
          bestArea = a;
        }
      }
      if (best) parents.set(node.id, best);
    }
  }

  /* ---------- Historie ---------- */

  function checkpoint() {
    past.push(JSON.stringify(state));
    if (past.length > C.HISTORY_LIMIT) past.shift();
    future.length = 0;
  }
  function restore(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify(state));
    state = JSON.parse(from.pop());
    rebuildHierarchy();
    emit({ type: 'history' });
  }
  const undo = () => restore(past, future);
  const redo = () => restore(future, past);
  const canUndo = () => past.length > 0;
  const canRedo = () => future.length > 0;

  /* ---------- Ganzes Board ---------- */

  /** Lädt einen Zustand ohne Historieneintrag (Programmstart). */
  function load(next) {
    state = next;
    rebuildHierarchy();
    emit({ type: 'load' });
  }
  /** Ersetzt den Zustand mit Historieneintrag (Import, Beispiel, Leeren). */
  function replace(next) {
    checkpoint();
    load(next);
  }
  const clear = () => replace(createEmptyState(state.board.title, state.view));

  function setBoardTitle(title) {
    const clean = String(title).trim() || 'Prio-Board';
    if (clean === state.board.title) return;
    checkpoint();
    state.board.title = clean;
    emit({ type: 'board' });
  }

  /** Ansichtseinstellungen (Zoom, Achse) – ohne Historie und ohne Ereignis. */
  function setView(patch) {
    Object.assign(state.view, patch);
  }

  /* ---------- Knoten ---------- */

  /** Nächster freier Platz (keine Überlappung mit Aufgaben) möglichst nahe an position. */
  function placeAt(position, size) {
    const STEP = C.GRID * 2;
    const MAX_RADIUS = 30;
    const origin = {
      x: Math.max(0, U.snap(position.x - size.width / 2)),
      y: Math.max(0, U.snap(position.y - size.height / 2)),
    };
    const margin = C.GRID;
    const overlaps = (l) => state.tasks.some((t) =>
      l.x < t.layout.x + t.layout.width + margin && l.x + l.width + margin > t.layout.x &&
      l.y < t.layout.y + t.layout.height + margin && l.y + l.height + margin > t.layout.y);

    for (let r = 0; r <= MAX_RADIUS; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // nur der Ring mit Abstand r
          const candidate = { x: origin.x + dx * STEP, y: origin.y + dy * STEP, ...size };
          if (candidate.x >= 0 && candidate.y >= 0 && !overlaps(candidate)) return candidate;
        }
      }
    }
    return { ...origin, ...size };
  }

  function addTask(kind, position) {
    const task = {
      id: U.uid('t'),
      kind,
      title: C.DEFAULT_TITLES[kind],
      description: '',
      notes: [],
      status: 'open',
      effortDays: C.DEFAULT_EFFORT[kind],
      layout: placeAt(position, C.DEFAULT_SIZE[kind]),
    };
    checkpoint();
    state.tasks.push(task);
    rebuildHierarchy();
    emit({ type: 'add', id: task.id });
    return task.id;
  }

  function addGroup(position) {
    const group = {
      id: U.uid('g'),
      title: C.DEFAULT_TITLES.group,
      description: '',
      layout: placeAt(position, C.DEFAULT_SIZE.group),
    };
    checkpoint();
    state.groups.push(group);
    rebuildHierarchy();
    emit({ type: 'add', id: group.id });
    return group.id;
  }

  /**
   * Ändert Felder eines Knotens.
   * options.record=false: kein Historieneintrag (z. B. beim Tippen, siehe checkpoint()).
   * options.source: wird im Ereignis weitergegeben (z. B. 'sidebar').
   */
  function updateNode(id, patch, { record = true, source } = {}) {
    const node = getNode(id);
    if (!node) return;
    if (record) checkpoint();
    Object.assign(node, patch);
    emit({ type: 'update', id, source });
  }

  function removeNode(id) {
    if (!getNode(id)) return;
    checkpoint();
    state.tasks = state.tasks.filter((t) => t.id !== id);
    state.groups = state.groups.filter((g) => g.id !== id);
    state.dependencies = state.dependencies.filter((d) => d.from !== id && d.to !== id);
    rebuildHierarchy();
    emit({ type: 'remove', id });
  }

  function duplicateTask(id) {
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return null;
    const copy = {
      ...JSON.parse(JSON.stringify(task)),
      id: U.uid('t'),
      title: `${task.title} (Kopie)`,
      status: 'open',
    };
    copy.layout.x += C.GRID * 2;
    copy.layout.y += C.GRID * 2;
    checkpoint();
    state.tasks.push(copy);
    rebuildHierarchy();
    emit({ type: 'add', id: copy.id });
    return copy.id;
  }

  /* ---------- Abhängigkeiten ---------- */

  /** Prüft, ob from → to erlaubt ist. Liefert null oder einen Fehlertext. */
  function validateDependency(from, to) {
    if (!getNode(from) || !getNode(to) || from === to) return 'Ungültige Abhängigkeit';
    if (areNested(from, to)) return 'Eine Gruppe und ihr eigenes Element können nicht voneinander abhängen';
    if (state.dependencies.some((d) => d.from === from && d.to === to)) return 'Diese Abhängigkeit existiert bereits';
    const candidate = [...state.dependencies, { from, to }];
    if (PB.analysis.hasCycle(PB.analysis.predecessorMap(api, candidate))) {
      return 'Nicht möglich – das würde einen Kreis (Zyklus) erzeugen';
    }
    return null;
  }

  /** Legt from → to an. Liefert { ok, error? }. */
  function addDependency(from, to) {
    const error = validateDependency(from, to);
    if (error) return { ok: false, error };
    checkpoint();
    state.dependencies.push({ id: U.uid('d'), from, to });
    emit({ type: 'dependency' });
    return { ok: true };
  }

  function removeDependency(id) {
    if (!getDependency(id)) return;
    checkpoint();
    state.dependencies = state.dependencies.filter((d) => d.id !== id);
    emit({ type: 'dependency' });
  }

  function reverseDependency(id) {
    const dep = getDependency(id);
    if (!dep) return { ok: false, error: 'Abhängigkeit nicht gefunden' };
    const others = state.dependencies.filter((d) => d.id !== id);
    const reversed = [...others, { from: dep.to, to: dep.from }];
    if (PB.analysis.hasCycle(PB.analysis.predecessorMap(api, reversed))) {
      return { ok: false, error: 'Umkehren würde einen Zyklus erzeugen' };
    }
    checkpoint();
    [dep.from, dep.to] = [dep.to, dep.from];
    emit({ type: 'dependency' });
    return { ok: true };
  }

  /* ---------- Gesten (Verschieben / Grösse ändern) ---------- */
  // Während einer Geste wird das Layout direkt geändert (ohne Ereignis),
  // damit nur Positionen aktualisiert werden müssen. endGesture() meldet die Änderung.

  const beginGesture = () => checkpoint();
  function setLayout(id, patch) {
    const node = getNode(id);
    if (node) Object.assign(node.layout, patch);
  }
  function endGesture() {
    rebuildHierarchy();
    emit({ type: 'layout' });
  }

  const api = {
    subscribe,
    // Abfragen
    getState, allNodes, getNode, isGroup, getDependency,
    parentOf, childrenOf, descendantsOf, ancestorsOf, tasksWithin, areNested,
    // Historie
    checkpoint, undo, redo, canUndo, canRedo,
    // Board
    createEmptyState, load, replace, clear, setBoardTitle, setView,
    // Knoten
    addTask, addGroup, updateNode, removeNode, duplicateTask,
    // Abhängigkeiten
    validateDependency, addDependency, removeDependency, reverseDependency,
    // Gesten
    beginGesture, setLayout, endGesture,
  };
  return api;
})();
