/**
 * Seitenleiste: Tabs „Details“ (Aufgabe, Thema oder Abhängigkeit bearbeiten),
 * „Ablauf“ (wichtigste Denk-Themen, startbar, kritischer Pfad, Themen) und „Hilfe“.
 * Ändert das Modell direkt; Navigation/Meldungen laufen über die bei init() übergebenen actions.
 */
PB.sidebar = (() => {
  const C = PB.config;
  const U = PB.util;
  const I = PB.icons;
  const CAL = PB.calendar;
  const model = PB.model;
  const ui = PB.ui;
  const esc = U.escapeHtml;

  let dom = null;
  let actions = null;
  let analysis = null;
  let editCheckpointPending = false;

  function init(elements, callbacks) {
    dom = elements;
    actions = callbacks;
    dom.tabs.addEventListener('click', onTabClick);
    dom.body.addEventListener('focusin', () => { editCheckpointPending = true; });
    dom.body.addEventListener('input', onInput);
    dom.body.addEventListener('change', onChange);
    dom.body.addEventListener('click', onClick);
    dom.body.addEventListener('mouseover', onHover);
    dom.body.addEventListener('mouseleave', () => actions.hover(null));
  }

  /** silent: nur Analyse übernehmen, nicht neu zeichnen (z. B. während im Panel getippt wird). */
  function render(a, { silent = false } = {}) {
    analysis = a;
    if (silent) return;
    dom.tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
    const views = { details: detailsView, plan: planView, help: helpView };
    dom.body.innerHTML = views[ui.tab]();
  }

  /* =====================================================================
   * Bausteine
   * ===================================================================== */

  function dot(id) {
    const theme = model.getTheme(id);
    if (theme) return `<span class="dot theme" style="background:${theme.color}"></span>`;
    const task = model.getTask(id);
    return `<span class="dot ${task.kind}">${I.forKind(task.kind)}</span>`;
  }

  function listItem(id, { meta = '', extra = '', removeDep = null } = {}) {
    const node = model.getNode(id);
    if (!node) return '';
    const remove = removeDep ? `<button class="x" data-remove-dep="${esc(removeDep)}" title="Entfernen">×</button>` : '';
    return `<li data-goto="${esc(id)}">${dot(id)}<span class="t">${esc(node.title)}</span>${meta}${extra}${remove}</li>`;
  }

  const list = (items, empty = '– nichts –') =>
    `<ul class="list">${items.join('') || `<li class="hint">${empty}</li>`}</ul>`;

  const field = (label, control, extra = '') => `<div class="field"><label>${label}</label>${control}${extra}</div>`;

  function select(attrs, options, current) {
    const opts = Object.entries(options)
      .map(([value, label]) => `<option value="${esc(value)}"${String(value) === String(current) ? ' selected' : ''}>${esc(label)}</option>`).join('');
    return `<select ${attrs}>${opts}</select>`;
  }

  const priorityOptions = Object.fromEntries(C.PRIORITY_LABELS.map((label, i) => [i + 1, `Prio ${i + 1} – ${label}`]));
  const small = (text) => `<span class="small">${text}</span>`;

  /** Dauer-Eingabe mit Schnellwahl. */
  function durationField(label, name, value, { presets = C.DURATION_PRESETS, min = 1 } = {}) {
    const buttons = presets.map((p) =>
      `<button class="chip${p.days === value ? ' on' : ''}" data-preset="${name}" data-days="${p.days}">${p.label}</button>`).join('');
    return field(label,
      `<div class="duration"><input type="number" min="${min}" step="1" data-field="${name}" value="${value}">
        <span class="small">Arbeitstage = ${CAL.durationLabel(value)}</span></div><div class="chips">${buttons}</div>`);
  }

  function legend() {
    return `<h3>Legende</h3><div class="legend">
      <div><span class="dot thinking">${I.svg('brain')}</span><span><b>Denken</b> – Analyse, Konzept</span></div>
      <div><span class="dot implementation">${I.svg('wrench')}</span><span><b>Umsetzung</b> – direkt machbar</span></div>
      <div><span class="sw full"></span><span>Voll = intensiv</span></div>
      <div><span class="sw hatched"></span><span>Schraffiert = nebenbei / reift</span></div>
      <div><span class="sw buffer"></span><span>Gestrichelt = Puffer / Unsicherheit</span></div>
      <div><span class="sw ongoing"></span><span>∞ = läuft weiter</span></div>
      <div><span class="lev">🔓 3</span><span>Hebel: gibt 3 Umsetzungen frei</span></div>
      <div><span class="sw risky-line"></span><span>Orange Pfeil: Start im Puffer des Vorgängers (riskant)</span></div>
    </div>`;
  }

  /* =====================================================================
   * Tab „Details“
   * ===================================================================== */

  function detailsView() {
    const { type, id } = ui.selection;
    if (type === 'dependency') return dependencyDetails(model.getDependency(id));
    if (type === 'theme' && model.getTheme(id)) return themeDetails(model.getTheme(id));
    if (type === 'task' && model.getTask(id)) return taskDetails(model.getTask(id));
    return `<p class="hint">Wähle einen Balken auf der Zeitachse aus – oder doppelklicke auf eine freie Stelle, um eine Aufgabe anzulegen.</p>${legend()}`;
  }

  function iterationLabel(task, index) {
    return index === null || !task?.iterations[index] ? 'komplett' : `nach „${task.iterations[index].title}“`;
  }

  function dependencyDetails(dep) {
    if (!dep) return '';
    const fromTask = model.getTask(dep.from);
    const iterationSelect = fromTask?.iterations.length
      ? field('Benötigt wird',
        select(`data-dep-iteration="${esc(dep.id)}"`,
          { '': 'Vorgänger komplett', ...Object.fromEntries(fromTask.iterations.map((it, i) => [i, `nur bis „${it.title}“`])) },
          dep.fromIteration ?? ''))
      : '';
    return `<h3>Abhängigkeit</h3>
      ${list([listItem(dep.from, { meta: small('zuerst') })])}
      <div class="hint" style="margin:0 8px 6px">↓ muss fertig sein (${iterationLabel(fromTask, dep.fromIteration)}), bevor</div>
      ${list([listItem(dep.to, { meta: small('danach') })])}
      ${iterationSelect}
      <div class="btnrow">
        <button class="btn" data-action="reverse-dependency">Richtung umkehren</button>
        <button class="btn danger" data-action="delete">Löschen</button>
      </div>`;
  }

  function taskDetails(task) {
    const isThinking = task.kind === 'thinking';
    const duration = model.durationOf(task);
    const end = CAL.dateOf(model.endOf(task));
    const durationBlock = task.iterations.length
      ? field('Dauer', `<p class="hint">Summe der Iterationen: <b>${CAL.durationLabel(duration)}</b></p>`)
      : durationField('Dauer', 'durationDays', task.durationDays);

    return `
      ${field('Titel', `<input data-field="title" value="${esc(task.title)}">`)}
      <div class="row">
        ${field('Art', select('data-field="kind"', { thinking: 'Denken', implementation: 'Umsetzung' }, task.kind))}
        ${field('Status', select('data-field="status"', C.STATUS_LABELS, task.status))}
      </div>
      <div class="row">
        ${field('Priorität', select('data-field="priority"', priorityOptions, task.priority))}
        ${field('Start', `<input type="date" data-field="start" min="${CAL.isoOf(0)}" value="${CAL.isoOf(task.start)}">`)}
      </div>
      ${durationBlock}
      ${durationField('Puffer (Unsicherheit)', 'bufferDays', task.bufferDays, {
        min: 0, presets: [{ label: 'kein', days: 0 }, { label: '1 Wo', days: 5 }, { label: '2 Wo', days: 10 }, { label: '1 Mt', days: 20 }],
      })}
      <p class="hint">Ende: <b>${CAL.longDate(end)}</b> (KW ${CAL.weekNumber(end)})${task.bufferDays ? `, spätestens ${CAL.longDate(CAL.dateOf(model.endOf(task) + task.bufferDays))}` : ''}</p>
      ${field('Arbeitsweise', select('data-field="intensity"', C.INTENSITY_LABELS, task.intensity))}
      ${isThinking ? iterationsEditor(task) : ''}
      ${themesEditor(task)}
      ${field('Stichpunkte (eine Zeile = ein Punkt)', `<textarea data-field="notes" rows="3">${esc(task.notes.join('\n'))}</textarea>`)}
      ${field('Beschreibung', `<textarea data-field="description" rows="3">${esc(task.description)}</textarea>`)}
      <p class="hint">${taskStateText(task)}</p>
      ${blockedBySection(task)}
      ${dependencySections(task.id)}
      <div class="btnrow">
        <button class="btn" data-action="duplicate">Duplizieren</button>
        <button class="btn danger" data-action="delete">Löschen</button>
      </div>`;
  }

  function iterationsEditor(task) {
    const rows = task.iterations.map((it, i) => `
      <div class="iter-row">
        <input type="checkbox" data-iter="${i}" data-iter-field="done" ${it.done ? 'checked' : ''} title="Erledigt">
        <input data-iter="${i}" data-iter-field="title" value="${esc(it.title)}">
        <input type="number" min="1" step="1" data-iter="${i}" data-iter-field="durationDays" value="${it.durationDays}" title="Arbeitstage">
        <span class="small">${CAL.durationLabel(it.durationDays)}</span>
        <button class="x" data-action="remove-iteration" data-index="${i}" title="Entfernen">×</button>
      </div>`).join('');
    return `<h3>Iterationen</h3>
      <p class="hint">Denken in Schritten. Eine Umsetzung kann schon nach einer Iteration starten (Punkt an der Iterationsgrenze ziehen).</p>
      ${rows}
      <div class="btnrow">
        <button class="btn" data-action="add-iteration">+ Iteration</button>
        <label class="check"><input type="checkbox" data-field="ongoing" ${task.ongoing ? 'checked' : ''}> ∞ läuft danach weiter</label>
      </div>`;
  }

  function themesEditor(task) {
    const chips = model.getState().themes.map((th) =>
      `<button class="chip theme${task.themes.includes(th.id) ? ' on' : ''}" data-toggle-theme="${esc(th.id)}" style="--c:${th.color}">${esc(th.title)}</button>`).join('');
    return `<h3>Themen</h3><div class="chips">${chips}<button class="chip" data-action="add-theme">+ Neues Thema</button></div>`;
  }

  function taskStateText(task) {
    const leverage = analysis.leverage.get(task.id);
    const lever = leverage ? ` 🔓 Gibt ${leverage} offene Umsetzung(en) frei.` : '';
    switch (analysis.stateOf(task.id)) {
      case 'done': return 'Erledigt.';
      case 'cycle': return '⚠ Teil eines Zyklus – Abhängigkeiten prüfen.';
      case 'ready': return `✓ Kann jetzt gestartet werden.${lever}`;
      case 'in_progress': return `In Arbeit.${lever}`;
      default: return `Wartet auf ${analysis.openPredecessors(task.id).length} offene Aufgabe(n).${lever}`;
    }
  }

  function blockedBySection(task) {
    const open = analysis.openPredecessors(task.id);
    if (!open.length) return '';
    return `<h3>Blockiert durch</h3>${list(open.map((id) => listItem(id)))}`;
  }

  function themeDetails(theme) {
    const members = model.membersOf(theme.id);
    return `
      ${field('Thema', `<input data-theme-field="title" value="${esc(theme.title)}">`)}
      ${field('Farbe', `<input type="color" data-theme-field="color" value="${theme.color}">`)}
      <p class="hint">Eine Abhängigkeit auf ein Thema gilt für alle Aufgaben darin.</p>
      <h3>Aufgaben (${members.length})</h3>
      ${list(members.map((id) => listItem(id)), 'Aufgaben im Detail-Panel einem Thema zuordnen')}
      ${dependencySections(theme.id)}
      <div class="btnrow"><button class="btn danger" data-action="delete">Thema löschen</button></div>`;
  }

  function dependencyOptions(id, direction) {
    const deps = model.getState().dependencies;
    const used = new Set(direction === 'incoming'
      ? deps.filter((d) => d.to === id).map((d) => d.from)
      : deps.filter((d) => d.from === id).map((d) => d.to));
    const { tasks, themes } = model.getState();
    const option = (node, prefix) => `<option value="${esc(node.id)}">${prefix}: ${esc(node.title)}</option>`;
    const available = (node) => node.id !== id && !used.has(node.id);
    return [
      ...themes.filter(available).map((th) => option(th, 'Thema')),
      ...tasks.filter(available).sort((a, b) => a.title.localeCompare(b.title, 'de')).map((t) => option(t, C.KIND_LABELS[t.kind])),
    ].join('');
  }

  function dependencySections(id) {
    const deps = model.getState().dependencies;
    const incoming = deps.filter((d) => d.to === id).map((d) => listItem(d.from, {
      meta: d.fromIteration !== null ? small(iterationLabel(model.getTask(d.from), d.fromIteration)) : '',
      removeDep: d.id,
    }));
    const outgoing = deps.filter((d) => d.from === id).map((d) => listItem(d.to, {
      meta: d.fromIteration !== null ? small(`ab „${model.getTask(id).iterations[d.fromIteration].title}“`) : '',
      removeDep: d.id,
    }));
    return `
      <h3>Hängt ab von</h3>${list(incoming)}
      <select class="adddep" data-add-dependency="incoming">
        <option value="">+ Voraussetzung hinzufügen…</option>${dependencyOptions(id, 'incoming')}</select>
      <h3>Ist Voraussetzung für</h3>${list(outgoing)}
      <select class="adddep" data-add-dependency="outgoing">
        <option value="">+ abhängige Aufgabe hinzufügen…</option>${dependencyOptions(id, 'outgoing')}</select>`;
  }

  /* =====================================================================
   * Tab „Ablauf“
   * ===================================================================== */

  function planView() {
    const { tasks, themes } = model.getState();
    const a = analysis;
    const open = tasks.filter((t) => t.status !== 'done');
    const openWeeks = (kind) => open.filter((t) => t.kind === kind).reduce((s, t) => s + model.durationOf(t), 0);
    const planEnd = CAL.dateOf(a.planEnd);
    const byPriority = (x, y) => model.getTask(x).priority - model.getTask(y).priority;

    const stats = `<div class="stats">
      <div class="stat"><b>${a.ready.size}</b><span>jetzt parallel startbar</span></div>
      <div class="stat"><b>KW ${CAL.weekNumber(planEnd)}</b><span>Plan-Ende (${CAL.shortDate(planEnd)})</span></div>
      <div class="stat thinking"><b>${CAL.durationLabel(openWeeks('thinking'))}</b><span>${I.svg('brain')} Denken offen</span></div>
      <div class="stat impl"><b>${CAL.durationLabel(openWeeks('implementation'))}</b><span>${I.svg('wrench')} Umsetzung offen</span></div>
    </div>`;

    const warning = a.cycle.size
      ? `<div class="warn">⚠ Zyklische Abhängigkeit zwischen: ${[...a.cycle].map((id) => esc(model.getTask(id).title)).join(', ')}</div>`
      : '';

    const important = a.importantThinking.slice(0, 6).map((id) => {
      const t = model.getTask(id);
      const lever = a.leverage.get(id);
      return listItem(id, { meta: small(`${lever ? `🔓 ${lever} · ` : ''}${CAL.durationLabel(model.durationOf(t))} · P${t.priority}`) });
    });

    const ready = [...a.ready].sort(byPriority).map((id) =>
      listItem(id, { meta: small(`P${model.getTask(id).priority} · ${CAL.durationLabel(model.durationOf(model.getTask(id)))}`) }));

    const critical = a.criticalPath.map((id, i) =>
      listItem(id, { meta: small(`${i ? '↳ ' : ''}${CAL.durationLabel(model.durationOf(model.getTask(id)))}`) }));

    const themeItems = themes.map((th) => listItem(th.id, { meta: small(`${model.membersOf(th.id).length} Aufgaben`) }));
    const done = tasks.filter((t) => t.status === 'done').map((t) => listItem(t.id, { meta: small('✓') }));

    if (!tasks.length) {
      return `<p class="hint">Noch keine Aufgaben. Lege oben mit „Denken“ oder „Umsetzung“ los – oder doppelklicke auf die Zeitachse.</p>`;
    }
    return `${stats}${warning}
      <h3>Wichtigste Denk-Themen</h3>
      <p class="hint">Viel Hebel (🔓 = freigegebene Umsetzungen) × lange Dauer – hier früh anfangen.</p>
      ${list(important, 'Keine offenen Denk-Themen')}
      <h3>Jetzt parallel startbar (${a.ready.size})</h3>${list(ready)}
      ${critical.length ? `<h3>Kritischer Pfad · ${CAL.durationLabel(a.criticalDays)}</h3>
        <p class="hint">Längste Kette nacheinander abhängiger Aufgaben – bestimmt die minimale Gesamtdauer.</p>${list(critical)}` : ''}
      <h3>Themen</h3>${list(themeItems, 'Noch keine Themen')}
      <div class="btnrow"><button class="btn" data-action="add-theme">+ Thema</button></div>
      ${done.length ? `<h3>Erledigt (${done.length})</h3>${list(done)}` : ''}`;
  }

  /* =====================================================================
   * Tab „Hilfe“
   * ===================================================================== */

  function helpView() {
    return `<h3>Die Zeitachse</h3>
    <ul class="help">
      <li><b>Waagrecht = Zeit</b> in Kalenderwochen ab heute. Die <b>Länge</b> eines Balkens ist seine Dauer.</li>
      <li><b>Senkrecht = Priorität</b>: Prio 1 oben. Steht etwas Wichtiges weit rechts, wartet es zu lange.</li>
    </ul>
    <h3>Bedienen</h3>
    <ul class="help">
      <li><b>Balken ziehen</b>: waagrecht = Start, senkrecht = Priorität.</li>
      <li><b>Rechte Kante</b> = Dauer, <b>gestrichelte Kante</b> = Puffer.</li>
      <li><b>Punkt am Ende ziehen</b> und auf einer Aufgabe loslassen = Abhängigkeit. Der Punkt an einer <b>Iterationsgrenze</b> heisst: „braucht nur bis hier“.</li>
      <li>Nachfolger werden automatisch <b>nach rechts geschoben</b>, wenn sie sonst zu früh starten würden.</li>
      <li><b>Doppelklick</b> auf eine freie Stelle = neue Aufgabe an diesem Tag in diesem Prio-Band.</li>
      <li><b>Themen</b> fassen Aufgaben zusammen. Eine Abhängigkeit auf ein Thema gilt für alle darin.</li>
      <li><b>Hover</b> zeigt, was vorher nötig ist (orange) und was blockiert wird (blau).</li>
    </ul>
    <h3>Tastatur</h3>
    <ul class="help">
      <li><b>Entf</b> löschen · <b>Strg+D</b> duplizieren · <b>Esc</b> Auswahl aufheben</li>
      <li><b>Strg+Z / Strg+Y</b> rückgängig / wiederholen · <b>Strg + Mausrad</b> zoomen</li>
    </ul>
    <h3>Speichern & Teilen</h3>
    <ul class="help">
      <li>Alles wird automatisch im Browser gespeichert.</li>
      <li><b>Datei ▸ Export</b> speichert als JSON (Format „prio-board“), <b>Import</b> lädt JSON oder eine exportierte HTML-Seite.</li>
      <li><b>Datei ▸ Als HTML</b> erzeugt eine statische Seite nur mit dem Diagramm.</li>
    </ul>
    ${legend()}`;
  }

  /* =====================================================================
   * Ereignisse
   * ===================================================================== */

  const selectedTask = () => (ui.selection.type === 'task' ? model.getTask(ui.selection.id) : null);
  const selectedTheme = () => (ui.selection.type === 'theme' ? model.getTheme(ui.selection.id) : null);

  /** Ein Historieneintrag pro Fokus beim Tippen. */
  function typingOptions() {
    if (editCheckpointPending) {
      model.checkpoint();
      editCheckpointPending = false;
    }
    return { record: false, source: 'sidebar' };
  }

  function onTabClick(event) {
    const button = event.target.closest('button[data-tab]');
    if (!button) return;
    ui.tab = button.dataset.tab;
    render(analysis);
  }

  /** Text- und Zahleneingaben: Seitenleiste wird dabei nicht neu gezeichnet (Fokus bleibt). */
  function onInput(event) {
    const t = event.target;
    if (t.tagName === 'SELECT' || t.type === 'checkbox' || t.type === 'date') return;
    const task = selectedTask();
    const theme = selectedTheme();

    if (task && t.dataset.field) {
      const value = readField(t.dataset.field, t.value);
      if (value === undefined) return;
      model.updateTask(task.id, { [t.dataset.field]: value }, typingOptions());
      if (t.type === 'number') updateDurationLabel(t, value);
    } else if (task && t.dataset.iterField) {
      const value = t.dataset.iterField === 'durationDays' ? U.parseNumber(t.value) : t.value;
      if (value === null) return;
      model.updateIteration(task.id, Number(t.dataset.iter), { [t.dataset.iterField]: value }, typingOptions());
      if (t.type === 'number') updateDurationLabel(t, value);
    } else if (theme && t.dataset.themeField) {
      model.updateTheme(theme.id, { [t.dataset.themeField]: t.value }, typingOptions());
    }
  }

  /** „= 2 Wo“ neben einer Dauer-Eingabe aktualisieren, ohne die Seitenleiste neu zu zeichnen. */
  function updateDurationLabel(input, days) {
    const label = input.parentElement.querySelector('.small');
    if (label) label.textContent = input.closest('.duration') ? `Arbeitstage = ${CAL.durationLabel(days)}` : CAL.durationLabel(days);
  }

  /** Feldwert umwandeln; undefined = (noch) ungültig, nicht übernehmen. */
  function readField(name, value) {
    if (name === 'notes') return value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (name === 'durationDays' || name === 'bufferDays') {
      const n = U.parseNumber(value);
      if (n === null) return undefined;
      return Math.max(name === 'durationDays' ? 1 : 0, Math.round(n));
    }
    return value;
  }

  function onChange(event) {
    const t = event.target;
    const task = selectedTask();

    if (t.dataset.addDependency && t.value) {
      const id = ui.selection.id;
      const [from, to] = t.dataset.addDependency === 'incoming' ? [t.value, id] : [id, t.value];
      actions.addDependency(from, to, null);
    } else if (t.dataset.depIteration) {
      model.setDependencyIteration(t.dataset.depIteration, t.value === '' ? null : Number(t.value));
    } else if (task && t.dataset.field === 'ongoing') {
      model.updateTask(task.id, { ongoing: t.checked });
    } else if (task && t.dataset.field === 'start') {
      const day = CAL.dayOf(t.value);
      if (day !== null) model.updateTask(task.id, { start: day });
    } else if (task && t.tagName === 'SELECT' && t.dataset.field) {
      const value = t.dataset.field === 'priority' ? Number(t.value) : t.value;
      model.updateTask(task.id, { [t.dataset.field]: value });
    } else if (task && t.dataset.iterField === 'done') {
      model.updateIteration(task.id, Number(t.dataset.iter), { done: t.checked });
    }
    // Bewusst kein Neuzeichnen nach Texteingaben: Ein Klick, der den Fokus wechselt,
    // würde sonst auf einem bereits ersetzten Element landen und verloren gehen.
  }

  function onClick(event) {
    const t = event.target;
    const remove = t.closest('[data-remove-dep]');
    if (remove) {
      event.stopPropagation();
      model.removeDependency(remove.dataset.removeDep);
      return;
    }
    const preset = t.closest('[data-preset]');
    if (preset && selectedTask()) {
      model.updateTask(selectedTask().id, { [preset.dataset.preset]: Number(preset.dataset.days) });
      return;
    }
    const toggle = t.closest('[data-toggle-theme]');
    if (toggle && selectedTask()) {
      const result = model.toggleTaskTheme(selectedTask().id, toggle.dataset.toggleTheme);
      if (!result.ok && result.error) actions.toast(result.error);
      return;
    }
    const action = t.closest('[data-action]');
    if (action) {
      const index = action.dataset.index === undefined ? null : Number(action.dataset.index);
      if (action.dataset.action === 'add-iteration') model.addIteration(selectedTask().id);
      else if (action.dataset.action === 'remove-iteration') model.removeIteration(selectedTask().id, index);
      else actions.run(action.dataset.action);
      return;
    }
    const item = t.closest('[data-goto]');
    if (item) actions.goTo(item.dataset.goto);
  }

  function onHover(event) {
    const item = event.target.closest('[data-goto]');
    actions.hover(item ? item.dataset.goto : null);
  }

  return { init, render };
})();
