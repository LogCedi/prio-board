/**
 * JSON-Dateiformat „prio-board“ (Version 3) – Export, Import, Validierung, Migration.
 * Beschreibung: schema/prio-board.schema.json und README.md.
 *
 *   {
 *     "format": "prio-board", "version": 3, "exportedAt": "…",
 *     "board": { "title": "…" }, "view": { "zoom": 1 },
 *     "themes": [ { "id", "title", "color": "#rrggbb" } ],
 *     "tasks": [ { "id", "kind": "thinking|implementation", "title", "description", "notes": [],
 *                  "status": "open|in_progress|done", "priority": 1-5, "start": "YYYY-MM-DD",
 *                  "durationDays", "bufferDays", "intensity": "focused|medium|background", "ongoing",
 *                  "iterations": [ { "title", "durationDays", "intensity", "done" } ], "theme": id|null } ],
 *     "dependencies": [ { "id", "from", "to", "fromIteration": null | index } ],
 *     "analysis": { … }   // nur Export, wird beim Import ignoriert
 *   }
 *
 * Ältere Stände werden schrittweise migriert: erste interne Speicherstände ({ blocks, deps }) → v1
 * (freies Board mit Gruppen) → v2 (Zeitachse, mehrere Themen je Aufgabe) → v3.
 */
