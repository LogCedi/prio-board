/**
 * Statische HTML-Seite, die nur das Diagramm zeigt (ohne Bedienelemente).
 * Die Seite ist eigenständig (CSS inline) und enthält zusätzlich die Board-Daten
 * als <script type="application/json" id="prio-board-data"> – so kann sie wieder importiert werden.
 */
PB.staticExport = (() => {
  const U = PB.util;
  const I = PB.icons;
  const model = PB.model;
  const DATA_ELEMENT_ID = 'prio-board-data';
  const PADDING = 40;

  const PAGE_CSS = `
*{box-sizing:border-box}
html,body{margin:0}
body{background:var(--bg);color:var(--text);font:15px/1.45 "Source Sans 3","Source Sans Pro",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.page-head{background:var(--navy);color:#fff;padding:18px 28px;display:flex;align-items:baseline;gap:16px;flex-wrap:wrap}
.page-head h1{margin:0;font-size:22px;display:flex;align-items:center;gap:10px}
.page-head h1::before{content:"";width:10px;height:24px;border-radius:3px;background:var(--accent)}
.page-head p{margin:0;opacity:.8}
.stage-wrap{padding:24px 28px;overflow:hidden}
.stage{position:relative;overflow:hidden;transform-origin:0 0;border-radius:var(--radius);box-shadow:var(--shadow);background:var(--bg)}
.page-legend{display:flex;flex-wrap:wrap;gap:8px 22px;padding:0 28px 28px;font-size:13.5px;color:var(--muted)}
.page-legend span{display:inline-flex;align-items:center;gap:8px}
.page-legend .dot{width:20px;height:20px;border-radius:50%;display:inline-grid;place-items:center;color:#fff;font-size:12px}
.page-legend .dot.thinking{background:var(--thinking)} .page-legend .dot.implementation{background:var(--impl)}
.page-legend .dot.group{border:2px dashed var(--group)}
.page-legend .ico{width:1em;height:1em;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
@media print{
  @page{size:landscape;margin:10mm}
  body{background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .stage-wrap{padding:12px 0}
  .stage{box-shadow:none}
}`;

  /** Passt das Diagramm an die Fensterbreite an (funktioniert auch ohne – dann scrollbar). */
  const FIT_SCRIPT = `(function(){
  var wrap=document.querySelector('.stage-wrap'),stage=document.querySelector('.stage');
  var w=stage.offsetWidth,h=stage.offsetHeight;
  function fit(){var s=Math.min(1,(wrap.clientWidth-56)/w);stage.style.transform='scale('+s+')';wrap.style.height=(h*s+48)+'px';}
  addEventListener('resize',fit);addEventListener('beforeprint',function(){stage.style.transform='';wrap.style.height='';});
  addEventListener('afterprint',fit);fit();
})();`;

  /** Ausschnitt: alle Blöcke plus Rand; mit Prioritätsachse immer ab der linken oberen Ecke. */
  function viewport(showAxis) {
    const box = U.bounds(model.allNodes().map((n) => n.layout)) || { x: 0, y: 0, width: 400, height: 200 };
    const x = showAxis ? 0 : Math.max(0, box.x - PADDING);
    const y = showAxis ? 0 : Math.max(0, box.y - PADDING);
    return { x, y, width: box.x + box.width + PADDING - x, height: box.y + box.height + PADDING - y };
  }

  function summary(analysis) {
    const { tasks } = model.getState();
    const done = tasks.filter((t) => t.status === 'done').length;
    const date = new Date().toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return `Stand ${date} · ${tasks.length} Aufgaben · ${analysis.ready.size} startbar · ${done} erledigt` +
      (analysis.criticalPath.length ? ` · kritischer Pfad ${U.formatNumber(analysis.criticalEffort)} PT` : '');
  }

  function legend() {
    return `<footer class="page-legend">
      <span><span class="dot thinking">${I.svg('brain')}</span>Denken – Analyse, braucht Zeit</span>
      <span><span class="dot implementation">${I.svg('wrench')}</span>Umsetzung – direkt machbar</span>
      <span><span class="dot group"></span>Gruppe / Abhängigkeitsblock</span>
      <span>A → B: A muss vor B fertig sein</span>
      <span>W1, W2 …: Wellen – gleiche Welle = parallel möglich</span>
      <span>Priorität: links hoch, rechts tief</span>
    </footer>`;
  }

  /** JSON sicher in ein <script> einbetten. */
  const embedJson = (doc) => JSON.stringify(doc).replace(/</g, '\\u003c');

  function build(analysis) {
    const state = model.getState();
    const esc = U.escapeHtml;
    const showAxis = state.view.showPriorityAxis;
    const m = PB.board.markup(analysis, { interactive: false });
    const vp = viewport(showAxis);
    const doc = PB.format.serialize(state, { model, analysis });

    return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Prio-Board">
<title>${esc(state.board.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet">
<style>
${PB.diagramStyles.themeVariables()}
${PAGE_CSS}
${PB.diagramStyles.CSS}
</style>
</head>
<body>
<header class="page-head"><h1>${esc(state.board.title)}</h1><p>${esc(summary(analysis))}</p></header>
<main class="stage-wrap">
  <div class="stage" style="width:${vp.width}px;height:${vp.height}px">
    <div class="pb-world" style="left:${-vp.x}px;top:${-vp.y}px;width:${m.size.width}px;height:${m.size.height}px">
      ${showAxis ? `<div class="pb-zones">${m.zones}</div>` : ''}
      <svg class="pb-links" width="${m.size.width}" height="${m.size.height}" xmlns="http://www.w3.org/2000/svg">
        <defs>${PB.diagramStyles.markerDefs()}</defs>${m.links}
      </svg>
      ${m.nodes}
    </div>
  </div>
</main>
${legend()}
<script type="application/json" id="${DATA_ELEMENT_ID}">${embedJson(doc)}</script>
<script>${FIT_SCRIPT}</script>
</body>
</html>
`;
  }

  /** Liest die eingebetteten Board-Daten aus einer exportierten HTML-Seite (oder null). */
  function extractData(html) {
    const page = new DOMParser().parseFromString(html, 'text/html');
    const el = page.getElementById(DATA_ELEMENT_ID);
    return el ? el.textContent : null;
  }

  return { build, extractData };
})();
