/**
 * Datenmodell: Zustand, Abfragen, Änderungen, Undo/Redo.
 *
 * Zustand (intern; Zeiten in Arbeitstagen ab heute, siehe calendar.js):
 *   { board: { title }, view: { zoom },
 *     themes: [{ id, title, color }],
 *     tasks:  [{ id, kind, title, description, notes[], status, priority,
 *                start, durationDays, bufferDays, intensity, ongoing,
 *                iterations: [{ title, durationDays, intensity, done }], theme, row }],
 *     dependencies: [{ id, from, to, fromIteration }] }   // from muss vor to fertig sein
 *
 * Eine Aufgabe gehört zu höchstens einem Thema (theme = id | null).
 * row = bevorzugte Zeile im Abschnitt (Thema bzw. „ohne Thema“) ihres Prio-Bands; null = automatisch.
 * from/to einer Abhängigkeit sind Aufgaben oder Themen (Thema = alle Aufgaben darin).
 * fromIteration (Index oder null): Nachfolger braucht nur diese Iteration des Vorgängers.
 *
 * Aufgaben liegen frei auf der Zeitachse – Abhängigkeiten verschieben nichts automatisch.
 * Nur Aufgaben ganz ohne Startdatum (start = null, z. B. Beispiel oder alte Boards) bekommen
 * beim Laden einmalig einen Vorschlag aus ihren Abhängigkeiten (placeUnscheduled).
 */