PB.format = (() => {
  const C = PB.config;
  const U = PB.util;
  const CAL = PB.calendar;
  const KINDS = ['thinking', 'implementation'];
  const STATUSES = ['open', 'in_progress', 'done'];
  const INTENSITIES = ['focused', 'medium', 'background'];

  class FormatError extends Error {
    constructor(problems) {
      super(`Datei ungültig:\n• ${problems.slice(0, 8).join('\n• ')}${problems.length > 8 ? `\n• … (+${problems.length - 8})` : ''}`);
      this.name = 'FormatError';
      this.problems = problems;
    }
  }

  /* =====================================================================
   * Export
   * ===================================================================== */

  /**
   * Zustand → Dokument. Mit { model, analysis } wird zusätzlich ein berechneter
   * "analysis"-Block angehängt (für Auswertungen ausserhalb des Tools).
   */
  function serialize(state, { model, analysis, exportedAt = new Date().toISOString() } = {}) {
    const doc = {
      format: C.FORMAT.name,
      version: C.FORMAT.version,
      exportedAt,
      board: { title: state.board.title },
      view: { zoom: state.view.zoom },
      themes: state.themes.map((t) => ({ id: t.id, title: t.title, color: t.color })),
      tasks: state.tasks.map((t) => ({
        id: t.id,
        kind: t.kind,
        title: t.title,
        description: t.description,
        notes: [...t.notes],
        status: t.status,
        priority: t.priority,
        start: CAL.isoOf(t.start),
        durationDays: t.durationDays,
        bufferDays: t.bufferDays,
        intensity: t.intensity,
        ongoing: t.ongoing,
        iterations: t.iterations.map((it) => ({ title: it.title, durationDays: it.durationDays, intensity: it.intensity, done: it.done })),
        theme: t.theme,
      })),
      dependencies: state.dependencies.map((d) => ({ id: d.id, from: d.from, to: d.to, fromIteration: d.fromIteration })),
    };
    if (model && analysis) doc.analysis = buildAnalysis(state, model, analysis);
    return doc;
  }

  function buildAnalysis(state, model, a) {
    return {
      note: 'Beim Export berechnet – wird beim Import ignoriert.',
      planEnd: CAL.isoOf(a.planEnd),
      tasks: Object.fromEntries(state.tasks.map((t) => [t.id, {
        end: CAL.isoOf(model.endOf(t)),
        durationDays: model.durationOf(t),
        wave: a.wave.get(t.id) ?? null,
        state: a.stateOf(t.id),
        leverage: a.leverage.get(t.id),
        blockedBy: a.openPredecessors(t.id),
      }])),
      waves: a.waves,
      importantThinking: a.importantThinking,
      criticalPath: { tasks: a.criticalPath, durationDays: a.criticalDays },
    };
  }

  /* =====================================================================
   * Import
   * ===================================================================== */

  /**
   * String oder Objekt → normalisierter Zustand.
   * Standard (Import): streng – wirft FormatError mit allen Problemen.
   * { repair: true } (eigener gespeicherter Stand): repariert, was geht
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
    if (raw?.format === C.FORMAT.name && raw.version === 1) raw = migrateV1(raw);
    if (raw?.format === C.FORMAT.name && raw.version === 2) raw = migrateV2(raw);
    return normalize(raw, { repair, onWarning });
  }

  function normalize(raw, { repair, onWarning }) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new FormatError(['Inhalt ist kein JSON-Objekt']);

    // Grundstruktur ist nie reparierbar
    const fatal = [];
    if (raw.format !== C.FORMAT.name) fatal.push(`"format" muss "${C.FORMAT.name}" sein`);
    if (raw.version !== C.FORMAT.version) fatal.push(`"version" ${JSON.stringify(raw.version)} wird nicht unterstützt (1–${C.FORMAT.version})`);
    for (const key of ['tasks', 'dependencies']) {
      if (!Array.isArray(raw[key])) fatal.push(`"${key}" muss eine Liste sein`);
    }
    if (raw.themes !== undefined && !Array.isArray(raw.themes)) fatal.push('"themes" muss eine Liste sein');
    if (fatal.length) throw new FormatError(fatal);

    // Alles Weitere: im Reparaturmodus Hinweis + Standardwert, sonst Fehler
    const problems = [];
    const report = (message) => (repair ? onWarning(message) : problems.push(message));
    const text = (v) => (typeof v === 'string' ? v : '');

    const ids = new Set();
    const readId = (id, where) => {
      if (typeof id !== 'string' || !id.trim()) {
        report(`${where}: "id" fehlt`);
        id = U.uid('n');
      } else if (ids.has(id)) {
        report(`${where}: doppelte id "${id}"`);
        id = U.uid('n');
      }
      ids.add(id);
      return id;
    };
    /** Ganze Zahl in [min, max]; fehlend → fallback, ungültig → Problem + fallback. */
    const readInt = (value, where, field, { min, max = Infinity, fallback }) => {
      if (value === undefined || value === null || value === '') return fallback;
      const n = Number(value);
      if (!Number.isFinite(n) || n < min || n > max) {
        report(`${where}: "${field}" muss eine Zahl zwischen ${min} und ${max === Infinity ? '∞' : max} sein`);
        return fallback;
      }
      return Math.round(n);
    };
    const readEnum = (value, allowed, where, field, fallback) => {
      if (value === undefined) return fallback;
      if (allowed.includes(value)) return value;
      report(`${where}: "${field}" muss ${allowed.map((a) => `"${a}"`).join(' oder ')} sein`);
      return fallback;
    };

    const themes = (raw.themes || []).map((th, i) => {
      const where = `themes[${i}]`;
      const color = /^#[0-9a-f]{6}$/i.test(th?.color) ? th.color : C.THEME_COLORS[i % C.THEME_COLORS.length];
      return { id: readId(th?.id, where), title: text(th?.title) || 'Thema', color };
    });
    const themeIds = new Set(themes.map((t) => t.id));

    const tasks = raw.tasks.map((t, i) => {
      const where = `tasks[${i}]`;
      const kind = readEnum(t?.kind, KINDS, where, 'kind', 'thinking');
      // Fehlt der Start, ist die Aufgabe ungeplant (null) – das Modell schlägt beim Laden einen vor.
      const start = t?.start === undefined || t?.start === null ? null : CAL.dayOf(t.start);
      if (start === null && t?.start !== undefined && t?.start !== null) {
        report(`${where}: "start" muss ein Datum im Format JJJJ-MM-TT sein`);
      }
      const intensity = readEnum(t?.intensity, INTENSITIES, where, 'intensity', 'focused');
      const iterations = kind === 'thinking' && Array.isArray(t?.iterations)
        ? t.iterations.map((it, j) => ({
          title: text(it?.title) || `Iteration ${j + 1}`,
          durationDays: readInt(it?.durationDays, `${where}.iterations[${j}]`, 'durationDays', { min: 1, fallback: 5 }),
          intensity: readEnum(it?.intensity, INTENSITIES, `${where}.iterations[${j}]`, 'intensity', intensity),
          done: it?.done === true,
        }))
        : [];
      let theme = t?.theme ?? null;
      if (theme !== null && !themeIds.has(theme)) {
        report(`${where}: unbekanntes Thema "${theme}"${repair ? ' – entfernt' : ''}`);
        theme = null;
      }
      return {
        id: readId(t?.id, where),
        kind,
        title: text(t?.title) || 'Ohne Titel',
        description: text(t?.description),
        notes: Array.isArray(t?.notes) ? t.notes.filter((n) => typeof n === 'string' && n.trim()) : [],
        status: readEnum(t?.status, STATUSES, where, 'status', 'open'),
        priority: readInt(t?.priority, where, 'priority', { min: 1, max: C.PRIORITY_LEVELS, fallback: 3 }),
        start,
        durationDays: readInt(t?.durationDays, where, 'durationDays', { min: 1, fallback: C.DEFAULT_DURATION[kind] }),
        bufferDays: readInt(t?.bufferDays, where, 'bufferDays', { min: 0, fallback: 0 }),
        intensity,
        ongoing: kind === 'thinking' && t?.ongoing === true,
        iterations,
        theme,
      };
    });
    const taskById = new Map(tasks.map((t) => [t.id, t]));

    const dependencies = [];
    const depIds = new Set();
    const pairs = new Set();
    raw.dependencies.forEach((d, i) => {
      const where = `dependencies[${i}]`;
      const broken = [];
      if (!ids.has(d?.from)) broken.push(`"from" verweist auf unbekannte id "${d?.from}"`);
      if (!ids.has(d?.to)) broken.push(`"to" verweist auf unbekannte id "${d?.to}"`);
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
      const index = Number.isInteger(d.fromIteration) ? d.fromIteration : null;
      const fromIteration = index !== null && taskById.get(d.from)?.iterations[index] ? index : null;
      if (index !== null && fromIteration === null) report(`${where}: "fromIteration" ${index} existiert nicht`);
      dependencies.push({ id, from: d.from, to: d.to, fromIteration });
    });

    if (problems.length) throw new FormatError(problems);

    return {
      board: { title: text(raw.board?.title).trim() || 'Prio-Board' },
      view: { zoom: U.clamp(Number(raw.view?.zoom) || 1, C.ZOOM.min, C.ZOOM.max) },
      themes,
      tasks,
      dependencies,
    };
  }

  /* =====================================================================
   * Migration älterer Stände
   * ===================================================================== */

  const V1_ZONE_WIDTH = 480;

  /**
   * v2 → v3: höchstens ein Thema je Aufgabe (das erste bleibt).
   * Damit keine Abhängigkeit verloren geht, werden Abhängigkeiten der übrigen Themen
   * direkt auf die Aufgabe übertragen. Iterationen übernehmen die Intensität der Aufgabe.
   */
  function migrateV2(v2) {
    const tasks = Array.isArray(v2.tasks) ? v2.tasks : [];
    const dependencies = Array.isArray(v2.dependencies) ? [...v2.dependencies] : [];
    for (const task of tasks) {
      const themes = Array.isArray(task.themes) ? task.themes : [];
      for (const dropped of themes.slice(1)) {
        for (const d of v2.dependencies || []) {
          if (d.to === dropped && d.from !== task.id) dependencies.push({ from: d.from, to: task.id, fromIteration: d.fromIteration ?? null });
          if (d.from === dropped && d.to !== task.id) dependencies.push({ from: task.id, to: d.to, fromIteration: null });
        }
      }
    }
    return {
      ...v2,
      version: 3,
      tasks: tasks.map(({ themes, ...task }) => ({
        ...task,
        theme: Array.isArray(themes) && themes.length ? themes[0] : null,
        iterations: Array.isArray(task.iterations)
          ? task.iterations.map((it) => ({ intensity: task.intensity, ...it }))
          : task.iterations,
      })),
      dependencies,
    };
  }

  /**
   * v1 (freies Board) → v2 (Zeitplan):
   *  - Priorität aus der x-Spalte (480 px je Stufe, links = hoch)
   *  - Dauer aus effortDays (1 PT ≈ 1 Arbeitstag)
   *  - Gruppen → Themen (alle umschliessenden Gruppen, innerste zuerst; v2→v3 behält die innerste)
   *  - ohne Start: das Modell schlägt beim Laden einmalig Startdaten aus den Abhängigkeiten vor
   */
  function migrateV1(v1) {
    const groups = Array.isArray(v1.groups) ? v1.groups : [];
    const tasks = Array.isArray(v1.tasks) ? v1.tasks : [];
    const groupsAround = (layout) => {
      if (!layout) return [];
      const c = U.center(layout);
      return groups
        .filter((g) => g.layout && U.area(g.layout) > U.area(layout) && U.containsPoint(g.layout, c))
        .sort((a, b) => U.area(a.layout) - U.area(b.layout)) // innerste Gruppe zuerst
        .map((g) => g.id);
    };
    const priorityOf = (layout) => (layout
      ? U.clamp(Math.floor((layout.x + layout.width / 2) / V1_ZONE_WIDTH) + 1, 1, C.PRIORITY_LEVELS)
      : 3);
    return {
      format: C.FORMAT.name,
      version: 2,
      board: v1.board,
      view: { zoom: v1.view?.zoom ?? 1 },
      themes: groups.map((g, i) => ({ id: g.id, title: g.title, color: C.THEME_COLORS[i % C.THEME_COLORS.length] })),
      tasks: tasks.map((t) => ({
        id: t.id,
        kind: t.kind,
        title: t.title,
        description: t.description,
        notes: t.notes,
        status: t.status,
        priority: priorityOf(t.layout),
        durationDays: Math.max(1, Math.round(Number(t.effortDays) || C.DEFAULT_DURATION[t.kind] || 5)),
        bufferDays: 0,
        themes: groupsAround(t.layout),
      })),
      dependencies: Array.isArray(v1.dependencies) ? v1.dependencies.map((d) => ({ id: d.id, from: d.from, to: d.to })) : [],
    };
  }

  /** Interner Speicherstand der ersten Versionen: { blocks: [...], deps: [...] } */
  const isLegacy = (o) => o && !o.format && Array.isArray(o.blocks) && Array.isArray(o.deps);

  /** Erste Versionen → v1. mirror=true: Version mit „hohe Priorität rechts“ → horizontal spiegeln. */
  function migrateLegacy(old, { mirror = false } = {}) {
    const KIND = { denken: 'thinking', umsetzung: 'implementation' };
    const STATUS = { offen: 'open', laeuft: 'in_progress', fertig: 'done' };
    const axisWidth = V1_ZONE_WIDTH * C.PRIORITY_LEVELS;
    const layoutOf = (b) => ({ x: mirror ? Math.max(0, axisWidth - b.x - b.w) : b.x, y: b.y, width: b.w, height: b.h });
    const isGroupBlock = (b) => b.type === 'gruppe';
    return {
      format: C.FORMAT.name,
      version: 1,
      board: { title: 'Prio-Board' },
      view: { zoom: old.view?.scale ?? 1 },
      groups: old.blocks.filter(isGroupBlock).map((b) => ({ id: b.id, title: b.title, description: b.desc || '', layout: layoutOf(b) })),
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
