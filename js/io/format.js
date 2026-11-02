/**
 * JSON-Dateiformat „prio-board“ (Version 1) – Export, Import, Validierung, Migration.
 * Beschreibung: schema/prio-board.schema.json und README.md.
 *
 *   {
 *     "format": "prio-board", "version": 1, "exportedAt": "…",
 *     "board": { "title": "…" },
 *     "view": { "zoom": 1, "showPriorityAxis": true },
 *     "groups": [ { "id", "title", "description", "layout": { "x", "y", "width", "height" } } ],
 *     "tasks": [ { "id", "kind": "thinking|implementation", "title", "description",
 *                  "notes": ["…"], "status": "open|in_progress|done", "effortDays": 3, "layout": {…} } ],
 *     "dependencies": [ { "id", "from", "to" } ],      // from muss vor to fertig sein
 *     "analysis": { … }                                 // nur Export, wird beim Import ignoriert
 *   }
 */
PB.format = (() => {
  const C = PB.config;
  const U = PB.util;
  const KINDS = ['thinking', 'implementation'];
  const STATUSES = ['open', 'in_progress', 'done'];

  class FormatError extends Error {
    constructor(problems) {
      super(`Datei ungültig:\n• ${problems.slice(0, 8).join('\n• ')}${problems.length > 8 ? `\n• … (+${problems.length - 8})` : ''}`);
      this.name = 'FormatError';
      this.problems = problems;
    }
  }

  /* ---------- Export ---------- */

  const layoutOut = (l) => ({ x: l.x, y: l.y, width: l.width, height: l.height });

  /**
   * Zustand → Dokument. Mit { model, analysis } wird zusätzlich ein
   * berechneter "analysis"-Block angehängt (für Auswertungen ausserhalb des Tools).
   */
  function serialize(state, { model, analysis, exportedAt = new Date().toISOString() } = {}) {
    const doc = {
      format: C.FORMAT.name,
      version: C.FORMAT.version,
      exportedAt,
      board: { title: state.board.title },
      view: { zoom: state.view.zoom, showPriorityAxis: state.view.showPriorityAxis },
      groups: state.groups.map((g) => ({
        id: g.id,
        title: g.title,
        description: g.description,
        layout: layoutOut(g.layout),
      })),
      tasks: state.tasks.map((t) => ({
        id: t.id,
        kind: t.kind,
        title: t.title,
        description: t.description,
        notes: [...t.notes],
        status: t.status,
        effortDays: t.effortDays ?? null,
        layout: layoutOut(t.layout),
      })),
      dependencies: state.dependencies.map((d) => ({ id: d.id, from: d.from, to: d.to })),
    };
    if (model && analysis) doc.analysis = buildAnalysis(state, model, analysis);
    return doc;
  }

  function buildAnalysis(state, model, a) {
    return {
      note: 'Beim Export berechnet – wird beim Import ignoriert.',
      tasks: Object.fromEntries(state.tasks.map((t) => [t.id, {
        priority: a.priorityOf(t.id),
        group: model.parentOf(t.id),
        wave: a.wave.get(t.id) ?? null,
        state: a.stateOf(t.id),
        blockedBy: a.openPredecessors(t.id),
      }])),
      waves: a.waves,
      criticalPath: { tasks: a.criticalPath, effortDays: a.criticalEffort },
    };
  }

  /* ---------- Import ---------- */

  /**
   * String oder Objekt → normalisierter Zustand.
   * Standard (Import): streng – wirft FormatError mit allen Problemen.
   * { repair: true } (eigener gespeicherter Stand): repariert stattdessen, was geht
   *   (ungültige Werte → Standardwerte, kaputte Pfeile entfernt, doppelte IDs umbenannt)
   *   und meldet jede Reparatur über onWarning(message).
   */
  function parse(input, { repair = false, onWarning = () => {} } = {}) {
    let raw = input;
    if (typeof input === 'string') {
      try {
        raw = JSON.parse(input);
      } catch (e) {
        throw new FormatError([`Kein gültiges JSON (${e.message})`]);
      }
    }
    if (isLegacy(raw)) raw = migrateLegacy(raw);
    return normalize(raw, { repair, onWarning });
  }

  function normalize(raw, { repair, onWarning }) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new FormatError(['Inhalt ist kein JSON-Objekt']);

    // Grundstruktur ist nie reparierbar
    const fatal = [];
    if (raw.format !== C.FORMAT.name) fatal.push(`"format" muss "${C.FORMAT.name}" sein`);
    if (!Number.isInteger(raw.version) || raw.version < 1 || raw.version > C.FORMAT.version) {
      fatal.push(`"version" ${JSON.stringify(raw.version)} wird nicht unterstützt (1–${C.FORMAT.version})`);
    }
    for (const key of ['groups', 'tasks', 'dependencies']) {
      if (!Array.isArray(raw[key])) fatal.push(`"${key}" muss eine Liste sein`);
    }
    if (fatal.length) throw new FormatError(fatal);

    // Alles Weitere: im Reparaturmodus Hinweis + Standardwert, sonst Fehler
    const problems = [];
    const report = (message) => (repair ? onWarning(message) : problems.push(message));
    const text = (v) => (typeof v === 'string' ? v : '');

    const nodeIds = new Set();
    const readId = (id, where) => {
      if (typeof id !== 'string' || !id.trim()) {
        report(`${where}: "id" fehlt`);
        id = U.uid('n');
      } else if (nodeIds.has(id)) {
        report(`${where}: doppelte id "${id}"`);
        id = U.uid('n');
      }
      nodeIds.add(id);
      return id;
    };
    const DEFAULT_LAYOUT = { x: 0, y: 0, width: 240, height: 130 };
    const readLayout = (l, where) => {
      const out = {};
      for (const k of ['x', 'y', 'width', 'height']) {
        let v = Number(l?.[k]);
        const invalid = !Number.isFinite(v) || ((k === 'width' || k === 'height') && v <= 0);
        if (invalid) {
          report(`${where}: "layout.${k}" fehlt oder ist ungültig`);
          v = DEFAULT_LAYOUT[k];
        }
        out[k] = v;
      }
      return out;
    };

    const groups = raw.groups.map((g, i) => {
      const where = `groups[${i}]`;
      return {
        id: readId(g?.id, where),
        title: text(g?.title) || 'Gruppe',
        description: text(g?.description),
        layout: readLayout(g?.layout, where),
      };
    });

    const tasks = raw.tasks.map((t, i) => {
      const where = `tasks[${i}]`;
      let kind = t?.kind;
      if (!KINDS.includes(kind)) {
        report(`${where}: "kind" muss "thinking" oder "implementation" sein`);
        kind = 'thinking';
      }
      let status = t?.status ?? 'open';
      if (!STATUSES.includes(status)) {
        report(`${where}: unbekannter "status" "${status}"`);
        status = 'open';
      }
      let effort = t?.effortDays === null || t?.effortDays === undefined || t?.effortDays === '' ? null : Number(t.effortDays);
      if (effort !== null && !(effort >= 0)) {
        report(`${where}: "effortDays" muss eine Zahl ≥ 0 oder null sein`);
        effort = null;
      }
      return {
        id: readId(t?.id, where),
        kind,
        title: text(t?.title) || 'Ohne Titel',
        description: text(t?.description),
        notes: Array.isArray(t?.notes) ? t.notes.filter((n) => typeof n === 'string' && n.trim()) : [],
        status,
        effortDays: effort,
        layout: readLayout(t?.layout, where),
      };
    });

    const dependencies = [];
    const depIds = new Set();
    const pairs = new Set();
    raw.dependencies.forEach((d, i) => {
      const where = `dependencies[${i}]`;
      const broken = [];
      if (!nodeIds.has(d?.from)) broken.push(`"from" verweist auf unbekannte id "${d?.from}"`);
      if (!nodeIds.has(d?.to)) broken.push(`"to" verweist auf unbekannte id "${d?.to}"`);
      if (d?.from === d?.to) broken.push('"from" und "to" sind identisch');
      if (broken.length) {
        broken.forEach((b) => report(`${where}: ${b}${repair ? ' – entfernt' : ''}`));
        return;
      }
      const pair = `${d.from}→${d.to}`;
      if (pairs.has(pair)) return; // Duplikate still ignorieren
      pairs.add(pair);
      const id = typeof d.id === 'string' && d.id && !depIds.has(d.id) ? d.id : U.uid('d');
      depIds.add(id);
      dependencies.push({ id, from: d.from, to: d.to });
    });

    if (problems.length) throw new FormatError(problems);

    return {
      board: { title: text(raw.board?.title).trim() || 'Prio-Board' },
      view: {
        zoom: U.clamp(Number(raw.view?.zoom) || 1, C.ZOOM.min, C.ZOOM.max),
        showPriorityAxis: raw.view?.showPriorityAxis !== false,
      },
      groups,
      tasks,
      dependencies,
    };
  }

  /* ---------- Migration älterer Stände ---------- */

  /** Interner Speicherstand der ersten Versionen: { blocks: [...], deps: [...] } */
  const isLegacy = (o) => o && !o.format && Array.isArray(o.blocks) && Array.isArray(o.deps);

  /** mirror=true: Version mit „hohe Priorität rechts“ → horizontal spiegeln. */
  function migrateLegacy(old, { mirror = false } = {}) {
    const KIND = { denken: 'thinking', umsetzung: 'implementation' };
    const STATUS = { offen: 'open', laeuft: 'in_progress', fertig: 'done' };
    const axisWidth = C.ZONE_WIDTH * C.PRIORITY_LEVELS;
    const layoutOf = (b) => ({
      x: mirror ? Math.max(0, axisWidth - b.x - b.w) : b.x,
      y: b.y,
      width: b.w,
      height: b.h,
    });
    const isGroupBlock = (b) => b.type === 'gruppe';
    return {
      format: C.FORMAT.name,
      version: C.FORMAT.version,
      board: { title: 'Prio-Board' },
      view: { zoom: old.view?.scale ?? 1, showPriorityAxis: old.view?.prio !== false },
      groups: old.blocks.filter(isGroupBlock).map((b) => ({
        id: b.id, title: b.title, description: b.desc || '', layout: layoutOf(b),
      })),
      tasks: old.blocks.filter((b) => !isGroupBlock(b)).map((b) => ({
        id: b.id,
        kind: KIND[b.type] || 'thinking',
        title: b.title,
        description: b.desc || '',
        notes: String(b.notes || '').split('\n').map((s) => s.trim()).filter(Boolean),
        status: STATUS[b.status] || 'open',
        effortDays: U.parseNumber(b.aufwand),
        layout: layoutOf(b),
      })),
      dependencies: old.deps.map((d) => ({ id: d.id, from: d.from, to: d.to })),
    };
  }

  return { serialize, parse, migrateLegacy, FormatError };
})();
