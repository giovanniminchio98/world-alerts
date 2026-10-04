// Emergency telephone numbers per country (bundled; works offline once cached).
let loading = null;

export function loadEmergencyNumbers() {
  if (!loading) {
    loading = fetch(new URL('geo/emergency-numbers.json', document.baseURI))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .catch((e) => {
        loading = null;
        throw e;
      });
  }
  return loading;
}

// Keep only digits and + * # for tel: links ("772-03-73" → "7720373").
export const telHref = (n) => `tel:${String(n).replace(/[^\d+*#]/g, '')}`;

/**
 * Turn one country's entry into display rows, merging duplicates:
 * e.g. US {911,911,911,main 911} → [{label:'Police, fire & ambulance', number:'911'}].
 */
export function emergencyRows(entry) {
  if (!entry) return [];
  const byNumber = new Map();
  for (const [label, n] of [['Police', entry.police], ['Ambulance', entry.ambulance], ['Fire', entry.fire]]) {
    if (!n) continue;
    if (!byNumber.has(n)) byNumber.set(n, []);
    byNumber.get(n).push(label.toLowerCase());
  }
  const rows = [];
  if (entry.main && !byNumber.has(entry.main)) rows.push({ label: 'Emergency', number: entry.main, note: entry.mainNote });
  for (const [number, labels] of byNumber) {
    const label = labels.length === 3 ? 'Police, fire & ambulance' : labels.map((l, i) => (i ? l : l[0].toUpperCase() + l.slice(1))).join(' & ');
    rows.push({ label, number, note: number === entry.main ? entry.mainNote : null });
  }
  return rows;
}
