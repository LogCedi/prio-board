/**
 * Einstiegspunkt: verbindet Modell, Darstellung, Interaktionen und Werkzeugleiste.
 *
 * Datenfluss:  Benutzeraktion → PB.model (Änderung + Zeitplan) → Ereignis → onModelChange()
 *              → Analyse → Zeitachse + Seitenleiste neu zeichnen → im Browser speichern.
 */
PB.app = (() => {
  const C = PB.config;
  const U = PB.util;
  const model = PB.model;
  const board = PB.board;
  const sidebar = PB.sidebar;
  const storage = PB.storage;
  const format = PB.format;
  const ui = PB.ui;

  const $ = (selector) => document.querySelector(selector);
  let analysis = null;
  let toastTimer = null;
  let previewFrame = null;

  /* ---------- Start ---------- */

  function init() {
    PB.diagramStyles.inject();
    PB.icons.hydrate();

    board.init({ canvas: $('#canvas'), sizer: $('#sizer'), world: $('#world') });
    sidebar.init({ tabs: $('#sideTabs'), body: $('#sideBody') }, {
      goTo, hover, addDependency, toast, selectTasks, run: runAction,
    });
    PB.interactions.init({ canvas: $('#canvas'), world: $('#world') }, {
      select, selectTasks, toggleTask, clearSelection, hover, addDependency, focusTitle, createAt, preview,
      viewChanged: persist,
    });

    model.subscribe(onModelChange);
    bindToolbar();
    bindFileMenu();
    bindBoardTitle();
    bindKeyboard();

    const saved = storage.loadLocal();
    model.load(saved ? saved.state : format.parse(PB.example));
    requestAnimationFrame(() => {
      board.fit();
      updateHeader();
      persist();
      if (saved?.migrated) reportMigration(saved);
      else if (saved?.repairs.length) reportRepairs(saved);
    });
  }

  function onModelChange(meta = {}) {
    dropStaleSelection();
    analysis = PB.analysis.analyze(model);
    board.render(analysis);
    sidebar.render(analysis, { silent: meta.source === 'sidebar' });
    updateHeader();
    persist();
  }

  /** Live-Vorschau während des Ziehens (höchstens einmal pro Frame). */
  function preview() {
    if (previewFrame) return;
    previewFrame = requestAnimationFrame(() => {
      previewFrame = null;
      analysis = PB.analysis.analyze(model);
      board.render(analysis);
    });
  }

  /** Speichert im Browser; zeigt einen Hinweis, wenn das nicht möglich ist (z. B. Vorschau/Sandbox). */
  function persist() {
    $('#saveWarning').hidden = storage.saveLocal(model.getState());
  }

  function reportRepairs({ repairs, backupKey }) {
    const list = repairs.slice(0, 6).map((r) => `• ${r}`).join('\n');
    const more = repairs.length > 6 ? `\n• … (+${repairs.length - 6})` : '';
    PB.dialog.alert(
      `Dein gespeichertes Board hatte kleine Fehler und wurde automatisch repariert:\n${list}${more}\n\n` +
      `Das Original ist im Browser gesichert (${backupKey}).`,
      { title: 'Board repariert' });
  }

  function reportMigration({ fromVersion }) {
    const timeline = fromVersion < 2
      ? '• Neue Zeitachse: Priorität = bisherige Position (links = hoch), Dauer = bisheriger Aufwand (1 PT ≈ 1 Arbeitstag)\n' +
        '• Startdaten wurden einmalig aus den Abhängigkeiten vorgeschlagen – danach frei verschiebbar\n'
      : '';
    PB.dialog.alert(
      'Dein Board wurde auf die neue Version umgestellt:\n' + timeline +
      '• Themen werden als Rahmen gezeigt; jede Aufgabe gehört zu höchstens einem Thema\n' +
      '  (Abhängigkeiten weiterer Themen wurden direkt auf die Aufgabe übertragen)\n' +
      '• Intensität (intensiv / mittel / nebenbei) gibt es jetzt auch pro Iteration\n\n' +
      'Das alte Board bleibt im Browser gesichert.',
      { title: 'Board umgestellt' });
  }

  /* ---------- Auswahl & Navigation ---------- */

  function setSelection(type, ids) {
    ui.selection = { type: ids.length ? type : null, ids };
    if (ids.length) ui.tab = 'details';
    else if (ui.tab === 'details') ui.tab = 'plan';
    board.applySelection();
    sidebar.render(analysis);
  }

  const select = (type, id) => setSelection(type, [id]);
  const selectTasks = (ids) => setSelection('task', ids);
  const selectedTasks = () => (ui.selection.type === 'task' ? ui.selection.ids : []);

  /** Strg/Shift-Klick: Aufgabe zur Auswahl hinzufügen oder daraus entfernen. */
  function toggleTask(id) {
    const ids = selectedTasks();
    selectTasks(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  }

  function clearSelection() {
    if (ui.selection.type) setSelection(null, []);
  }

  function dropStaleSelection() {
    const exists = { task: model.getTask, theme: model.getTheme, dependency: model.getDependency }[ui.selection.type];
    if (!exists) return;
    const ids = ui.selection.ids.filter((id) => exists(id));
    ui.selection = { type: ids.length ? ui.selection.type : null, ids };
  }

  function hover(id) {
    if (ui.hoverId === id) return;
    ui.hoverId = id;
    board.applyHighlight();
  }

  function goTo(id) {
    if (model.isTheme(id)) {
      select('theme', id);
      return;
    }
    board.scrollTo(id);
    select('task', id);
  }

  function focusTitle() {
    const input = $('#sideBody [data-field="title"], #sideBody [data-theme-field="title"]');
    if (input) {
      input.focus();
      input.select();
    }
  }

  /* ---------- Aktionen ---------- */

  function addTask(kind, position) {
    const id = model.addTask(kind, position);
    board.scrollTo(id);
    select('task', id);
    focusTitle();
  }

  /** Neue Aufgabe an der sichtbaren Stelle (Werkzeugleiste). */
  function addTaskInView(kind) {
    const center = board.viewportCenter();
    addTask(kind, { start: board.dayAt(center.x), priority: board.priorityAt(center.y) });
  }

  /** Doppelklick auf freie Fläche: kleines Menü „Denken / Umsetzung“. */
  function createAt(position, clientX, clientY) {
    const menu = $('#createMenu');
    menu.hidden = false;
    menu.style.left = `${Math.min(clientX, window.innerWidth - 200)}px`;
    menu.style.top = `${Math.min(clientY, window.innerHeight - 110)}px`;
    menu.onclick = (event) => {
      const button = event.target.closest('[data-kind]');
      menu.hidden = true;
      if (button) addTask(button.dataset.kind, position);
    };
  }

  /** Neues Thema; ausgewählte Aufgaben werden ihm direkt zugeordnet. */
  function addTheme() {
    const tasks = selectedTasks();
    const id = model.addTheme();
    if (tasks.length) {
      const result = model.assignTheme(tasks, id);
      if (!result.ok) toast(result.error);
    }
    select('theme', id);
    focusTitle();
  }

  function addDependency(from, to, fromIteration = null) {
    const result = model.addDependency(from, to, fromIteration);
    const fromTask = model.getTask(from);
    const iteration = fromIteration !== null && fromTask?.iterations[fromIteration];
    toast(result.ok
      ? `„${model.getNode(to).title}“ hängt jetzt von „${model.getNode(from).title}“${iteration ? ` (bis „${iteration.title}“)` : ''} ab`
      : result.error);
  }

  function deleteSelection() {
    const { type, ids } = ui.selection;
    if (type === 'task') model.removeTasks(ids);
    if (type === 'theme') ids.forEach(model.removeTheme);
    if (type === 'dependency') ids.forEach(model.removeDependency);
  }

  function duplicateSelection() {
    const ids = selectedTasks();
    if (ids.length !== 1) return;
    const copy = model.duplicateTask(ids[0]);
    if (copy) select('task', copy);
  }

  function reverseSelectedDependency() {
    if (ui.selection.type !== 'dependency') return;
    const result = model.reverseDependency(ui.selection.ids[0]);
    if (!result.ok) toast(result.error);
  }

  function runAction(name) {
    const handlers = {
      delete: deleteSelection,
      duplicate: duplicateSelection,
      'reverse-dependency': reverseSelectedDependency,
      'add-theme': addTheme,
      'clear-selection': clearSelection,
    };
    handlers[name]?.();
  }

  /* ---------- Import / Export ---------- */

  const fileName = (extension) => `${U.slugify(model.getState().board.title)}-${U.today()}.${extension}`;

  function exportJson() {
    const filename = fileName('json');
    const content = JSON.stringify(format.serialize(model.getState(), { model, analysis }), null, 2);
    PB.dialog.exportFile({
      title: 'Export (JSON)',
      description: 'Das Board im Format „prio-board“ – mit „Import“ wieder ladbar.',
      filename,
      content,
      download: () => storage.downloadText(content, filename, 'application/json'),
    });
  }

  function exportHtml() {
    const filename = fileName('html');
    const content = PB.staticExport.build(analysis);
    PB.dialog.exportFile({
      title: 'Als HTML',
      description: 'Eigenständige Seite nur mit dem Diagramm – zum Verschicken oder Ablegen. Lässt sich auch wieder importieren.',
      filename,
      content,
      download: () => storage.downloadText(content, filename, 'text/html'),
    });
  }

  async function importBoard() {
    let text = await PB.dialog.importFile();
    if (!text) return;
    try {
      if (/^\s*</.test(text)) {
        text = PB.staticExport.extractData(text);
        if (!text) throw new format.FormatError(['Die HTML-Datei enthält keine Prio-Board-Daten']);
      }
      model.replace(format.parse(text));
      clearSelection();
      board.fit();
      updateHeader();
      persist();
      toast(`„${model.getState().board.title}“ importiert`);
    } catch (error) {
      if (!(error instanceof format.FormatError)) console.error(error);
      PB.dialog.alert(error instanceof format.FormatError ? error.message : `Import fehlgeschlagen: ${error.message}`,
        { title: 'Import nicht möglich' });
    }
  }

  async function loadExample() {
    if (!await PB.dialog.confirm('Aktuelles Board durch das Beispiel ersetzen?\n(Rückgängig möglich)', { okLabel: 'Ersetzen' })) return;
    model.replace(format.parse(PB.example));
    board.fit();
    updateHeader();
    persist();
  }

  async function clearBoard() {
    if (!await PB.dialog.confirm('Alle Aufgaben, Themen und Abhängigkeiten entfernen?\n(Rückgängig möglich)', { okLabel: 'Leeren', danger: true })) return;
    model.clear();
  }

  /* ---------- Werkzeugleiste ---------- */

  function bindToolbar() {
    const on = (selector, handler) => $(selector).addEventListener('click', handler);
    on('#addThinking', () => addTaskInView('thinking'));
    on('#addImplementation', () => addTaskInView('implementation'));
    on('#addTheme', addTheme);
    on('#undo', model.undo);
    on('#redo', model.redo);
    const zoomBy = (factor) => {
      board.setZoom(model.getState().view.zoom * factor);
      updateHeader();
      persist();
    };
    on('#zoomIn', () => zoomBy(C.ZOOM.step));
    on('#zoomOut', () => zoomBy(1 / C.ZOOM.step));
    on('#fit', () => { board.fit(); updateHeader(); persist(); });
    $('#focusMode').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-focus]');
      if (!button) return;
      ui.focusMode = button.dataset.focus;
      updateHeader();
      board.applyHighlight();
    });
    on('#exportJson', exportJson);
    on('#exportHtml', exportHtml);
    on('#importJson', importBoard);
    on('#loadExample', loadExample);
    on('#clearBoard', clearBoard);
    on('#saveWarning', () => PB.dialog.alert(
      'Diese Ansicht darf nichts im Browser speichern (z. B. eingebettete Vorschau).\n' +
      'Änderungen gehen beim Schliessen verloren. Sichere dein Board über Datei ▸ Export\n' +
      'oder öffne prio-board.html direkt im Browser (Chrome, Edge, Firefox).',
      { title: 'Nicht gespeichert' }));
  }

  function bindFileMenu() {
    const menu = $('#fileMenu');
    const button = $('#fileMenuButton');
    const createMenu = $('#createMenu');
    const setOpen = (open) => {
      menu.classList.toggle('open', open);
      button.setAttribute('aria-expanded', String(open));
    };
    button.addEventListener('click', () => setOpen(!menu.classList.contains('open')));
    menu.querySelector('.menu-panel').addEventListener('click', () => setOpen(false));
    document.addEventListener('pointerdown', (event) => {
      if (!menu.contains(event.target)) setOpen(false);
      if (!createMenu.contains(event.target)) createMenu.hidden = true;
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      createMenu.hidden = true;
    });
  }

  function bindBoardTitle() {
    const title = $('#boardTitle');
    title.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        title.blur();
      }
    });
    title.addEventListener('blur', () => model.setBoardTitle(title.textContent));
  }

  function updateHeader() {
    const { board: info, view } = model.getState();
    const title = $('#boardTitle');
    if (document.activeElement !== title) title.textContent = info.title;
    document.title = `${info.title} – Prio-Board`;
    $('#undo').disabled = !model.canUndo();
    $('#redo').disabled = !model.canRedo();
    $('#zoomLabel').textContent = `${Math.round(view.zoom * 100)}%`;
    document.querySelectorAll('#focusMode button').forEach((b) => b.classList.toggle('on', b.dataset.focus === ui.focusMode));
  }

  /* ---------- Tastatur ---------- */

  function bindKeyboard() {
    document.addEventListener('keydown', (event) => {
      const active = document.activeElement;
      const typing = active && (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) || active.isContentEditable);
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (event.key === 'Escape') {
        if (typing) active.blur();
        clearSelection();
        return;
      }
      if (typing || document.querySelector('dialog[open]')) return;
      if (mod && key === 'z') { event.preventDefault(); event.shiftKey ? model.redo() : model.undo(); }
      else if (mod && key === 'y') { event.preventDefault(); model.redo(); }
      else if (mod && key === 'd') { event.preventDefault(); duplicateSelection(); }
      else if (mod && key === 'a') { event.preventDefault(); selectTasks(model.getState().tasks.map((t) => t.id)); }
      else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection(); }
    });
  }

  /* ---------- Meldungen ---------- */

  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  return { init };
})();

PB.app.init();
