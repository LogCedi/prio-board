/**
 * Abhängigkeitsanalyse (reine Funktionen über dem Modell).
 *
 * Effektive Vorgänger einer Aufgabe T:
 *   - alle Abhängigkeiten, die direkt auf T zeigen,
 *   - plus alle, die auf eine Gruppe zeigen, in der T liegt.
 *   Zeigt eine Abhängigkeit VON einer Gruppe weg, zählen alle Aufgaben darin.
 */
PB.analysis = (() => {
  const C = PB.config;
  const U = PB.util;

  /** Priorität aus der horizontalen Position: 1 (links, hoch) … PRIORITY_LEVELS (rechts, tief). */
  function priorityOf(layout) {
    const cx = layout.x + layout.width / 2;
    return U.clamp(Math.floor(cx / C.ZONE_WIDTH) + 1, 1, C.PRIORITY_LEVELS);
  }
  const priorityLabel = (p) => C.PRIORITY_LABELS[p - 1];

  /** Aufwand in Personentagen; fehlende Angaben zählen als 1. */
  function effortOf(task) {
    const n = Number(task.effortDays);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  /** Map<taskId, Set<taskId>> der effektiven Vorgänger. */
  function predecessorMap(model, dependencies = model.getState().dependencies) {
    const preds = new Map();
    const tasks = model.getState().tasks;
    tasks.forEach((t) => preds.set(t.id, new Set()));
    for (const task of tasks) {
      for (const scope of [task.id, ...model.ancestorsOf(task.id)]) {
        for (const dep of dependencies) {
          if (dep.to !== scope) continue;
          for (const p of model.tasksWithin(dep.from)) if (p !== task.id) preds.get(task.id).add(p);
        }
      }
    }
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
   * Vollständige Auswertung des Boards.
   * Wellen: offene Aufgaben in topologischen Stufen – innerhalb einer Welle
   * bestehen keine Abhängigkeiten, sie können parallel bearbeitet werden.
   */
  function analyze(model) {
    const tasks = model.getState().tasks;
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const isDone = (id) => byId.get(id)?.status === 'done';

    const predecessors = predecessorMap(model);
    const successors = new Map(tasks.map((t) => [t.id, new Set()]));
    predecessors.forEach((preds, id) => preds.forEach((p) => successors.get(p).add(id)));

    // Kahn-Algorithmus über offene Aufgaben
    const open = tasks.filter((t) => !isDone(t.id));
    const remaining = new Map(open.map((t) => [t.id, [...predecessors.get(t.id)].filter((p) => !isDone(p)).length]));
    const wave = new Map();
    const order = open.filter((t) => remaining.get(t.id) === 0).map((t) => t.id);
    order.forEach((id) => wave.set(id, 1));
    for (let i = 0; i < order.length; i++) {
      const id = order[i];
      for (const next of successors.get(id)) {
        if (!remaining.has(next)) continue;
        wave.set(next, Math.max(wave.get(next) || 1, wave.get(id) + 1));
        remaining.set(next, remaining.get(next) - 1);
        if (remaining.get(next) === 0) order.push(next);
      }
    }
    const inOrder = new Set(order);
    const cycle = new Set(open.filter((t) => !inOrder.has(t.id)).map((t) => t.id));
    cycle.forEach((id) => wave.delete(id));

    const openPredecessors = (id) => [...(predecessors.get(id) || [])].filter((p) => !isDone(p));
    const ready = new Set(open.filter((t) => !cycle.has(t.id) && openPredecessors(t.id).length === 0).map((t) => t.id));

    // Wellen als sortierte Listen (Priorität, dann Umsetzung vor Denken)
    const priority = new Map(tasks.map((t) => [t.id, priorityOf(t.layout)]));
    const waves = [];
    wave.forEach((n, id) => (waves[n - 1] ||= []).push(id));
    waves.forEach((list) => list.sort((a, b) =>
      priority.get(a) - priority.get(b) ||
      (byId.get(a).kind === 'implementation' ? -1 : 1) - (byId.get(b).kind === 'implementation' ? -1 : 1)));

    // Kritischer Pfad: längste Kette nach Aufwand über offene Aufgaben
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
      finish.set(id, best + effortOf(byId.get(id)));
      via.set(id, bestPred);
    }
    let end = null;
    finish.forEach((f, id) => { if (end === null || f > finish.get(end)) end = id; });
    const criticalPath = [];
    for (let id = end; id; id = via.get(id)) criticalPath.unshift(id);

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
      predecessors, successors,
      wave, waves, cycle, ready,
      criticalPath, criticalEffort: end ? finish.get(end) : 0,
      openPredecessors, stateOf,
      priorityOf: (id) => priority.get(id) ?? priorityOf(model.getNode(id).layout),
    };
  }

  return { priorityOf, priorityLabel, effortOf, predecessorMap, hasCycle, closure, analyze };
})();
