/**
 * Flüchtiger UI-Zustand (nicht gespeichert, nicht in der Historie).
 * Wird von Renderern gelesen und von app.js geändert.
 */
PB.ui = {
  /** { type: 'task' | 'theme' | 'dependency' | null, id } */
  selection: { type: null, id: null },
  hoverId: null,
  tab: 'plan',            // 'details' | 'plan' | 'help'
  focusMode: 'none',      // 'none' | 'ready' | 'critical'
  dragging: false,
};
