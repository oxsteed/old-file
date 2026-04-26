import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import { toast } from 'sonner';
import AppointmentDetailModal from './AppointmentDetailModal';
import AvailabilityBlockModal from './AvailabilityBlockModal';
import '../../styles/HelperCalendarView.css';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAYS_OF_WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export default function HelperCalendarView({ viewMode, selectedDate, onDateChange }) {
  const { t } = useTranslation();
  const [appointments, setAppointments] = useState([]);
  const [availabilityBlocks, setAvailabilityBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [showAvailabilityModal, setShowAvailabilityModal] = useState(false);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState(null);

  useEffect(() => {
    loadCalendarData();
  }, [selectedDate, viewMode]);

  const loadCalendarData = async () => {
    try {
      setLoading(true);
      const dateRange = getDateRange(selectedDate, viewMode);

      const [apptsRes, availRes] = await Promise.all([
        api.get('/calendar/appointments', {
          params: {
            role: 'helper',
            from_date: dateRange.start.toISOString(),
            to_date: dateRange.end.toISOString(),
            limit: 100
          }
        }),
        api.get('/calendar/availability/mine', {
          params: {
            from_date: dateRange.start.toISOString(),
            to_date: dateRange.end.toISOString(),
            limit: 100
          }
        })
      ]);

      setAppointments(Array.isArray(apptsRes.data.appointments) ? apptsRes.data.appointments : []);
      setAvailabilityBlocks(Array.isArray(availRes.data.blocks) ? availRes.data.blocks : []);
    } catch (err) {
      toast.error(t('calendar.errorLoading'));
      setAppointments([]);
      setAvailabilityBlocks([]);
    } finally {
      setLoading(false);
    }
  };

  const getDateRange = (date, mode) => {
    const d = new Date(date);
    let start, end;

    if (mode === 'day') {
      start = new Date(d);
      start.setHours(0, 0, 0, 0);
      end = new Date(d);
      end.setHours(23, 59, 59, 999);
    } else if (mode === 'week') {
      const dayOfWeek = d.getDay();
      start = new Date(d);
      start.setDate(d.getDate() - dayOfWeek);
      start.setHours(0, 0, 0, 0);
      end = new Date(start);
      end.setDate(start.getDate() + 7);
      end.setHours(23, 59, 59, 999);
    } else {
      start = new Date(d.getFullYear(), d.getMonth(), 1);
      end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
    }

    return { start, end };
  };

  const handleBlockTimeClick = (date, hour) => {
    setSelectedTimeSlot({ date, hour });
    setShowAvailabilityModal(true);
  };

  const handleAvailabilityCreated = () => {
    setShowAvailabilityModal(false);
    setSelectedTimeSlot(null);
    loadCalendarData();
    toast.success(t('calendar.availabilityCreated'));
  };

  if (loading) {
    return <div className="hcv-loading">{t('common.loading')}</div>;
  }

  return (
    <div className="hcv-container">
      <div className="hcv-header">
        <button
          className="hcv-nav-btn"
          onClick={() => onDateChange(new Date(selectedDate.getTime() - 7 * 24 * 60 * 60 * 1000))}
        >
          ← {t('calendar.previous')}
        </button>
        <h2 className="hcv-date">
          {selectedDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </h2>
        <button
          className="hcv-nav-btn"
          onClick={() => onDateChange(new Date(selectedDate.getTime() + 7 * 24 * 60 * 60 * 1000))}
        >
          {t('calendar.next')} →
        </button>
      </div>

      {viewMode === 'week' && (
        <WeekView
          appointments={appointments}
          availabilityBlocks={availabilityBlocks}
          selectedDate={selectedDate}
          onBlockTime={handleBlockTimeClick}
          onSelectAppointment={setSelectedAppointment}
        />
      )}

      {viewMode === 'day' && (
        <DayView
          appointments={appointments}
          availabilityBlocks={availabilityBlocks}
          selectedDate={selectedDate}
          onBlockTime={handleBlockTimeClick}
          onSelectAppointment={setSelectedAppointment}
        />
      )}

      {viewMode === 'month' && (
        <MonthView
          selectedDate={selectedDate}
          appointments={appointments}
          onDateChange={onDateChange}
        />
      )}

      {selectedAppointment && (
        <AppointmentDetailModal
          appointment={selectedAppointment}
          onClose={() => setSelectedAppointment(null)}
          onUpdate={loadCalendarData}
        />
      )}

      {showAvailabilityModal && (
        <AvailabilityBlockModal
          initialDate={selectedTimeSlot?.date}
          initialHour={selectedTimeSlot?.hour}
          onClose={() => setShowAvailabilityModal(false)}
          onCreated={handleAvailabilityCreated}
        />
      )}
    </div>
  );
}

function WeekView({ appointments, availabilityBlocks, selectedDate, onBlockTime, onSelectAppointment }) {
  const { t } = useTranslation();
  const [weekStart, setWeekStart] = useState(getWeekStart(selectedDate));

  useEffect(() => {
    setWeekStart(getWeekStart(selectedDate));
  }, [selectedDate]);

  function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  return (
    <div className="hcv-week-view">
      <div className="hcv-week-header">
        <div className="hcv-time-label"></div>
        {days.map((day) => (
          <div key={day.toISOString()} className="hcv-day-header">
            <div className="hcv-day-name">
              {t(`calendar.dayShort.${DAYS_OF_WEEK[day.getDay()]}`)}
            </div>
            <div className="hcv-day-date">{day.getDate()}</div>
          </div>
        ))}
      </div>

      <div className="hcv-week-grid">
        <div className="hcv-times">
          {HOURS.map((hour) => (
            <div key={hour} className="hcv-time-slot">
              {String(hour).padStart(2, '0')}:00
            </div>
          ))}
        </div>

        {days.map((day) => (
          <div key={day.toISOString()} className="hcv-day-column">
            {HOURS.map((hour) => {
              const slotStart = new Date(day);
              slotStart.setHours(hour, 0, 0, 0);
              const slotEnd = new Date(slotStart);
              slotEnd.setHours(hour + 1, 0, 0, 0);

              const dayAppointments = appointments.filter((apt) => {
                if (!apt?.scheduled_start_time || !apt?.scheduled_end_time) return false;
                try {
                  const aptStart = new Date(apt.scheduled_start_time);
                  const aptEnd = new Date(apt.scheduled_end_time);
                  return !isNaN(aptStart) && !isNaN(aptEnd) && aptStart < slotEnd && aptEnd > slotStart;
                } catch {
                  return false;
                }
              });

              const dayBlocks = availabilityBlocks.filter((block) => {
                if (!block?.start_time || !block?.end_time) return false;
                try {
                  const blockStart = new Date(block.start_time);
                  const blockEnd = new Date(block.end_time);
                  return !isNaN(blockStart) && !isNaN(blockEnd) && blockStart < slotEnd && blockEnd > slotStart;
                } catch {
                  return false;
                }
              });

              return (
                <div
                  key={`${day.toISOString()}-${hour}`}
                  className="hcv-slot"
                  onClick={() => onBlockTime(day, hour)}
                >
                  {dayBlocks.map((block) => (
                    <div
                      key={block.id}
                      className={`hcv-block hcv-block-${block.type}`}
                      title={block.title || block.type}
                    >
                      {block.type}
                    </div>
                  ))}
                  {dayAppointments.map((apt) => (
                    <div
                      key={apt.id}
                      className={`hcv-appointment hcv-apt-${apt.status}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectAppointment(apt);
                      }}
                      title={apt.service_description}
                    >
                      {apt.customer_name}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function DayView({ appointments, availabilityBlocks, selectedDate, onBlockTime, onSelectAppointment }) {
  const { t } = useTranslation();

  return (
    <div className="hcv-day-view">
      <div className="hcv-day-title">
        {selectedDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
      </div>
      <div className="hcv-day-grid">
        <div className="hcv-times">
          {HOURS.map((hour) => (
            <div key={hour} className="hcv-time-slot">
              {String(hour).padStart(2, '0')}:00
            </div>
          ))}
        </div>
        <div className="hcv-day-events">
          {HOURS.map((hour) => {
            const slotStart = new Date(selectedDate);
            slotStart.setHours(hour, 0, 0, 0);
            const slotEnd = new Date(slotStart);
            slotEnd.setHours(hour + 1, 0, 0, 0);

            const hourAppointments = appointments.filter((apt) => {
              const aptStart = new Date(apt.scheduled_start_time);
              const aptEnd = new Date(apt.scheduled_end_time);
              return aptStart < slotEnd && aptEnd > slotStart;
            });

            const hourBlocks = availabilityBlocks.filter((block) => {
              const blockStart = new Date(block.start_time);
              const blockEnd = new Date(block.end_time);
              return blockStart < slotEnd && blockEnd > slotStart;
            });

            return (
              <div
                key={`slot-${hour}`}
                className="hcv-slot"
                onClick={() => onBlockTime(selectedDate, hour)}
              >
                {hourBlocks.map((block) => (
                  <div key={block.id} className={`hcv-block hcv-block-${block.type}`}>
                    {block.type}
                  </div>
                ))}
                {hourAppointments.map((apt) => (
                  <div
                    key={apt.id}
                    className={`hcv-appointment hcv-apt-${apt.status}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectAppointment(apt);
                    }}
                  >
                    {apt.customer_name} - {apt.service_description}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MonthView({ selectedDate, appointments, onDateChange }) {
  const { t } = useTranslation();
  const [month, setMonth] = useState(selectedDate.getMonth());
  const [year, setYear] = useState(selectedDate.getFullYear());

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const days = [];

  for (let i = 0; i < firstDay; i++) {
    days.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(new Date(year, month, i));
  }

  return (
    <div className="hcv-month-view">
      <div className="hcv-month-header">
        <button onClick={() => {
          if (month === 0) {
            setMonth(11);
            setYear(year - 1);
          } else {
            setMonth(month - 1);
          }
        }}>
          ← {t('calendar.previous')}
        </button>
        <h3>{new Date(year, month).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h3>
        <button onClick={() => {
          if (month === 11) {
            setMonth(0);
            setYear(year + 1);
          } else {
            setMonth(month + 1);
          }
        }}>
          {t('calendar.next')} →
        </button>
      </div>

      <div className="hcv-month-grid">
        {DAYS_OF_WEEK.map((day) => (
          <div key={day} className="hcv-month-day-name">
            {t(`calendar.dayShort.${day}`)}
          </div>
        ))}
        {days.map((day, idx) => (
          <div
            key={idx}
            className={`hcv-month-day ${day ? 'active' : 'empty'}`}
            onClick={() => day && onDateChange(day)}
          >
            {day && (
              <>
                <div className="hcv-month-day-number">{day.getDate()}</div>
                <div className="hcv-month-day-events">
                  {appointments
                    .filter((apt) => {
                      const aptDate = new Date(apt.scheduled_start_time);
                      return aptDate.toDateString() === day.toDateString();
                    })
                    .slice(0, 2)
                    .map((apt) => (
                      <div key={apt.id} className={`hcv-month-event hcv-apt-${apt.status || 'pending'}`}>
                        {(apt.customer_name || 'Unknown').split(' ')[0]}
                      </div>
                    ))}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
