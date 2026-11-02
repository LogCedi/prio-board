/** SVG-Icons (Pfade nach Lucide, ISC-Lizenz). */
PB.icons = (() => {
  const PATHS = {
    brain:
      '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/>' +
      '<path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>' +
      '<path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/><path d="M17.599 6.5a3 3 0 0 0 .399-1.375"/>' +
      '<path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/><path d="M3.477 10.896a4 4 0 0 1 .585-.396"/>' +
      '<path d="M19.938 10.5a4 4 0 0 1 .585.396"/><path d="M6 18a4 4 0 0 1-1.967-.516"/>' +
      '<path d="M19.967 17.484A4 4 0 0 1 18 18"/>',
    wrench:
      '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91' +
      'a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    group: '<rect x="3" y="3" width="18" height="18" rx="3" stroke-dasharray="4 3"/>',
  };
  const KIND_ICON = { thinking: 'brain', implementation: 'wrench', group: 'group' };

  const svg = (name) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name] || ''}</svg>`;
  const forKind = (kind) => svg(KIND_ICON[kind]);

  /** Füllt alle Elemente mit data-icon="name". */
  function hydrate(root = document) {
    root.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = svg(el.dataset.icon); });
  }

  return { svg, forKind, hydrate };
})();
