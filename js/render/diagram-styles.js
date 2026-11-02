/**
 * Darstellung des Diagramms (Zeitachse, Prioritätsbänder, Balken, Pfeile).
 *
 * Bewusst als JS-Modul statt .css-Datei: Dieselben Regeln werden
 *   1) beim Start in die App eingefügt und
 *   2) in die exportierte statische HTML-Seite geschrieben.
 * Browser verbieten unter file:// das Auslesen von Stylesheets, daher eine gemeinsame Quelle hier.
 * Farben kommen als CSS-Variablen aus css/theme.css; Masse aus PB.config.
 */
PB.diagramStyles = (() => {
  const C = PB.config;

  /** Tokens aus theme.css, die das Diagramm benötigt (werden beim Export mitkopiert). */
  const TOKENS = [
    '--navy', '--accent', '--bg', '--ink', '--text', '--muted', '--line',
    '--thinking', '--thinking-bg', '--thinking-fill', '--thinking-line',
    '--impl', '--impl-bg', '--impl-fill', '--impl-line',
    '--ok', '--ok-bg', '--wait', '--wait-bg', '--bad', '--bad-bg', '--run', '--run-bg',
    '--link', '--link-done', '--risky', '--up', '--down', '--crit', '--sel', '--radius', '--shadow',
  ];

  /** Pfeilspitzen je Zustand → Token. */
  const MARKERS = {
    def: '--link', done: '--link-done', risky: '--risky', bad: '--bad',
    up: '--up', down: '--down', crit: '--crit', sel: '--sel',
  };

  const CSS = `
.pb-world{position:absolute;left:0;top:0;transform-origin:0 0;background:var(--bg);color:var(--text)}
.pb-world .ico{width:1em;height:1em;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}

/* ---------- Raster: Wochen, Tage, Bänder ---------- */
.pb-world .tl-week{position:absolute;top:0;border-left:1px solid #d3dce8}
.pb-world .tl-week.alt{background:rgba(11,45,85,.025)}
.pb-world .tl-days{position:absolute;top:${C.HEADER_HEIGHT}px;bottom:0;left:${C.LABEL_WIDTH}px;right:0;
  background-image:linear-gradient(90deg,rgba(11,45,85,.045) 1px,transparent 1px);background-size:${C.DAY_WIDTH}px 100%}
.pb-world .tl-week-label{position:absolute;left:0;right:0;top:0;height:${C.HEADER_HEIGHT}px;padding:8px 10px;background:#fff;
  border-bottom:1px solid var(--line);font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;z-index:2}
.pb-world .tl-week-label b{display:block;color:var(--ink);font-size:13px}
.pb-world .tl-week.today .tl-week-label b{color:var(--accent)}
.pb-world .tl-band{position:absolute;left:0;border-bottom:1px solid var(--line)}
.pb-world .tl-band.alt{background:rgba(11,45,85,.018)}
.pb-world .tl-band-label{position:absolute;left:0;top:0;bottom:0;width:${C.LABEL_WIDTH}px;padding:14px;background:#fff;
  border-right:1px solid var(--line);z-index:3}
.pb-world .tl-band-label b{display:block;color:var(--ink);font-size:16px}
.pb-world .tl-band-label span{font-size:11.5px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--muted)}
.pb-world .tl-corner{position:absolute;left:0;top:0;width:${C.LABEL_WIDTH}px;height:${C.HEADER_HEIGHT}px;background:#fff;z-index:4;
  border-right:1px solid var(--line);border-bottom:1px solid var(--line);padding:8px 14px;font-size:12px;color:var(--muted);line-height:1.35}
.pb-world .tl-corner b{color:var(--ink)}
.pb-world .tl-today{position:absolute;top:${C.HEADER_HEIGHT}px;bottom:0;left:${C.LABEL_WIDTH}px;width:2px;background:var(--accent);z-index:1}

/* ---------- Balken ---------- */
.pb-world .bar{position:absolute;z-index:10;border-radius:10px;border:1.5px solid;box-shadow:var(--shadow)}
.pb-world .bar.thinking{border-color:var(--thinking-line);background:var(--thinking-fill)}
.pb-world .bar.implementation{border-color:var(--impl-line);background:var(--impl-fill)}
.pb-world .bar.thinking.int-background{background:repeating-linear-gradient(-45deg,var(--thinking-bg) 0 7px,var(--thinking-fill) 7px 14px)}
.pb-world .bar.implementation.int-background{background:repeating-linear-gradient(-45deg,var(--impl-bg) 0 7px,var(--impl-fill) 7px 14px)}
.pb-world .bar.st-done{opacity:.5}
.pb-world .bar.st-done .title{text-decoration:line-through}
.pb-world .bar-body{position:absolute;inset:0;display:flex;gap:8px;align-items:flex-start;padding:7px 9px;overflow:hidden;border-radius:9px}
.pb-world .bar.has-iterations .bar-body{bottom:16px}
.pb-world .tico{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;color:#fff;flex:none;font-size:15px}
.pb-world .thinking .tico{background:var(--thinking);box-shadow:0 0 0 3px rgba(0,159,227,.18)}
.pb-world .implementation .tico{background:var(--impl);box-shadow:0 0 0 3px rgba(31,154,107,.16)}
.pb-world .bar-text{min-width:0}
.pb-world .bar .title{font-weight:700;font-size:14px;color:var(--ink);line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pb-world .bar .meta{display:flex;gap:6px;align-items:center;margin-top:2px;font-size:11.5px;color:var(--muted);white-space:nowrap}
.pb-world .bar.narrow .bar-body{overflow:visible;padding-left:0;padding-right:0;justify-content:center}
.pb-world .bar.narrow .bar-text{position:absolute;left:calc(100% + var(--buf) + 10px);top:7px;max-width:${C.LABEL_RESERVE - 16}px}
.pb-world .lev{font-weight:700;color:var(--ink)}
.pb-world .badge{padding:0 7px;border-radius:999px;font-weight:700}
.pb-world .badge.ready{background:var(--ok-bg);color:var(--ok)}
.pb-world .badge.waiting{background:var(--wait-bg);color:var(--wait)}
.pb-world .badge.cycle{background:var(--bad-bg);color:var(--bad)}
.pb-world .badge.in_progress{background:var(--run-bg);color:var(--run)}
.pb-world .badge.done{background:#e3e8ef;color:#4e5d70}

/* Themen-Streifen */
.pb-world .bar-themes{position:absolute;left:10px;right:10px;top:-5px;height:5px;display:flex;gap:2px;z-index:2}
.pb-world .bar-themes span{flex:1;border-radius:3px}

/* Iterationen */
.pb-world .bar-iterations{position:absolute;left:0;right:0;bottom:0;height:16px;display:flex;overflow:hidden;border-radius:0 0 9px 9px;
  border-top:1px solid rgba(11,45,85,.1)}
.pb-world .iter-seg{flex:none;height:100%;border-right:2px solid #fff;padding:0 6px;font-size:10.5px;font-weight:700;line-height:15px;
  color:var(--thinking);background:rgba(0,159,227,.12);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pb-world .iter-seg:last-child{border-right:0}
.pb-world .iter-seg.done{background:var(--thinking);color:#fff}

/* Puffer (Unsicherheit) und laufendes Denken */
.pb-world .bar-buffer{position:absolute;left:100%;top:7px;bottom:7px;border-radius:0 8px 8px 0;border:1.5px dashed;border-left:0}
.pb-world .thinking .bar-buffer{border-color:var(--thinking-line);background:linear-gradient(90deg,rgba(0,159,227,.22),rgba(0,159,227,.04))}
.pb-world .implementation .bar-buffer{border-color:var(--impl-line);background:linear-gradient(90deg,rgba(31,154,107,.22),rgba(31,154,107,.04))}
.pb-world .bar-ongoing{position:absolute;left:calc(100% + var(--buf));top:12px;bottom:12px;border-radius:0 8px 8px 0;
  background:linear-gradient(90deg,rgba(0,159,227,.3),rgba(0,159,227,0))}
.pb-world .bar-ongoing span{position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:11.5px;font-weight:700;color:var(--thinking);white-space:nowrap}

/* ---------- Pfeile ---------- */
.pb-world .pb-links{position:absolute;left:0;top:0;z-index:5;pointer-events:none;overflow:visible}
.pb-world .pb-links .hit{fill:none;stroke:transparent;stroke-width:14}
.pb-world .pb-links .vis{fill:none;stroke:var(--link);stroke-width:2;marker-end:url(#m-def)}
.pb-world .pb-links .link.via-theme .vis{stroke-dasharray:2 4}
.pb-world .pb-links .link.done .vis{stroke:var(--link-done);stroke-dasharray:5 4;marker-end:url(#m-done)}
.pb-world .pb-links .link.risky .vis{stroke:var(--risky);stroke-width:2.4;marker-end:url(#m-risky)}
.pb-world .pb-links .link.bad .vis{stroke:var(--bad);marker-end:url(#m-bad)}
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
