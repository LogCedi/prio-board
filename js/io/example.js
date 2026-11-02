/**
 * Beispiel-Board (nach der ursprünglichen Skizze). Startdaten fehlen bewusst:
 * alles beginnt „heute“, der Zeitplan schiebt entlang der Abhängigkeiten.
 * Gleicher Inhalt wie examples/beispiel.json (dort mit konkreten Daten).
 */
PB.example = {
  format: 'prio-board',
  version: 3,
  board: { title: 'IT-Priorisierung' },
  view: { zoom: 1 },
  themes: [
    { id: 'th-skalierung', title: 'Skalierung', color: '#7b5ea7' },
    { id: 'th-betrieb', title: 'Betrieb', color: '#e07a1f' },
  ],
  tasks: [
    {
      id: 't-quickwin-monitoring', kind: 'implementation', title: 'Quick Win: Monitoring-Alerts anpassen',
      description: 'Keine Abhängigkeit – sofort machbar', priority: 1, durationDays: 2, theme: 'th-betrieb',
    },
    {
      id: 't-ui-zielarchitektur', kind: 'thinking', title: 'UI-Zielarchitektur',
      description: 'Fundament: Zielbild der UI-Architektur – wird laufend weiterentwickelt',
      priority: 1, durationDays: 15, intensity: 'background', ongoing: true,
      iterations: [
        { title: 'Zielbild', durationDays: 10, intensity: 'focused', done: false },
        { title: 'Leitplanken', durationDays: 5, intensity: 'background', done: false },
      ],
    },
    {
      id: 't-lz', kind: 'thinking', title: 'LZ', description: 'Grundlage für den Skalierungsblock',
      priority: 2, durationDays: 10, bufferDays: 5,
    },
    {
      id: 't-denken-prozessdaten', kind: 'thinking', title: 'Denken Prozessdaten',
      priority: 2, intensity: 'background', theme: 'th-skalierung',
      iterations: [
        { title: 'Level 1', durationDays: 5, intensity: 'focused', done: false },
        { title: 'Level 2', durationDays: 5, intensity: 'medium', done: false },
        { title: 'Auswerten', durationDays: 5, intensity: 'background', done: false },
      ],
    },
    {
      id: 't-umsetzung-level1', kind: 'implementation', title: 'Umsetzung Prozess Level 1',
      priority: 2, durationDays: 5, theme: 'th-skalierung',
    },
    {
      id: 't-umsetzung-prozess', kind: 'implementation', title: 'Umsetzung Prozess komplett',
      priority: 3, durationDays: 10, bufferDays: 5, theme: 'th-skalierung',
    },
    {
      id: 't-denken-harness', kind: 'thinking', title: 'Denken Harness',
      description: 'Wie soll der Harness aufgebaut sein?', notes: ['Skills', 'Workflow', 'Sprache'],
      priority: 3, durationDays: 10, bufferDays: 5, theme: 'th-skalierung',
    },
    {
      id: 't-umsetzung-harness', kind: 'implementation', title: 'Umsetzung Harness',
      priority: 3, durationDays: 10, theme: 'th-skalierung',
    },
    {
      id: 't-logging', kind: 'implementation', title: 'Logging vereinheitlichen',
      priority: 1, durationDays: 5, theme: 'th-betrieb',
    },
  ],
  dependencies: [
    { id: 'd-ui-skalierung', from: 't-ui-zielarchitektur', fromIteration: 0, to: 'th-skalierung' },
    { id: 'd-lz-skalierung', from: 't-lz', to: 'th-skalierung' },
    { id: 'd-prozess-level1', from: 't-denken-prozessdaten', fromIteration: 0, to: 't-umsetzung-level1' },
    { id: 'd-prozess-komplett', from: 't-denken-prozessdaten', to: 't-umsetzung-prozess' },
    { id: 'd-harness', from: 't-denken-harness', to: 't-umsetzung-harness' },
    { id: 'd-quickwin-logging', from: 't-quickwin-monitoring', to: 't-logging' },
    { id: 'd-betrieb-skalierung', from: 'th-betrieb', to: 'th-skalierung' },
  ],
};
