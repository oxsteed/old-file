import React, { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  listRestaurantTables,
  createRestaurantTable,
  updateRestaurantTable,
  listRestaurantReservations,
  createRestaurantReservation,
  updateRestaurantReservation,
  listRestaurantWaitlist,
  createRestaurantWaitlistEntry,
  notifyRestaurantWaitlistEntry,
  updateRestaurantWaitlistEntry,
} from '../../api/food';
import { apiErrorMessage } from './foodShared';

function iso(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export default function RestaurantHostingPanel({ t, restaurant }) {
  const [data, setData] = useState({ tables: [], reservations: [], entries: [] });
  const [busy, setBusy] = useState(false);
  const [table, setTable] = useState({ name: '', capacity: 2, section: '' });
  const [reservation, setReservation] = useState({ guestName: '', guestPhone: '', partySize: 2, tableId: '', startsAt: '', endsAt: '' });
  const [waitlist, setWaitlist] = useState({ guestName: '', guestPhone: '', partySize: 2, quotedWaitMin: 20 });
  const floorPlanRef = useRef(null);
  const text = useCallback((key, fallback, vars) => t(`restaurants.ops.hosting.${key}`, { defaultValue: fallback, ...vars }), [t]);

  const load = useCallback(async () => {
    const [tables, reservations, wait] = await Promise.all([
      listRestaurantTables(restaurant.id),
      listRestaurantReservations(restaurant.id),
      listRestaurantWaitlist(restaurant.id),
    ]);
    setData({ tables: tables.tables || [], reservations: reservations.reservations || [], entries: wait.entries || [] });
  }, [restaurant.id]);
  useEffect(() => { load().catch((error) => toast.error(apiErrorMessage(error, text('loadError', 'Could not load host stand')))); }, [load, text]);

  const saveTable = async (event) => {
    event.preventDefault();
    setBusy(true);
    try { await createRestaurantTable(restaurant.id, table); setTable({ name: '', capacity: 2, section: '' }); await load(); }
    catch (error) { toast.error(apiErrorMessage(error, text('saveError', 'Could not save'))); }
    finally { setBusy(false); }
  };
  const saveReservation = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await createRestaurantReservation(restaurant.id, { ...reservation, tableId: reservation.tableId || undefined, startsAt: iso(reservation.startsAt), endsAt: iso(reservation.endsAt) });
      setReservation({ guestName: '', guestPhone: '', partySize: 2, tableId: '', startsAt: '', endsAt: '' }); await load();
    } catch (error) { toast.error(apiErrorMessage(error, text('saveError', 'Could not save'))); }
    finally { setBusy(false); }
  };
  const saveWaitlist = async (event) => {
    event.preventDefault();
    setBusy(true);
    try { await createRestaurantWaitlistEntry(restaurant.id, waitlist); setWaitlist({ guestName: '', guestPhone: '', partySize: 2, quotedWaitMin: 20 }); await load(); }
    catch (error) { toast.error(apiErrorMessage(error, text('saveError', 'Could not save'))); }
    finally { setBusy(false); }
  };

  const set = (setter, field) => (event) => setter((current) => ({ ...current, [field]: event.target.value }));
  const status = async (id, value) => { try { await updateRestaurantReservation(restaurant.id, id, { status: value }); await load(); } catch (error) { toast.error(apiErrorMessage(error, text('saveError', 'Could not save'))); } };
  const notify = async (entry) => { try { await notifyRestaurantWaitlistEntry(restaurant.id, entry.id); await load(); } catch (error) { toast.error(apiErrorMessage(error, text('smsError', 'Could not send SMS'))); } };
  const seat = async (entry) => { try { await updateRestaurantWaitlistEntry(restaurant.id, entry.id, { status: 'seated' }); await load(); } catch (error) { toast.error(apiErrorMessage(error, text('saveError', 'Could not save'))); } };
  const moveTable = async (event) => {
    event.preventDefault();
    const tableId = event.dataTransfer.getData('text/plain');
    const canvas = floorPlanRef.current;
    if (!tableId || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(4, Math.min(96, Math.round(((event.clientX - rect.left) / rect.width) * 100)));
    const y = Math.max(8, Math.min(92, Math.round(((event.clientY - rect.top) / rect.height) * 100)));
    setData((current) => ({
      ...current,
      tables: current.tables.map((item) => (String(item.id) === String(tableId) ? { ...item, position: { x, y } } : item)),
    }));
    try {
      await updateRestaurantTable(restaurant.id, tableId, { position: { x, y } });
    } catch (error) {
      toast.error(apiErrorMessage(error, text('saveError', 'Could not save')));
      await load();
    }
  };

  return (
    <div className="fd-section" data-testid="restaurant-hosting-panel">
      <h3>{text('title', 'Host stand')}</h3>
      <p className="fd-card-meta">{text('subtitle', 'Manage tables, reservations, and walk-ins for this restaurant.')}</p>
      <div className="fd-settings-grid">
        <section className="fd-settings-card">
          <h4>{text('tablesTitle', 'Tables')}</h4>
          <form onSubmit={saveTable} className="fd-form-stack" data-track="ui.96de179235.1">
            <input aria-label={text('tableName', 'Table name')} placeholder={text('tableName', 'Table name')} value={table.name} onChange={set(setTable, 'name')} required maxLength={120} />
            <input aria-label={text('capacity', 'Capacity')} type="number" min="1" max="1000" value={table.capacity} onChange={set(setTable, 'capacity')} required />
            <input aria-label={text('section', 'Section')} placeholder={text('section', 'Section')} value={table.section} onChange={set(setTable, 'section')} maxLength={120} />
            <button className="fd-btn fd-btn-primary" disabled={busy} data-track="ui.96de179235.2">{text('addTable', 'Add table')}</button>
          </form>
          <h5>{text('floorPlanTitle', 'Floor plan')}</h5>
          <p className="fd-card-meta">{text('floorPlanHint', 'Drag tables to arrange the store layout.')}</p>
          <div
            ref={floorPlanRef}
            role="application"
            aria-label={text('floorPlanTitle', 'Floor plan')}
            onDragOver={(event) => event.preventDefault()}
            onDrop={moveTable}
            style={{ position: 'relative', minHeight: 240, margin: '12px 0', border: '1px dashed var(--border-color, #cbd5e1)', borderRadius: 12, background: 'var(--color-surface-2, #f8fafc)', overflow: 'hidden' }}
          >
            {data.tables.filter((item) => item.status === 'active').map((item, index) => {
              const position = item.position && typeof item.position === 'object' ? item.position : {};
              const x = Number.isFinite(Number(position.x)) ? Number(position.x) : 16 + ((index % 4) * 22);
              const y = Number.isFinite(Number(position.y)) ? Number(position.y) : 24 + (Math.floor(index / 4) * 28);
              return (
                <button
                  key={`floor-${item.id}`}
                  type="button"
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData('text/plain', String(item.id))}
                  style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)', minWidth: 64, minHeight: 44, border: '1px solid var(--color-border, #cbd5e1)', borderRadius: 10, background: 'var(--color-surface, #fff)', color: 'inherit', cursor: 'grab', fontWeight: 700, padding: '6px 8px' }}
                  aria-label={`${item.name} (${item.capacity})`} data-track="ui.96de179235.3"
                >
                  {item.name}<small style={{ display: 'block', fontWeight: 500, opacity: 0.7 }}>{item.capacity}</small>
                </button>
              );
            })}
          </div>
          <ul>{data.tables.map((item) => <li key={item.id}>{item.name} · {item.capacity}</li>)}</ul>
        </section>

        <section className="fd-settings-card">
          <h4>{text('reservationsTitle', 'Reservations')}</h4>
          <form onSubmit={saveReservation} className="fd-form-stack" data-track="ui.96de179235.4">
            <input aria-label={text('guestName', 'Guest name')} placeholder={text('guestName', 'Guest name')} value={reservation.guestName} onChange={set(setReservation, 'guestName')} required />
            <input aria-label={text('phone', 'Phone')} placeholder={text('phone', 'Phone')} value={reservation.guestPhone} onChange={set(setReservation, 'guestPhone')} />
            <input aria-label={text('partySize', 'Party size')} type="number" min="1" max="1000" value={reservation.partySize} onChange={set(setReservation, 'partySize')} required />
            <select aria-label={text('table', 'Table')} value={reservation.tableId} onChange={set(setReservation, 'tableId')}><option value="">{text('anyTable', 'Any table')}</option>{data.tables.filter((item) => item.status === 'active').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
            <input aria-label={text('startsAt', 'Starts')} type="datetime-local" value={reservation.startsAt} onChange={set(setReservation, 'startsAt')} required />
            <input aria-label={text('endsAt', 'Ends')} type="datetime-local" value={reservation.endsAt} onChange={set(setReservation, 'endsAt')} required />
            <button className="fd-btn fd-btn-primary" disabled={busy} data-track="ui.96de179235.5">{text('addReservation', 'Add reservation')}</button>
          </form>
          <ul>{data.reservations.map((item) => <li key={item.id}>{item.guest_name} · {item.party_size} · {item.status} <select value={item.status} onChange={(event) => status(item.id, event.target.value)} aria-label={text('reservationStatus', 'Reservation status')}><option value="confirmed">{text('confirmed', 'Confirmed')}</option><option value="seated">{text('seated', 'Seated')}</option><option value="completed">{text('completed', 'Completed')}</option><option value="cancelled">{text('cancelled', 'Cancelled')}</option></select></li>)}</ul>
        </section>

        <section className="fd-settings-card">
          <h4>{text('waitlistTitle', 'Walk-in waitlist')}</h4>
          <form onSubmit={saveWaitlist} className="fd-form-stack" data-track="ui.96de179235.6">
            <input aria-label={text('guestName', 'Guest name')} placeholder={text('guestName', 'Guest name')} value={waitlist.guestName} onChange={set(setWaitlist, 'guestName')} required />
            <input aria-label={text('phone', 'Phone')} placeholder={text('phone', 'Phone')} value={waitlist.guestPhone} onChange={set(setWaitlist, 'guestPhone')} required />
            <input aria-label={text('partySize', 'Party size')} type="number" min="1" max="1000" value={waitlist.partySize} onChange={set(setWaitlist, 'partySize')} required />
            <input aria-label={text('quotedWait', 'Quoted wait')} type="number" min="0" value={waitlist.quotedWaitMin} onChange={set(setWaitlist, 'quotedWaitMin')} />
            <button className="fd-btn fd-btn-primary" disabled={busy} data-track="ui.96de179235.7">{text('addToWaitlist', 'Add to waitlist')}</button>
          </form>
          <ul>{data.entries.map((item) => <li key={item.id}>{item.guest_name} · {item.party_size} · {item.status} {item.status === 'waiting' && <><button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => notify(item)} data-track="ui.96de179235.8">{text('notify', 'Notify')}</button><button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => seat(item)} data-track="ui.96de179235.9">{text('seat', 'Seat')}</button></>}</li>)}</ul>
        </section>
      </div>
    </div>
  );
}
