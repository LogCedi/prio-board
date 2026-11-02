/**
 * Abhängigkeitsanalyse (reine Funktionen über dem Modell).
 *
 * Kanten (edges) verbinden immer Aufgaben: Eine Abhängigkeit auf/von einem Thema
 * wird zu Kanten auf/von allen Aufgaben dieses Themas aufgelöst.
 */
PB.analysis = (() => {
  /** Alle Aufgaben-Kanten: { depId, from, to, iteration, viaTheme } */
  function edges(model, dependencies = model.getState().dependencies) {
    const result = [];
    for (const dep of dependencies) {
      const viaTheme = model.isTheme(dep.from) || model.isTheme(dep.to);
      const iteration = model.isTheme(dep.from) ? null : dep.fromIteration ?? null;
      for (const from of model.tasksOf(dep.from)) {
        for (const to of model.tasksOf(dep.to)) {
          if (from !== to) result.push({ depId: dep.id, from, to, iteration, viaTheme });
        }
      }
    }
    return result;
  }

  /** Map<taskId, Set<taskId>> der Vorgänger. */
  function predecessorMap(model, dependencies) {
    const preds = new Map(model.getState().tasks.map((t) => [t.id, new Set()]));
    for (const e of edges(model, dependencies)) preds.get(e.to)?.add(e.from);
    return preds;
  }

  function hasCycle(preds) {
    const VISITING = 1;
    const DONE = 2;
    const mark = new Map();
    const visit = (node) => {
      mark.set(node, VISITING);
      for (const p of preds.get(node) || []) {
        if (mark.get(p) === VISITING) return true;
        if (!mark.has(p) && visit(p)) return true;
      }
      mark.set(node, DONE);
      return false;
    };
    for (const node of preds.keys()) if (!mark.has(node) && visit(node)) return true;
    return false;
  }

  /** Transitive Hülle ausgehend von start über map (Vorgänger oder Nachfolger). */
  function closure(start, map) {
    const result = new Set();
    const stack = [...start];
    while (stack.length) {
      for (const next of map.get(stack.pop()) || []) {
        if (!result.has(next)) {
          result.add(next);
          stack.push(next);
        }
      }
    }
    return result;
  }

  /**
   * Vollständige Auswertung:
   *  - Wellen: offene Aufgaben in topologischen Stufen (gleiche Welle = parallel möglich)
   *  - ready: alle Vorgänger erledigt
   *  - leverage („Hebel“): Anzahl offener Umsetzungen, die eine Aufgabe (indirekt) freigibt
   *  - kritischer Pfad: längste Kette nach Dauer über offene Aufgaben
   *  - riskante Kanten: Nachfolger startet, bevor der Vorgänger (inkl. Puffer) fertig ist
   */
  function analyze(model) {
    const { tasks } = model.getState();
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const isDone = (id) => byId.get(id)?.status === 'done';
    const allEdges = edges(model);

    const predecessors = new Map(tasks.map((t) => [t.id, new Set()]));
    const successors = new Map(tasks.map((t) => [t.id, new Set()]));
    for (const e of allEdges) {
      predecessors.get(e.to).add(e.from);
      successors.get(e.from).add(e.to);
    }

    // Kahn-Algorithmus über offene Aufgaben
    const open = tasks.filter((t) => !isDone(t.id));
    const remaining = new Map(open.map((t) => [t.id, [...predecessors.get(t.id)].filter((p) => !isDone(p)).length]));
    const wave = new Map();
    const order = open.filter((t) => remaining.get(t.id) === 0).map((t) => t.id);
    order.forEach((id) => wave.set(id, 1));
    for (let i = 0; i < order.length; i++) {
      for (const next of successors.get(order[i])) {
        if (!remaining.has(next)) continue;
        wave.set(next, Math.max(wave.get(next) || 1, wave.get(order[i]) + 1));
        remaining.set(next, remaining.get(next) - 1);
        if (remaining.get(next) === 0) order.push(next);
      }
    }
    const inOrder = new Set(order);
    const cycle = new Set(open.filter((t) => !inOrder.has(t.id)).map((t) => t.id));

    const openPredecessors = (id) => [...(predecessors.get(id) || [])].filter((p) => !isDone(p));
    const ready = new Set(open.filter((t) => !cycle.has(t.id) && openPredecessors(t.id).length === 0).map((t) => t.id));

    const waves = [];
    wave.forEach((n, id) => (waves[n - 1] ||= []).push(id));
    const byPriorityThenStart = (a, b) => byId.get(a).priority - byId.get(b).priority || byId.get(a).start - byId.get(b).start;
    waves.forEach((list) => list.sort(byPriorityThenStart));

    // Hebel
    const leverage = new Map(tasks.map((t) => [t.id,
      [...closure([t.id], successors)].filter((id) => byId.get(id).kind === 'implementation' && !isDone(id)).length]));

    // Kritischer Pfad
    const finish = new Map();
    const via = new Map();
    for (const id of order) {
      let best = 0;
      let bestPred = null;
      for (const p of predecessors.get(id)) {
        if (finish.has(p) && finish.get(p) > best) {
          best = finish.get(p);
          bestPred = p;
        }
      }
      finish.set(id, best + model.durationOf(byId.get(id)));
      via.set(id, bestPred);
    }
    let end = null;
    finish.forEach((f, id) => { if (end === null || f > finish.get(end)) end = id; });
    const criticalPath = [];
    for (let id = end; id; id = via.get(id)) criticalPath.unshift(id);

    // Riskante Kanten: Nachfolger startet vor dem (spätesten) Ende des Vorgängers – inkl. Puffer
    const riskyDeps = new Set();
    for (const e of allEdges) {
      const from = byId.get(e.from);
      if (from.status === 'done') continue;
      const end = e.iteration !== null ? model.iterationEnd(from, e.iteration) : model.endOf(from) + from.bufferDays;
      if (byId.get(e.to).start < end) riskyDeps.add(`${e.from}→${e.to}`);
    }

    // Wichtigste Denk-Themen: viel Hebel × lange Dauer
    const importantThinking = open
      .filter((t) => t.kind === 'thinking')
      .map((t) => ({ id: t.id, score: (leverage.get(t.id) + 1) * model.durationOf(t) }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.id);

    const planEnd = open.reduce((max, t) => Math.max(max, model.endOf(t)), 0);

    /** 'done' | 'cycle' | 'in_progress' | 'ready' | 'waiting' */
    function stateOf(id) {
      const task = byId.get(id);
      if (!task) return null;
      if (task.status === 'done') return 'done';
      if (cycle.has(id)) return 'cycle';
      if (task.status === 'in_progress') return 'in_progress';
      return ready.has(id) ? 'ready' : 'waiting';
    }

    return {
      edges: allEdges, predecessors, successors,
      wave, waves, cycle, ready, leverage,
      criticalPath, criticalDays: end ? finish.get(end) : 0,
      isRisky: (from, to) => riskyDeps.has(`${from}→${to}`),
      importantThinking, planEnd,
      openPredecessors, stateOf,
    };
  }

  return { edges, predecessorMap, hasCycle, closure, analyze };
})();
