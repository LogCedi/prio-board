/** Persistenz: Browser-Speicher (automatisch) und Dateien (Import/Export). */
PB.storage = (() => {
  const C = PB.config;
  const F = PB.format;

  function read(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Letzten Stand laden; ältere Speicherstände werden migriert, kleine Schäden repariert.
   * Liefert { state, repairs[], backupKey } oder null, wenn nichts Brauchbares gespeichert ist.
   * Vor jeder Reparatur wird das Original unter einem Sicherungs-Key abgelegt.
   */
  function loadLocal() {
    const candidates = [
      { key: C.STORAGE_KEY, convert: (o) => o },
      ...C.LEGACY_STORAGE.map((l) => ({ key: l.key, convert: (o) => F.migrateLegacy(o, { mirror: l.mirror }) })),
    ];
    for (const { key, convert } of candidates) {
      const text = read(key);
      if (!text) continue;
      try {
        const repairs = [];
        const state = F.parse(convert(JSON.parse(text)), { repair: true, onWarning: (m) => repairs.push(m) });
        let backupKey = null;
        if (repairs.length) {
          backupKey = `${C.STORAGE_KEY}.backup-${new Date().toISOString()}`;
          write(backupKey, text);
        }
        return { state, repairs, backupKey };
      } catch (e) {
        console.warn(`Gespeicherter Stand ${key} nicht lesbar:`, e);
        write(`${key}.unreadable-${new Date().toISOString()}`, text);
      }
    }
    return null;
  }

  /** Liefert false, wenn der Browser-Speicher nicht verfügbar ist (z. B. Sandbox, privates Fenster). */
  function saveLocal(state) {
    return write(C.STORAGE_KEY, JSON.stringify(F.serialize(state)));
  }

  function download(content, filename, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return { loadLocal, saveLocal, downloadText: download };
})();
