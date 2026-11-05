// Shared bits for the Phase 3 Track B employee portal panels (My tips,
// My pay). Periods are local calendar dates (YYYY-MM-DD): the current
// period is the last 30 local days including today, matching the
// server's default report range; recent periods come from the
// employee's finalized pay runs, so a worker can look back at a period
// they were actually paid for.

export function todayIso() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function shiftDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function currentPeriodRange() {
  const to = todayIso();
  return { from: shiftDays(to, -29), to };
}

// Period select options: the current period first, then one option per
// finalized pay stub (most recent first). A stub period reuses the
// run's own period, so the numbers shown are the numbers that were paid.
export function periodOptionsFromStubs(stubs) {
  const current = currentPeriodRange();
  const options = [{ key: 'current', from: current.from, to: current.to }];
  for (const stub of stubs || []) {
    options.push({
      key: `stub-${stub.pay_run_id}`,
      from: stub.period_from,
      to: stub.period_to,
      payRunId: stub.pay_run_id,
    });
  }
  return options;
}

export function periodRangeForKey(options, key) {
  const found = (options || []).find((option) => option.key === key);
  if (found) return { from: found.from, to: found.to };
  const current = currentPeriodRange();
  return { from: current.from, to: current.to };
}

// A YYYY-MM-DD date formatted in the viewer's locale, parsed at local
// noon so the viewer's timezone can never shift it a day either way.
export function formatPortalDay(value, locale) {
  if (!value) return '';
  const text = String(value).slice(0, 10);
  const d = new Date(`${text}T12:00:00`);
  if (Number.isNaN(d.getTime())) return text;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d);
}

// One label/value row in a portal summary. Logical properties only, so
// the Arabic RTL layout mirrors automatically.
export function EpRow({ label, value, strong = false }) {
  return (
    <div className={`ep-row${strong ? ' ep-row-strong' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