PB.model = (() => {
  const C = PB.config;
  const U = PB.util;

  let state = createEmptyState();
  const past = [];
  const future = [];
  const listeners = new Set();

  function createEmptyState(title = 'Prio-Board', view = { zoom: 1 }) {
    return { board: { title }, view: { ...view }, themes: [], tasks: [], dependencies: [] };
  }

  /* ---------- Ereignisse ---------- */

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  /** Änderung melden. */
  function commit(meta) {
    listeners.forEach((fn) => fn(meta));
  }

  /* ---------- Abfragen ---------- */

  const getState = () => state;
  const getTask = (id) => state.tasks.find((t) => t.id === id) || null;
  const getTheme = (id) => state.themes.find((t) => t.id === id) || null;
  const getNode = (id) => getTask(id) || getTheme(id);
  const isTheme = (id) => state.themes.some((t) => t.id === id);
  const getDependency = (id) => state.dependencies.find((d) => d.id === id) || null;
  const membersOf = (themeId) => state.tasks.filter((t) => t.theme === themeId).map((t) => t.id);

  /** Aufgaben, für die ein Knoten steht (Aufgabe selbst oder alle Aufgaben eines Themas). */
  const tasksOf = (id) => (isTheme(id) ? membersOf(id) : getTask(id) ? [id] : []);

  /** Dauer: Summe der Iterationen, falls vorhanden, sonst durationDays. */
  function durationOf(task) {
    if (task.iterations.length) return task.iterations.reduce((sum, it) => sum + it.durationDays, 0);
    return task.durationDays;
  }
  const endOf = (task) => task.start + durationOf(task);

  /** Ende der Iteration index (inkl.); ohne gültige Iteration: Ende der Aufgabe. */
  function iterationEnd(task, index) {
    if (index === null || index === undefined || !task.iterations[index]) return endOf(task);
    return task.start + task.iterations.slice(0, index + 1).reduce((sum, it) => sum + it.durationDays, 0);
  }

  const wouldCycle = (dependencies) => PB.analysis.hasCycle(PB.analysis.predecessorMap(api, dependencies));

  /* ---------- Startvorschlag ---------- */

  /**
   * Einmaliger Vorschlag für Aufgaben ohne Startdatum: frühestens nach dem Ende ihrer Vorgänger.
   * Aufgaben mit Startdatum werden nie verändert.
   */
  function placeUnscheduled() {
    const open = new Set(state.tasks.filter((t) => t.start === null || t.start === undefined).map((t) => t.id));
    if (!open.size) return;
    open.forEach((id) => { getTask(id).start = 0; });
    const edges = PB.analysis.edges(api).filter((e) => open.has(e.to));
    for (let pass = 0; pass <= state.tasks.length; pass++) {
      let changed = false;
      for (const e of edges) {
        const to = getTask(e.to);
        const earliest = iterationEnd(getTask(e.from), e.iteration);
        if (to.start < earliest) {
          to.start = earliest;
          changed = true;
        }
      }
      if (!changed) break;
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
    commit({ type: 'history' });
  }
  const undo = () => restore(past, future);
  const redo = () => restore(future, past);
  const canUndo = () => past.length > 0;
  const canRedo = () => future.length > 0;

  /* ---------- Ganzes Board ---------- */

  /** Lädt einen Zustand ohne Historieneintrag (Programmstart). */
  function load(next) {
    state = next;
    placeUnscheduled();
    commit({ type: 'load' });
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
    commit({ type: 'board' });
  }

  /** Ansichtseinstellungen (Zoom) – ohne Historie und ohne Ereignis. */
  function setView(patch) {
    Object.assign(state.view, patch);
  }

  /* ---------- Aufgaben ---------- */

  function addTask(kind, { priority = 3, start = 0 } = {}) {
    const task = {
      id: U.uid('t'),
      kind,
      title: C.DEFAULT_TITLES[kind],
      description: '',
      notes: [],
      status: 'open',
      priority: U.clamp(priority, 1, C.PRIORITY_LEVELS),
      start: Math.max(0, Math.round(start)),
      durationDays: C.DEFAULT_DURATION[kind],
      bufferDays: 0,
      intensity: 'focused',
      ongoing: false,
      iterations: [],
      theme: null,
      row: null,
    };
    checkpoint();
    state.tasks.push(task);
    commit({ type: 'add', id: task.id });
    return task.id;
  }

  /** Nur Denk-Themen haben Iterationen; Pfeile „ab Iteration“ gelten sonst für die ganze Aufgabe. */
  function normalizeKind(task) {
    if (task.kind === 'thinking' || (!task.iterations.length && !task.ongoing)) return;
    if (task.iterations.length) task.durationDays = durationOf(task);
    task.iterations = [];
    task.ongoing = false;
    state.dependencies.forEach((d) => { if (d.from === task.id) d.fromIteration = null; });
  }

  /**
   * Ändert Felder einer Aufgabe (nicht das Thema – dafür assignTheme).
   * options.record=false: kein Historieneintrag (z. B. beim Tippen, siehe checkpoint()).
   * options.source: wird im Ereignis weitergegeben (z. B. 'sidebar').
   */
  function updateTask(id, patch, { record = true, source } = {}) {
    const task = getTask(id);
    if (!task) return;
    if (record) checkpoint();
    Object.assign(task, patch);
    normalizeKind(task);
    commit({ type: 'update', id, source });
  }

  /** Gleiche Änderung für mehrere Aufgaben (ein Historieneintrag). */
  function updateTasks(ids, patch) {
    const tasks = ids.map(getTask).filter(Boolean);
    if (!tasks.length) return;
    checkpoint();
    tasks.forEach((task) => {
      Object.assign(task, patch);
      normalizeKind(task);
    });
    commit({ type: 'update' });
  }

  function removeTasks(ids) {
    const remove = new Set(ids.filter(getTask));
    if (!remove.size) return;
    checkpoint();
    state.tasks = state.tasks.filter((t) => !remove.has(t.id));
    state.dependencies = state.dependencies.filter((d) => !remove.has(d.from) && !remove.has(d.to));
    commit({ type: 'remove' });
  }

  function duplicateTask(id) {
    const task = getTask(id);
    if (!task) return null;
    const copy = { ...JSON.parse(JSON.stringify(task)), id: U.uid('t'), title: `${task.title} (Kopie)`, status: 'open', row: null };
    copy.iterations.forEach((it) => { it.done = false; });
    checkpoint();
    state.tasks.push(copy);
    commit({ type: 'add', id: copy.id });
    return copy.id;
  }

  /* ---------- Iterationen (nur Denken) ---------- */

  function addIteration(taskId) {
    const task = getTask(taskId);
    if (!task || task.kind !== 'thinking') return;
    checkpoint();
    // Erste Iteration übernimmt die bisherige Dauer, weitere starten mit einer Woche
    const durationDays = task.iterations.length ? 5 : task.durationDays;
    task.iterations.push({ title: `Iteration ${task.iterations.length + 1}`, durationDays, intensity: task.intensity, done: false });
    commit({ type: 'update', id: taskId });
  }

  function updateIteration(taskId, index, patch, { record = true, source } = {}) {
    const iteration = getTask(taskId)?.iterations[index];
    if (!iteration) return;
    if (record) checkpoint();
    Object.assign(iteration, patch);
    iteration.durationDays = Math.max(1, Math.round(iteration.durationDays) || 1);
    commit({ type: 'update', id: taskId, source });
  }

  function removeIteration(taskId, index) {
    const task = getTask(taskId);
    if (!task?.iterations[index]) return;
    checkpoint();
    if (task.iterations.length === 1) task.durationDays = task.iterations[0].durationDays;
    task.iterations.splice(index, 1);
    for (const dep of state.dependencies) {
      if (dep.from !== taskId || dep.fromIteration === null) continue;
      if (dep.fromIteration === index) dep.fromIteration = null;
      else if (dep.fromIteration > index) dep.fromIteration -= 1;
    }
    commit({ type: 'update', id: taskId });
  }

  /* ---------- Themen ---------- */

  function addTheme() {
    const used = new Set(state.themes.map((t) => t.color));
    const color = C.THEME_COLORS.find((c) => !used.has(c)) || C.THEME_COLORS[state.themes.length % C.THEME_COLORS.length];
    const theme = { id: U.uid('th'), title: C.DEFAULT_TITLES.theme, color };
    checkpoint();
    state.themes.push(theme);
    commit({ type: 'add', id: theme.id });
    return theme.id;
  }

  function updateTheme(id, patch, { record = true, source } = {}) {
    const theme = getTheme(id);
    if (!theme) return;
    if (record) checkpoint();
    Object.assign(theme, patch);
    commit({ type: 'update', id, source });
  }

  function removeTheme(id) {
    if (!getTheme(id)) return;
    checkpoint();
    state.themes = state.themes.filter((t) => t.id !== id);
    state.tasks.forEach((t) => { if (t.theme === id) t.theme = null; });
    state.dependencies = state.dependencies.filter((d) => d.from !== id && d.to !== id);
    commit({ type: 'remove', id });
  }

  /**
   * Ordnet Aufgaben einem Thema zu (themeId = null: aus dem Thema nehmen).
   * Abgelehnt, wenn dadurch ein Zyklus entstünde oder eine Aufgabe von ihrem eigenen Thema abhinge
   * (Zyklen ergeben keine sinnvolle Reihenfolge, auch ohne automatisches Schieben).
   */
  function assignTheme(ids, themeId) {
    const tasks = ids.map(getTask).filter(Boolean);
    if (!tasks.length || (themeId !== null && !getTheme(themeId))) return { ok: false, error: 'Ungültiges Thema' };
    const direct = themeId && state.dependencies.some((d) =>
      (d.to === themeId && ids.includes(d.from)) || (d.from === themeId && ids.includes(d.to)));
    if (direct) return { ok: false, error: 'Eine Aufgabe kann nicht von ihrem eigenen Thema abhängen (oder umgekehrt)' };
    const before = tasks.map((t) => t.theme);
    tasks.forEach((t) => { t.theme = themeId; });
    const cyclic = wouldCycle();
    tasks.forEach((t, i) => { t.theme = before[i]; });
    if (cyclic) return { ok: false, error: 'Nicht möglich – das Thema würde einen Kreis (Zyklus) erzeugen' };
    checkpoint();
    tasks.forEach((t) => { t.theme = themeId; });
    commit({ type: 'update' });
    return { ok: true };
  }

  /* ---------- Abhängigkeiten ---------- */

  /** Prüft, ob from → to erlaubt ist. Liefert null oder einen Fehlertext. */
  function validateDependency(from, to, dependencies = state.dependencies) {
    if (!getNode(from) || !getNode(to) || from === to) return 'Ungültige Abhängigkeit';
    if ((isTheme(to) && getTask(from)?.theme === to) || (isTheme(from) && getTask(to)?.theme === from)) {
      return 'Ein Thema und eine Aufgabe darin können nicht voneinander abhängen';
    }
    if (dependencies.some((d) => d.from === from && d.to === to)) return 'Diese Abhängigkeit existiert bereits';
    if (wouldCycle([...dependencies, { from, to }])) return 'Nicht möglich – das würde einen Kreis (Zyklus) erzeugen';
    return null;
  }

  /** Legt from → to an (optional nur ab einer Iteration). Liefert { ok, error? }. */
  function addDependency(from, to, fromIteration = null) {
    const error = validateDependency(from, to);
    if (error) return { ok: false, error };
    const iteration = getTask(from)?.iterations[fromIteration] ? fromIteration : null;
    checkpoint();
    state.dependencies.push({ id: U.uid('d'), from, to, fromIteration: iteration });
    commit({ type: 'dependency' });
    return { ok: true };
  }

  function removeDependency(id) {
    if (!getDependency(id)) return;
    checkpoint();
    state.dependencies = state.dependencies.filter((d) => d.id !== id);
    commit({ type: 'dependency' });
  }

  function setDependencyIteration(id, fromIteration) {
    const dep = getDependency(id);
    const task = dep && getTask(dep.from);
    if (!task) return;
    checkpoint();
    dep.fromIteration = task.iterations[fromIteration] ? fromIteration : null;
    commit({ type: 'dependency' });
  }

  function reverseDependency(id) {
    const dep = getDependency(id);
    if (!dep) return { ok: false, error: 'Abhängigkeit nicht gefunden' };
    const error = validateDependency(dep.to, dep.from, state.dependencies.filter((d) => d.id !== id));
    if (error) return { ok: false, error: `Umkehren nicht möglich: ${error}` };
    checkpoint();
    [dep.from, dep.to] = [dep.to, dep.from];
    dep.fromIteration = null;
    commit({ type: 'dependency' });
    return { ok: true };
  }

  /**
   * Mehrere Aufgaben gleichzeitig ändern (z. B. Start, Priorität, Zeile nach dem Verschieben)
   * – ein Historieneintrag. patches = Map<taskId, Teiländerung>.
   */
  function arrangeTasks(patches) {
    if (!patches.size) return;
    checkpoint();
    patches.forEach((patch, id) => {
      const task = getTask(id);
      if (task) Object.assign(task, patch);
    });
    commit({ type: 'layout' });
  }

  /* ---------- Gesten (Dauer/Puffer ziehen) ---------- */
  // Während einer Geste wird direkt geändert (ohne Ereignis); endGesture() meldet die Änderung.

  const beginGesture = () => checkpoint();

  /** Vorschau während einer Geste (ohne Ereignis). */
  function previewTask(id, patch) {
    const task = getTask(id);
    if (task) Object.assign(task, patch);
  }

  /** Iterationsdauer während einer Geste ändern (Grösse der letzten Iteration). */
  function previewIteration(id, index, durationDays) {
    const iteration = getTask(id)?.iterations[index];
    if (iteration) iteration.durationDays = Math.max(1, durationDays);
  }

  function endGesture() {
    commit({ type: 'layout' });
  }

  const api = {
    subscribe,
    // Abfragen
    getState, getTask, getTheme, getNode, isTheme, getDependency, membersOf, tasksOf,
    durationOf, endOf, iterationEnd,
    // Historie
    checkpoint, undo, redo, canUndo, canRedo,
    // Board
    load, replace, clear, setBoardTitle, setView,
    // Aufgaben & Iterationen
    addTask, updateTask, updateTasks, removeTasks, duplicateTask, addIteration, updateIteration, removeIteration,
    // Themen
    addTheme, updateTheme, removeTheme, assignTheme,
    // Abhängigkeiten
    validateDependency, addDependency, removeDependency, setDependencyIteration, reverseDependency,
    // Gesten
    arrangeTasks, beginGesture, previewTask, previewIteration, endGesture,
  };
  return api;
})();
