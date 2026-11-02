/**
 * Darstellung des Diagramms (Blöcke, Gruppen, Pfeile, Prioritätsachse).
 *
 * Bewusst als JS-Modul statt .css-Datei: Dieselben Regeln werden
 *   1) beim Start in die App eingefügt und
 *   2) in die exportierte statische HTML-Seite geschrieben.
 * Browser verbieten unter file:// das Auslesen von Stylesheets, daher eine gemeinsame Quelle hier.
 * Farben kommen als CSS-Variablen aus css/theme.css.
 */
PB.diagramStyles = (() => {
  /** Tokens aus theme.css, die das Diagramm benötigt (werden beim Export mitkopiert). */
  const TOKENS = [
    '--navy', '--accent', '--bg', '--ink', '--text', '--muted', '--line',
    '--thinking', '--thinking-bg', '--thinking-line', '--impl', '--impl-bg', '--impl-line', '--group',
    '--ok', '--ok-bg', '--wait', '--wait-bg', '--bad', '--bad-bg', '--run', '--run-bg',
    '--link', '--link-done', '--up', '--down', '--crit', '--sel', '--radius', '--shadow',
  ];

  /** Pfeilspitzen je Zustand → Token. */
  const MARKERS = {
    def: '--link', done: '--link-done', bad: '--bad', up: '--up', down: '--down', crit: '--crit', sel: '--sel',
  };

  const CSS = `
.pb-world{position:absolute;left:0;top:0;transform-origin:0 0;background-color:var(--bg);
  background-image:radial-gradient(circle,#c9d4e2 1.1px,transparent 1.3px);background-size:20px 20px}
.pb-world .ico{width:1em;height:1em;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}

/* Prioritätsachse */
.pb-zones{position:absolute;left:0;top:0;height:100%;display:flex;pointer-events:none}
.pb-zones .z{height:100%;border-right:1px solid #e1e8f1;position:relative}
.pb-zones .z span{position:absolute;top:12px;left:14px;font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;
  padding:3px 10px;border-radius:999px;background:#fff;color:var(--ink);box-shadow:var(--shadow)}
.pb-zones .axis{position:absolute;top:50px;left:14px;font-size:13px;color:var(--muted);display:flex;align-items:center;gap:8px;font-weight:600}
.pb-zones .axis i{display:block;height:3px;width:220px;border-radius:3px;background:linear-gradient(90deg,var(--navy),#c9d4e2)}
.pb-zones.off{display:none}

/* Blöcke */
.block{position:absolute;border-radius:var(--radius)}
.block.task{z-index:1000;background:#fff;box-shadow:var(--shadow);border:1.5px solid var(--line)}
.block.task::before{content:"";position:absolute;left:-1.5px;top:-1.5px;bottom:-1.5px;width:6px;border-radius:var(--radius) 0 0 var(--radius)}
.block.task.thinking{background:var(--thinking-bg);border-color:var(--thinking-line)}
.block.task.thinking::before{background:var(--thinking)}
.block.task.implementation{background:var(--impl-bg);border-color:var(--impl-line)}
.block.task.implementation::before{background:var(--impl)}
.block.group{border:2px dashed var(--group);background:rgba(255,255,255,.55)}
.block.st-done{opacity:.55}
.block.st-done .title{text-decoration:line-through}
.inner{position:absolute;inset:0;padding:12px 14px 30px 14px;overflow:hidden;border-radius:calc(var(--radius) - 2px)}
.thead{display:flex;align-items:center;gap:10px;margin-bottom:4px;padding-right:34px}
.tico{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;color:#fff;flex:none;font-size:20px}
.thinking .tico{background:var(--thinking);box-shadow:0 0 0 4px rgba(0,159,227,.18)}
.implementation .tico{background:var(--impl);box-shadow:0 0 0 4px rgba(31,154,107,.16)}
.tkind{font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase}
.thinking .tkind{color:var(--thinking)}
.implementation .tkind{color:var(--impl)}
.title{font-weight:700;font-size:16px;color:var(--ink);line-height:1.25;word-break:break-word}
.notes{margin:4px 0 0;padding-left:18px;font-size:13.5px;color:var(--text)}
.notes li::marker{color:var(--muted)}
.desc{font-size:13px;color:var(--muted);margin-top:4px;white-space:pre-wrap;word-break:break-word}
.foot{position:absolute;left:14px;right:10px;bottom:7px;display:flex;gap:6px;align-items:center;font-size:12px;white-space:nowrap;overflow:hidden}
.badge{padding:1px 8px;border-radius:999px;font-weight:700}
.badge.ready{background:var(--ok-bg);color:var(--ok)}
.badge.waiting{background:var(--wait-bg);color:var(--wait)}
.badge.cycle{background:var(--bad-bg);color:var(--bad)}
.badge.in_progress{background:var(--run-bg);color:var(--run)}
.badge.done{background:#e3e8ef;color:#4e5d70}
.meta{color:var(--muted)}
.wave{position:absolute;top:10px;right:10px;font-size:11.5px;font-weight:700;color:#fff;background:var(--navy);border-radius:999px;padding:1px 8px}

/* Gruppen */
.ghead{position:absolute;left:14px;top:-15px;display:flex;gap:8px;align-items:center;background:var(--navy);color:#fff;
  border-radius:999px;padding:3px 12px;max-width:calc(100% - 28px);white-space:nowrap;overflow:hidden;box-shadow:var(--shadow)}
.gtitle{font-weight:700;overflow:hidden;text-overflow:ellipsis}
.gmeta{font-size:12px;opacity:.75}
.gdesc{position:absolute;left:16px;bottom:8px;right:16px;font-size:13px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* Pfeile */
.pb-links{position:absolute;left:0;top:0;z-index:500;pointer-events:none;overflow:visible}
.pb-links .vis{fill:none;stroke:var(--link);stroke-width:2.2;marker-end:url(#m-def)}
.pb-links .link.done .vis{stroke:var(--link-done);stroke-dasharray:5 4;marker-end:url(#m-done)}
.pb-links .link.bad .vis{stroke:var(--bad);marker-end:url(#m-bad)}
`;

  /** <defs> mit den Pfeilspitzen für ein SVG. */
  function markerDefs() {
    return Object.entries(MARKERS).map(([name, token]) =>
      `<marker id="m-${name}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">` +
      `<path d="M0,0 L10,5 L0,10 z" style="fill:var(${token})"/></marker>`).join('');
  }

  /** Aktuelle Werte der Tokens als :root-Regel (für den Export). */
  function themeVariables() {
    const computed = getComputedStyle(document.documentElement);
    const lines = TOKENS.map((t) => `  ${t}:${computed.getPropertyValue(t).trim()};`);
    return `:root{\n${lines.join('\n')}\n}`;
  }

  function inject() {
    const style = document.createElement('style');
    style.id = 'pb-diagram-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  return { CSS, inject, markerDefs, themeVariables };
})();
