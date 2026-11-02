/**
 * Einstiegspunkt: verbindet Modell, Darstellung, Interaktionen und Werkzeugleiste.
 *
 * Datenfluss:  Benutzeraktion → PB.model (Änderung) → Ereignis → onModelChange()
 *              → Analyse → Board + Seitenleiste neu zeichnen → im Browser speichern.
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

  /* ---------- Start ---------- */

  function init() {
    PB.diagramStyles.inject();
    PB.icons.hydrate();

    board.init({
      canvas: $('#canvas'),
      sizer: $('#sizer'),
      world: $('#world'),
      zones: $('#zones'),
      links: $('#links'),
      linkLayer: $('#linkLayer'),
      draft: $('#draftLink'),
    });
    sidebar.init({ tabs: $('#sideTabs'), body: $('#sideBody') }, {
      goTo, hover, addDependency, run: runAction,
    });
    PB.interactions.init({ canvas: $('#canvas'), world: $('#world') }, {
      select, clearSelection, hover, addDependency, focusTitle, viewChanged: persist,
    });

    model.subscribe(onModelChange);
    bindToolbar();
    bindBoardTitle();
    bindKeyboard();

    const saved = storage.loadLocal();
    model.load(saved ? saved.state : format.parse(PB.example));
    requestAnimationFrame(() => {
      board.fit();
      updateHeader();
      persist();
      if (saved?.repairs.length) reportRepairs(saved);
    });
  }

  function onModelChange(meta = {}) {
    dropStaleSelection();
    analysis = PB.analysis.analyze(model);
    board.render(analysis);
    if (meta.source !== 'sidebar') sidebar.render(analysis);
    updateHeader();
    persist();
  }

  /** Speichert im Browser; zeigt einen Hinweis, wenn das nicht möglich ist (z. B. Vorschau/Sandbox). */
  function persist() {
    const saved = storage.saveLocal(model.getState());
    $('#saveWarning').hidden = saved;
  }

  function reportRepairs({ repairs, backupKey }) {
    const list = repairs.slice(0, 6).map((r) => `• ${r}`).join('\n');
    const more = repairs.length > 6 ? `\n• … (+${repairs.length - 6})` : '';
    PB.dialog.alert(
      `Dein gespeichertes Board hatte kleine Fehler und wurde automatisch repariert:\n${list}${more}\n\n` +
      `Das Original ist im Browser gesichert (${backupKey}).`,
      { title: 'Board repariert' });
  }

  /* ---------- Auswahl & Navigation ---------- */

  function select(type, id) {
    ui.selection = { type, id };
    ui.tab = 'details';
    board.applySelection();
    sidebar.render(analysis);
  }

  function clearSelection() {
    if (!ui.selection.type) return;
    ui.selection = { type: null, id: null };
    if (ui.tab === 'details') ui.tab = 'plan';
    board.applySelection();
    sidebar.render(analysis);
  }

  function dropStaleSelection() {
    const { type, id } = ui.selection;
    const exists = type === 'node' ? model.getNode(id) : type === 'dependency' ? model.getDependency(id) : true;
    if (!exists) ui.selection = { type: null, id: null };
  }

  function hover(id) {
    if (ui.hoverId === id) return;
    ui.hoverId = id;
    board.applyHighlight();
  }

  function goTo(id) {
    board.scrollTo(id);
    select('node', id);
  }

  function focusTitle() {
    const input = $('#sideBody [data-field="title"]');
    if (input) {
      input.focus();
      input.select();
    }
  }

  /* ---------- Aktionen ---------- */

  function addNode(kind) {
    const position = board.viewportCenter();
    const id = kind === 'group' ? model.addGroup(position) : model.addTask(kind, position);
    select('node', id);
    focusTitle();
  }

  function addDependency(from, to) {
    const result = model.addDependency(from, to);
    toast(result.ok
      ? `„${model.getNode(to).title}“ hängt jetzt von „${model.getNode(from).title}“ ab`
      : result.error);
  }

  function deleteSelection() {
    const { type, id } = ui.selection;
    if (type === 'node') model.removeNode(id);
    if (type === 'dependency') model.removeDependency(id);
  }

  function duplicateSelection() {
    if (ui.selection.type !== 'node' || model.isGroup(ui.selection.id)) return;
    const copy = model.duplicateTask(ui.selection.id);
    if (copy) select('node', copy);
  }

  function reverseSelectedDependency() {
    if (ui.selection.type !== 'dependency') return;
    const result = model.reverseDependency(ui.selection.id);
    if (!result.ok) toast(result.error);
  }

  function runAction(name) {
    const handlers = { delete: deleteSelection, duplicate: duplicateSelection, 'reverse-dependency': reverseSelectedDependency };
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
    if (!await PB.dialog.confirm('Alle Blöcke und Abhängigkeiten entfernen?\n(Rückgängig möglich)', { okLabel: 'Leeren', danger: true })) return;
    model.clear();
  }

  /* ---------- Werkzeugleiste ---------- */

  function bindToolbar() {
    const on = (selector, handler) => $(selector).addEventListener('click', handler);
    on('#addThinking', () => addNode('thinking'));
    on('#addImplementation', () => addNode('implementation'));
    on('#addGroup', () => addNode('group'));
    on('#undo', model.undo);
    on('#redo', model.redo);
    on('#zoomIn', () => { board.setZoom(model.getState().view.zoom * C.ZOOM.step); updateHeader(); persist(); });
    on('#zoomOut', () => { board.setZoom(model.getState().view.zoom / C.ZOOM.step); updateHeader(); persist(); });
    on('#fit', () => { board.fit(); updateHeader(); persist(); });
    on('#priorityAxis', () => {
      model.setView({ showPriorityAxis: !model.getState().view.showPriorityAxis });
      board.render(analysis);
      updateHeader();
      persist();
    });
    $('#focusMode').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-focus]');
      if (!button) return;
      ui.focusMode = button.dataset.focus;
      updateHeader();
      board.applyHighlight();
    });
    bindFileMenu();
    on('#exportJson', exportJson);
    on('#exportHtml', exportHtml);
    on('#importJson', importBoard);
    on('#loadExample', loadExample);
    on('#saveWarning', () => PB.dialog.alert(
      'Diese Ansicht darf nichts im Browser speichern (z. B. eingebettete Vorschau).\n' +
      'Änderungen gehen beim Schliessen verloren. Sichere dein Board über Datei ▸ Export\n' +
      'oder öffne prio-board.html direkt im Browser (Chrome, Edge, Firefox).',
      { title: 'Nicht gespeichert' }));
    on('#clearBoard', clearBoard);
  }

  function bindFileMenu() {
    const menu = $('#fileMenu');
    const button = $('#fileMenuButton');
    const setOpen = (open) => {
      menu.classList.toggle('open', open);
      button.setAttribute('aria-expanded', String(open));
    };
    button.addEventListener('click', () => setOpen(!menu.classList.contains('open')));
    menu.querySelector('.menu-panel').addEventListener('click', () => setOpen(false));
    document.addEventListener('pointerdown', (event) => { if (!menu.contains(event.target)) setOpen(false); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setOpen(false); });
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
    $('#priorityAxis').classList.toggle('on', view.showPriorityAxis);
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
      if (typing) return;
      if (mod && key === 'z') { event.preventDefault(); event.shiftKey ? model.redo() : model.undo(); }
      else if (mod && key === 'y') { event.preventDefault(); model.redo(); }
      else if (mod && key === 'd') { event.preventDefault(); duplicateSelection(); }
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
