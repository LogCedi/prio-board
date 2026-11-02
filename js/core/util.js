/** Kleine, zustandslose Hilfsfunktionen. */
PB.util = (() => {
  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const NUMBER = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 1 });

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
  const uid = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
  const snap = (value) => Math.round(value / PB.config.GRID) * PB.config.GRID;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const formatNumber = (n) => NUMBER.format(n);

  /** Geometrie auf Layout-Objekten { x, y, width, height }. */
  const center = (l) => ({ x: l.x + l.width / 2, y: l.y + l.height / 2 });
  const area = (l) => l.width * l.height;
  const containsPoint = (l, p) => p.x > l.x && p.x < l.x + l.width && p.y > l.y && p.y < l.y + l.height;

  /** Bounding-Box über mehrere Layouts. */
  function bounds(layouts) {
    if (!layouts.length) return null;
    const box = { x: Infinity, y: Infinity, right: -Infinity, bottom: -Infinity };
    for (const l of layouts) {
      box.x = Math.min(box.x, l.x);
      box.y = Math.min(box.y, l.y);
      box.right = Math.max(box.right, l.x + l.width);
      box.bottom = Math.max(box.bottom, l.y + l.height);
    }
    return { x: box.x, y: box.y, width: box.right - box.x, height: box.bottom - box.y };
  }

  /** "2,5" → 2.5; leer/ungültig → null */
  function parseNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(String(value).trim().replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }

  function slugify(text) {
    return String(text || 'prio-board')
      .toLowerCase()
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'prio-board';
  }

  const today = () => new Date().toISOString().slice(0, 10);

  return { escapeHtml, uid, snap, clamp, formatNumber, center, area, containsPoint, bounds, parseNumber, slugify, today };
})();
