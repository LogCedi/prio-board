/** Kleine, zustandslose Hilfsfunktionen. */
PB.util = (() => {
  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
  const uid = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  /** Geometrie auf Layout-Objekten { x, y, width, height } (für die Migration alter Boards). */
  const center = (l) => ({ x: l.x + l.width / 2, y: l.y + l.height / 2 });
  const area = (l) => l.width * l.height;
  const containsPoint = (l, p) => p.x > l.x && p.x < l.x + l.width && p.y > l.y && p.y < l.y + l.height;

  /** "2,5" → 2.5; leer/ungültig → null */
  function parseNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(String(value).trim().replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }

  function slugify(text) {
    return String(text || 'prio-board')
      .toLowerCase()
      .replace(/ß/g, 'ss')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'prio-board';
  }

  const today = () => new Date().toISOString().slice(0, 10);

  return { escapeHtml, uid, clamp, center, area, containsPoint, parseNumber, slugify, today };
})();
