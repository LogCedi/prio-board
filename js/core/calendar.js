/**
 * Arbeitstag-Kalender. Interne Zeiteinheit ist der Arbeitstag ab heute:
 *   Tag 0 = heute (am Wochenende: nächster Montag), Tag 5 = eine Woche später.
 * Wochenenden werden übersprungen. Daten vor heute werden auf heute gesetzt.
 */
PB.calendar = (() => {
  const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;

  function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function nextBusinessDay(date) {
    const d = startOfDay(date);
    while (isWeekend(d)) d.setDate(d.getDate() + 1);
    return d;
  }

  /** Tag 0 – einmal beim Laden festgelegt, damit sich während der Sitzung nichts verschiebt. */
  const origin = nextBusinessDay(new Date());

  /** Arbeitstag-Index → Datum */
  function dateOf(day) {
    const d = new Date(origin);
    let left = Math.max(0, Math.round(day));
    while (left > 0) {
      d.setDate(d.getDate() + 1);
      if (!isWeekend(d)) left--;
    }
    return d;
  }

  /** "YYYY-MM-DD" → Arbeitstag-Index (Vergangenheit → 0, ungültig → null). */
  function dayOf(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!match) return null;
    const target = nextBusinessDay(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (Number.isNaN(target.getTime())) return null;
    if (target <= origin) return 0;
    let day = 0;
    const d = new Date(origin);
    while (d < target) {
      d.setDate(d.getDate() + 1);
      if (!isWeekend(d)) day++;
    }
    return day;
  }

  const pad = (n) => String(n).padStart(2, '0');
  const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const isoOf = (day) => isoDate(dateOf(day));

  /** ISO-Kalenderwoche */
  function weekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const weekday = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - weekday);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  }

  const shortDate = (date) => `${date.getDate()}.${date.getMonth() + 1}.`;
  const longDate = (date) => `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;

  /** Wochenanfänge (Montage) im Bereich [0, totalDays) – Tag 0 immer dabei. */
  function weeks(totalDays) {
    const result = [];
    for (let day = 0; day < totalDays; day++) {
      const date = dateOf(day);
      if (day === 0 || date.getDay() === 1) result.push({ day, date, week: weekNumber(date) });
    }
    return result;
  }

  /** 12 → "2 Wo 2 T" */
  function durationLabel(days) {
    const n = Math.max(0, Math.round(days));
    const w = Math.floor(n / 5);
    const d = n % 5;
    if (!w) return `${d} T`;
    return d ? `${w} Wo ${d} T` : `${w} Wo`;
  }

  return { origin, dateOf, dayOf, isoOf, weekNumber, shortDate, longDate, weeks, durationLabel };
})();
