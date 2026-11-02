/**
 * Seitenleiste: Tabs „Details“ (Bearbeiten), „Ablauf“ (Wellen, kritischer Pfad) und „Hilfe“.
 * Ändert das Modell direkt; Navigation/Meldungen laufen über die bei init() übergebenen actions.
 */
PB.sidebar = (() => {
  const C = PB.config;
  const U = PB.util;
  const I = PB.icons;
  const A = PB.analysis;
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

  function render(a) {
    analysis = a;
    dom.tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
    const views = { details: detailsView, plan: planView, help: helpView };
    dom.body.innerHTML = views[ui.tab]();
  }

  /* =====================================================================
   * Bausteine
   * ===================================================================== */

  function kindDot(node) {
    if (model.isGroup(node.id)) return '<span class="dot group"></span>';
    return `<span class="dot ${node.kind}">${I.forKind(node.kind)}</span>`;
  }

  function listItem(node, { meta = '', removeDep = null } = {}) {
    const remove = removeDep ? `<button class="x" data-remove-dep="${esc(removeDep)}" title="Entfernen">×</button>` : '';
    return `<li data-goto="${esc(node.id)}">${kindDot(node)}<span class="t">${esc(node.title || 'Ohne Titel')}</span>${meta}${remove}</li>`;
  }

  const list = (items, empty = '– nichts –') =>
    `<ul class="list">${items.join('') || `<li class="hint">${empty}</li>`}</ul>`;

  function field(label, control) {
    return `<div class="field"><label>${label}</label>${control}</div>`;
  }

  function select(name, options, current) {
    const opts = Object.entries(options)
      .map(([value, label]) => `<option value="${value}"${value === current ? ' selected' : ''}>${label}</option>`).join('');
    return `<select data-field="${name}">${opts}</select>`;
  }

  /** Mögliche Partner für eine neue Abhängigkeit (ohne Duplikate, ohne Verschachtelte). */
  function dependencyOptions(id, direction) {
    const deps = model.getState().dependencies;
    const used = new Set(direction === 'incoming'
      ? deps.filter((d) => d.to === id).map((d) => d.from)
      : deps.filter((d) => d.from === id).map((d) => d.to));
    return model.allNodes()
      .filter((n) => n.id !== id && !used.has(n.id) && !model.areNested(n.id, id))
      .sort((a, b) => a.title.localeCompare(b.title, 'de'))
      .map((n) => {
        const kind = model.isGroup(n.id) ? 'Gruppe' : C.KIND_LABELS[n.kind];
        return `<option value="${esc(n.id)}">${kind}: ${esc(n.title || 'Ohne Titel')}</option>`;
      }).join('');
  }

  function legend() {
    const arrow = (color, dash = '') =>
      `<svg width="32" height="12"><path d="M1,6 H25" stroke="var(${color})" stroke-width="2" ${dash}/>` +
      `<path d="M23,1 L31,6 L23,11z" fill="var(${color})"/></svg>`;
    return `<h3>Legende</h3><div class="legend">
      <div><span class="dot thinking">${I.svg('brain')}</span><span><b>Denken</b> – Analyse, Konzept, braucht Zeit</span></div>
      <div><span class="dot implementation">${I.svg('wrench')}</span><span><b>Umsetzung</b> – direkt machbar</span></div>
      <div><span class="dot group"></span><span><b>Gruppe</b> – Abhängigkeitsblock / Rahmen</span></div>
      <div>${arrow('--link')}<span>A → B: A muss vor B fertig sein</span></div>
      <div>${arrow('--link-done', 'stroke-dasharray="4 3"')}<span>Voraussetzung erfüllt</span></div>
      <div><span class="sw" style="box-shadow:0 0 0 3px var(--up)"></span><span>Beim Hovern: wird vorher benötigt</span></div>
      <div><span class="sw" style="box-shadow:0 0 0 3px var(--down)"></span><span>Beim Hovern: wird dadurch blockiert</span></div>
    </div>`;
  }

  /* =====================================================================
   * Tab „Details“
   * ===================================================================== */

  function detailsView() {
    if (ui.selection.type === 'dependency') return dependencyDetails(model.getDependency(ui.selection.id));
    const node = ui.selection.type === 'node' && model.getNode(ui.selection.id);
    if (!node) return `<p class="hint">Wähle einen Block auf dem Board aus, um ihn zu beschreiben.</p>${legend()}`;
    return model.isGroup(node.id) ? groupDetails(node) : taskDetails(node);
  }

  function dependencyDetails(dep) {
    if (!dep) return '';
    return `<h3>Abhängigkeit</h3>
      ${list([listItem(model.getNode(dep.from), { meta: '<span class="small">zuerst</span>' })])}
      <div class="hint" style="margin:0 8px 6px">↓ muss fertig sein, bevor</div>
      ${list([listItem(model.getNode(dep.to), { meta: '<span class="small">danach</span>' })])}
      <div class="btnrow">
        <button class="btn" data-action="reverse-dependency">Richtung umkehren</button>
        <button class="btn danger" data-action="delete">Löschen</button>
      </div>`;
  }

  function taskDetails(task) {
    const priority = analysis.priorityOf(task.id);
    const notes = task.notes.join('\n');
    return `
      ${field('Titel', `<input data-field="title" value="${esc(task.title)}">`)}
      <div class="row">
        ${field('Art', select('kind', { thinking: 'Denken (Analyse)', implementation: 'Umsetzung' }, task.kind))}
        ${field('Status', select('status', C.STATUS_LABELS, task.status))}
      </div>
      <div class="row">
        ${field('Aufwand (Personentage)', `<input data-field="effortDays" inputmode="decimal" value="${task.effortDays ?? ''}">`)}
        ${field('Priorität (Position)', `<input disabled value="${priority} – ${A.priorityLabel(priority)}">`)}
      </div>
      ${field('Stichpunkte (eine Zeile = ein Punkt)', `<textarea data-field="notes" rows="3">${esc(notes)}</textarea>`)}
      ${field('Beschreibung', `<textarea data-field="description" rows="4">${esc(task.description)}</textarea>`)}
      <p class="hint">${taskStateText(task)}</p>
      ${blockedBySection(task)}
      ${dependencySections(task.id)}
      <div class="btnrow">
        <button class="btn" data-action="duplicate">Duplizieren</button>
        <button class="btn danger" data-action="delete">Löschen</button>
      </div>`;
  }

  function taskStateText(task) {
    const wave = analysis.wave.get(task.id);
    switch (analysis.stateOf(task.id)) {
      case 'done': return 'Erledigt.';
      case 'cycle': return '⚠ Teil eines Zyklus – Abhängigkeiten prüfen.';
      case 'ready': return `✓ Kann jetzt gestartet werden (Welle ${wave}).`;
      case 'in_progress': return `In Arbeit (Welle ${wave}).`;
      default: return `Wartet auf ${analysis.openPredecessors(task.id).length} offene Aufgabe(n) – Welle ${wave}.`;
    }
  }

  function blockedBySection(task) {
    const open = analysis.openPredecessors(task.id);
    if (!open.length) return '';
    return `<h3>Effektiv blockiert durch</h3>
      ${list(open.map((id) => listItem(model.getNode(id))))}
      <p class="hint" style="margin-top:-4px">inkl. Abhängigkeiten der umgebenden Gruppe(n)</p>`;
  }

  function groupDetails(group) {
    const children = model.childrenOf(group.id);
    return `
      ${field('Titel', `<input data-field="title" value="${esc(group.title)}">`)}
      ${field('Beschreibung', `<textarea data-field="description" rows="3">${esc(group.description)}</textarea>`)}
      <h3>Enthält (${children.length})</h3>
      ${list(children.map((c) => listItem(c)), 'Blöcke in den Rahmen ziehen')}
      ${dependencySections(group.id)}
      <div class="btnrow"><button class="btn danger" data-action="delete">Löschen</button></div>`;
  }

  function dependencySections(id) {
    const deps = model.getState().dependencies;
    const incoming = deps.filter((d) => d.to === id).map((d) => listItem(model.getNode(d.from), { removeDep: d.id }));
    const outgoing = deps.filter((d) => d.from === id).map((d) => listItem(model.getNode(d.to), { removeDep: d.id }));
    return `
      <h3>Hängt ab von</h3>${list(incoming)}
      <select class="adddep" data-add-dependency="incoming">
        <option value="">+ Voraussetzung hinzufügen…</option>${dependencyOptions(id, 'incoming')}</select>
      <h3>Ist Voraussetzung für</h3>${list(outgoing)}
      <select class="adddep" data-add-dependency="outgoing">
        <option value="">+ abhängigen Block hinzufügen…</option>${dependencyOptions(id, 'outgoing')}</select>`;
  }

  /* =====================================================================
   * Tab „Ablauf“
   * ===================================================================== */

  function planView() {
    const { tasks } = model.getState();
    if (!tasks.length) return '<p class="hint">Noch keine Aufgaben. Lege oben mit „Denken“ oder „Umsetzung“ los.</p>';
    const a = analysis;
    const byId = (id) => model.getNode(id);
    const openEffort = (kind) => tasks
      .filter((t) => t.kind === kind && t.status !== 'done')
      .reduce((sum, t) => sum + A.effortOf(t), 0);
    const done = tasks.filter((t) => t.status === 'done');
    const blocked = tasks.length - done.length - a.ready.size;

    const stats = `<div class="stats">
      <div class="stat"><b>${a.ready.size}</b><span>jetzt parallel startbar</span></div>
      <div class="stat"><b>${blocked}</b><span>blockiert / laufend</span></div>
      <div class="stat thinking"><b>${U.formatNumber(openEffort('thinking'))} PT</b><span>${I.svg('brain')} Denken offen</span></div>
      <div class="stat impl"><b>${U.formatNumber(openEffort('implementation'))} PT</b><span>${I.svg('wrench')} Umsetzung offen</span></div>
    </div>`;

    const warning = a.cycle.size
      ? `<div class="warn">⚠ Zyklische Abhängigkeit zwischen: ${[...a.cycle].map((id) => esc(byId(id).title)).join(', ')}</div>`
      : '';

    const waves = a.waves.map((ids, i) => {
      const effort = ids.reduce((sum, id) => sum + A.effortOf(byId(id)), 0);
      const items = ids.map((id) => {
        const t = byId(id);
        const running = t.status === 'in_progress' ? '● läuft · ' : '';
        return listItem(t, { meta: `<span class="small">${running}P${a.priorityOf(id)} · ${U.formatNumber(A.effortOf(t))} PT</span>` });
      });
      return `<div class="wavebox${i === 0 ? ' now' : ''}">
        <div class="wh"><span>Welle ${i + 1}${i === 0 ? ' – jetzt' : ''}</span>
        <span class="small">${ids.length} Aufgaben · ${U.formatNumber(effort)} PT</span></div>${list(items)}</div>`;
    }).join('');

    const critical = a.criticalPath.length ? `
      <h3>Kritischer Pfad · ${U.formatNumber(a.criticalEffort)} PT</h3>
      <p class="hint">Längste Kette nacheinander abhängiger Aufgaben – bestimmt die minimale Gesamtdauer.</p>
      ${list(a.criticalPath.map((id, i) => listItem(byId(id), {
        meta: `<span class="small">${i ? '↳ ' : ''}${U.formatNumber(A.effortOf(byId(id)))} PT</span>`,
      })))}` : '';

    const finished = done.length
      ? `<h3>Erledigt (${done.length})</h3>${list(done.map((t) => listItem(t, { meta: '<span class="small">✓</span>' })))}`
      : '';

    return `${stats}${warning}
      <p class="hint">Alles in einer Welle hat keine Abhängigkeit untereinander und kann <b>parallel</b> bearbeitet werden. Sortiert nach Priorität.</p>
      ${waves}${critical}${finished}`;
  }

  /* =====================================================================
   * Tab „Hilfe“
   * ===================================================================== */

  function helpView() {
    return `<h3>So funktioniert's</h3>
    <ul class="help">
      <li><b>Blöcke anlegen</b> mit „Denken“, „Umsetzung“ oder „Gruppe“.</li>
      <li><b>Verschieben</b>: Block ziehen. <b>Grösse</b>: Ecke unten rechts ziehen.</li>
      <li><b>Abhängigkeit</b>: am runden Punkt rechts am Block ziehen und auf dem Block loslassen, der davon abhängt – oder im Detail-Panel wählen.</li>
      <li><b>Gruppen</b>: Blöcke in einen Rahmen ziehen. Hängt eine Gruppe von etwas ab, gilt das für alle Blöcke darin.</li>
      <li><b>Priorität</b> ergibt sich aus der Position: links hoch, rechts tief.</li>
      <li><b>Hover</b> zeigt, was vorher nötig ist (orange) und was blockiert wird (blau).</li>
      <li><b>Ablauf</b>: Wellen paralleler Arbeit, offener Aufwand, kritischer Pfad.</li>
    </ul>
    <h3>Tastatur</h3>
    <ul class="help">
      <li><b>Entf</b> löschen · <b>Strg+D</b> duplizieren · <b>Esc</b> Auswahl aufheben</li>
      <li><b>Strg+Z / Strg+Y</b> rückgängig / wiederholen</li>
      <li><b>Strg + Mausrad</b> zoomen · leere Fläche ziehen = verschieben</li>
    </ul>
    <h3>Speichern & Teilen</h3>
    <ul class="help">
      <li>Alles wird automatisch im Browser gespeichert.</li>
      <li><b>Export</b> speichert das Board als JSON-Datei (Format „prio-board“, siehe README), <b>Import</b> lädt sie wieder.</li>
      <li><b>Als HTML</b> erzeugt eine statische Seite nur mit dem Diagramm – zum Verschicken oder Ablegen.</li>
    </ul>
    ${legend()}`;
  }

  /* =====================================================================
   * Ereignisse
   * ===================================================================== */

  const selectedNode = () => (ui.selection.type === 'node' ? model.getNode(ui.selection.id) : null);

  function onTabClick(event) {
    const button = event.target.closest('button[data-tab]');
    if (!button) return;
    ui.tab = button.dataset.tab;
    render(analysis);
  }

  /** Text-Eingaben: ein Historieneintrag pro Fokus, Seitenleiste wird nicht neu gezeichnet. */
  function onInput(event) {
    const name = event.target.dataset.field;
    const node = selectedNode();
    if (!name || !node || event.target.tagName === 'SELECT') return;
    if (editCheckpointPending) {
      model.checkpoint();
      editCheckpointPending = false;
    }
    model.updateNode(node.id, { [name]: readField(name, event.target.value) }, { record: false, source: 'sidebar' });
  }

  function readField(name, value) {
    if (name === 'notes') return value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (name === 'effortDays') return U.parseNumber(value);
    return value;
  }

  function onChange(event) {
    const target = event.target;
    const node = selectedNode();
    if (!node) return;
    if (target.tagName === 'SELECT' && target.dataset.field) {
      model.updateNode(node.id, { [target.dataset.field]: target.value });
    } else if (target.dataset.addDependency && target.value) {
      const [from, to] = target.dataset.addDependency === 'incoming' ? [target.value, node.id] : [node.id, target.value];
      actions.addDependency(from, to);
    }
  }

  function onClick(event) {
    const remove = event.target.closest('[data-remove-dep]');
    if (remove) {
      event.stopPropagation();
      model.removeDependency(remove.dataset.removeDep);
      return;
    }
    const action = event.target.closest('[data-action]');
    if (action) {
      actions.run(action.dataset.action);
      return;
    }
    const item = event.target.closest('[data-goto]');
    if (item) actions.goTo(item.dataset.goto);
  }

  function onHover(event) {
    const item = event.target.closest('[data-goto]');
    actions.hover(item ? item.dataset.goto : null);
  }

  return { init, render };
})();
