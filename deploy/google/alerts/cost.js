// Rows must describe eight consecutive complete Moscow days, oldest first.
export function compareCosts(rows) {
  if (!Array.isArray(rows) || rows.length !== 8) return { status: 'insufficient_data' };
  const currency = rows[0]?.currency;
  if (!currency || rows.some(row => !row.hasData || row.currency !== currency || !Number.isFinite(row.cost))) {
    return { status: 'insufficient_data' };
  }
  for (let index = 1; index < rows.length; index++) {
    const previous = Date.parse(`${rows[index - 1].date}T00:00:00Z`);
    const current = Date.parse(`${rows[index].date}T00:00:00Z`);
    if (!Number.isFinite(previous) || current - previous !== 86400000) return { status: 'insufficient_data' };
  }
  const previous = rows.slice(0, 7).reduce((sum, row) => sum + row.cost, 0) / 7;
  const current = rows[7].cost;
  // Ignore microscopic floating point residuals from credit calculations.
  const baseline = Math.max(0, previous);
  const actual = Math.max(0, current);
  const increased = baseline < 0.000001 ? actual > 0.000001 : actual > baseline * 1.2 + 0.000001;
  return { status: increased ? 'increase' : 'normal', date: rows[7].date, currency, actual, baseline,
    percent: baseline < 0.000001 ? null : (actual / baseline - 1) * 100 };
}

export function formatCostAlert(result) {
  const amount = n => n.toFixed(4);
  const percent = result.percent === null ? 'рост с нуля' : `+${result.percent.toFixed(1)}%`;
  return `⚠️ Расходы Google Cloud выросли: ${percent}\nДень: ${result.date} МСК\nЗа день: ${amount(result.actual)} ${result.currency}\nСреднее за предыдущие 7 дней: ${amount(result.baseline)} ${result.currency}\nДанные могут уточняться Google с задержкой.`;
}
