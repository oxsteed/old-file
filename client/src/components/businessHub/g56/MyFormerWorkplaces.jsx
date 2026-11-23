// Groups 5-6 item 244: former team members' read-only view of their own
// hours and completed visits at businesses they left.
import { useBizG56 } from './useBizG56';
import './g56.css';

export default function MyFormerWorkplaces() {
  const p = useBizG56('/me/former-workplaces', 'former');
  if (!p.data?.workplaces?.length) return null;
  return (
    <section className="g56-panel">
      <h3>{p.tr('title')}</h3>
      <p>{p.tr('help')}</p>
      {p.data.workplaces.map(w => (
        <details key={w.business_id}>
          <summary>{w.business_name} · {p.tr('accessUntil')} {p.time(w.access_until)}</summary>
          <p>{p.tr('summary', { hours: Math.round(w.total_hours * 10) / 10, visits: w.completed_visits })}</p>
          <table className="g56-table">
            <thead><tr><th scope="col">{p.tr('date')}</th><th scope="col">{p.tr('hours')}</th><th scope="col">{p.tr('approved')}</th></tr></thead>
            <tbody>{w.time_entries.map((e, i) => <tr key={`${e.entry_date}-${i}`}><td>{String(e.entry_date).slice(0, 10)}</td><td>{e.hours_worked}</td><td>{e.approved ? '✓' : ''}</td></tr>)}</tbody>
          </table>
        </details>
      ))}
    </section>
  );
}
