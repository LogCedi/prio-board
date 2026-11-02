/**
 * Eigene Dialoge statt alert()/confirm() und Datei-Download-Fallback.
 *
 * Grund: In eingebetteten Vorschauen (sandboxed iframes) werden alert/confirm ignoriert
 * und Downloads still blockiert. Diese Dialoge funktionieren überall; Exporte bieten
 * zusätzlich „In Zwischenablage kopieren“, Importe „JSON einfügen“.
 */
PB.dialog = (() => {
  const esc = PB.util.escapeHtml;
  let dialog = null;

  function ensure() {
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.className = 'pb-dialog';
    document.body.appendChild(dialog);
    return dialog;
  }

  /** Öffnet einen Dialog; resolve(value) schliesst ihn. */
  function open(html, setup) {
    const d = ensure();
    d.innerHTML = `<form method="dialog" class="pb-dialog-body">${html}</form>`;
    return new Promise((resolve) => {
      const finish = (value) => {
        d.close();
        resolve(value);
      };
      d.onclose = () => resolve(undefined);
      d.querySelectorAll('[data-result]').forEach((b) => b.addEventListener('click', (e) => {
        e.preventDefault();
        finish(b.dataset.result === 'true');
      }));
      setup?.(d, finish);
      d.showModal();
    });
  }

  const paragraphs = (text) => esc(text).split('\n').map((line) => `<p>${line}</p>`).join('');

  /** Ja/Nein-Frage. Liefert true/false. */
  async function confirm(message, { okLabel = 'OK', danger = false } = {}) {
    const result = await open(`
      <div class="pb-dialog-text">${paragraphs(message)}</div>
      <div class="pb-dialog-actions">
        <button class="btn" data-result="false">Abbrechen</button>
        <button class="btn primary${danger ? ' danger' : ''}" data-result="true" autofocus>${esc(okLabel)}</button>
      </div>`);
    return result === true;
  }

  /** Hinweis mit OK-Knopf. */
  function alert(message, { title = 'Hinweis' } = {}) {
    return open(`
      <h2>${esc(title)}</h2>
      <div class="pb-dialog-text">${paragraphs(message)}</div>
      <div class="pb-dialog-actions"><button class="btn primary" data-result="true" autofocus>OK</button></div>`);
  }

  async function copyText(textarea) {
    try {
      await navigator.clipboard.writeText(textarea.value);
      return true;
    } catch {
      textarea.focus();
      textarea.select();
      try {
        return document.execCommand('copy');
      } catch {
        return false;
      }
    }
  }

  /**
   * Export-Dialog: Herunterladen und/oder Kopieren.
   * download: Funktion, die den Download auslöst.
   */
  function exportFile({ title, description, filename, content, download }) {
    return open(`
      <h2>${esc(title)}</h2>
      <p class="pb-dialog-hint">${esc(description)}</p>
      <textarea class="pb-dialog-code" readonly spellcheck="false">${esc(content)}</textarea>
      <p class="pb-dialog-hint small">Falls der Download hier blockiert ist (z. B. in einer Vorschau):
        kopieren, in einen Texteditor einfügen und als <b>${esc(filename)}</b> speichern.</p>
      <div class="pb-dialog-actions">
        <span class="pb-dialog-status" aria-live="polite"></span>
        <button class="btn" data-result="false">Schliessen</button>
        <button class="btn" data-copy>In Zwischenablage kopieren</button>
        <button class="btn primary" data-download autofocus>Herunterladen</button>
      </div>`, (d) => {
      const status = d.querySelector('.pb-dialog-status');
      d.querySelector('[data-download]').addEventListener('click', (e) => {
        e.preventDefault();
        download();
        status.textContent = 'Download gestartet – falls nichts passiert: kopieren.';
      });
      d.querySelector('[data-copy]').addEventListener('click', async (e) => {
        e.preventDefault();
        status.textContent = (await copyText(d.querySelector('textarea'))) ? '✓ Kopiert' : 'Bitte Text markieren und mit Strg+C kopieren';
      });
    });
  }

  /** Import-Dialog: Datei wählen oder Text einfügen. Liefert den Text oder undefined. */
  function importFile() {
    return open(`
      <h2>Board importieren</h2>
      <p class="pb-dialog-hint">JSON-Datei („prio-board“) oder eine mit „Als HTML“ erstellte Seite.</p>
      <label class="btn pb-file">Datei wählen…<input type="file" accept=".json,application/json,.html,text/html" hidden></label>
      <p class="pb-dialog-hint">…oder Inhalt hier einfügen:</p>
      <textarea class="pb-dialog-code" spellcheck="false" placeholder='{ "format": "prio-board", … }'></textarea>
      <div class="pb-dialog-actions">
        <button class="btn" data-result="false">Abbrechen</button>
        <button class="btn primary" data-import>Importieren</button>
      </div>`, (d, finish) => {
      const textarea = d.querySelector('textarea');
      d.querySelector('input[type=file]').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) finish(await file.text());
      });
      d.querySelector('[data-import]').addEventListener('click', (e) => {
        e.preventDefault();
        if (textarea.value.trim()) finish(textarea.value);
        else textarea.focus();
      });
    });
  }

  return { confirm, alert, exportFile, importFile };
})();
