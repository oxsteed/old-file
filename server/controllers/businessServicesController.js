// Business services controller
// Manage services, staff assignments, and availability scheduling

const pool = require('../db');
const { AppError } = require('../utils/apiError');
const logger = require('../utils/logger');

// Get all services for a business
async function listServices(req, res, next) {
  try {
    const { businessId } = req.params;
    const { include_inactive = false } = req.query;

    const query = `
      SELECT
        bs.id, bs.business_id, bs.name, bs.description, bs.category,
        bs.duration_minutes, bs.preparation_minutes, bs.base_price_cents,
        bs.max_capacity, bs.min_notice_hours, bs.cancellation_policy_hours,
        bs.is_active, bs.created_at,
        (SELECT COUNT(*) FROM business_service_staff WHERE service_id = bs.id) as staff_count,
        (SELECT json_agg(json_build_object('id', bss.staff_id, 'name', (SELECT display_name FROM users WHERE id = bss.staff_id)))
         FROM business_service_staff bss WHERE bss.service_id = bs.id LIMIT 5) as staff
      FROM business_services bs
      WHERE bs.business_id = $1 AND (bs.is_active = true OR $2 = true)
      ORDER BY bs.created_at DESC
    `;

    const result = await pool.query(query, [businessId, include_inactive === 'true']);
    res.json(result.rows);
  } catch (error) {
    logger.error('Error listing services', { error, businessId: req.params.businessId });
    next(new AppError('Failed to list services', 500));
  }
}

// Create new service
async function createService(req, res, next) {
  try {
    const { businessId } = req.params;
    const {
      name, description, category, duration_minutes, preparation_minutes,
      base_price_cents, max_capacity = 1, min_notice_hours = 24,
      cancellation_policy_hours = 24, cancellation_fee_percent = 0
    } = req.body;

    // Validate required fields
    if (!name || !duration_minutes || base_price_cents === undefined) {
      return next(new AppError('Name, duration, and price are required', 400));
    }

    if (duration_minutes < 15) {
      return next(new AppError('Service duration must be at least 15 minutes', 400));
    }

    if (base_price_cents < 0) {
      return next(new AppError('Price cannot be negative', 400));
    }

    const result = await pool.query(
      `INSERT INTO business_services
       (business_id, name, description, category, duration_minutes, preparation_minutes,
        base_price_cents, max_capacity, min_notice_hours, cancellation_policy_hours,
        cancellation_fee_percent, created_by_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [businessId, name, description, category, duration_minutes, preparation_minutes,
       base_price_cents, max_capacity, min_notice_hours, cancellation_policy_hours,
       cancellation_fee_percent, req.user.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Error creating service', { error, businessId: req.params.businessId });
    next(new AppError('Failed to create service', 500));
  }
}

// Update service
async function updateService(req, res, next) {
  try {
    const { businessId, serviceId } = req.params;
    const updates = req.body;

    // Whitelist updatable fields
    const allowedFields = [
      'name', 'description', 'category', 'duration_minutes', 'preparation_minutes',
      'base_price_cents', 'max_capacity', 'min_notice_hours', 'cancellation_policy_hours',
      'cancellation_fee_percent', 'is_active'
    ];

    const setClause = [];
    const values = [];
    let paramCount = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key) && value !== undefined) {
        setClause.push(`${key} = $${paramCount}`);
        values.push(value);
        paramCount++;
      }
    }

    if (setClause.length === 0) {
      return next(new AppError('No valid fields to update', 400));
    }

    values.push(serviceId, businessId);
    const query = `
      UPDATE business_services
      SET ${setClause.join(', ')}, updated_at = NOW()
      WHERE id = $${paramCount} AND business_id = $${paramCount + 1}
      RETURNING *
    `;

    const result = await pool.query(query, values);

    if (!result.rows.length) {
      return next(new AppError('Service not found', 404));
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error updating service', { error, serviceId: req.params.serviceId });
    next(new AppError('Failed to update service', 500));
  }
}

// Assign staff to service
async function assignStaffToService(req, res, next) {
  try {
    const { businessId, serviceId } = req.params;
    const { staff_id, service_price_override_cents } = req.body;

    if (!staff_id) {
      return next(new AppError('Staff ID is required', 400));
    }

    const result = await pool.query(
      `INSERT INTO business_service_staff
       (service_id, staff_id, service_price_override_cents)
       VALUES ($1, $2, $3)
       ON CONFLICT (service_id, staff_id) DO UPDATE
       SET service_price_override_cents = EXCLUDED.service_price_override_cents
       RETURNING *`,
      [serviceId, staff_id, service_price_override_cents || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Error assigning staff', { error });
    next(new AppError('Failed to assign staff', 500));
  }
}

// Set service availability (weekly schedule)
async function setServiceAvailability(req, res, next) {
  try {
    const { businessId, serviceId } = req.params;
    const { staff_id, availability } = req.body; // availability = [{day_of_week: 0, start_time: "09:00", end_time: "17:00"}]

    if (!Array.isArray(availability)) {
      return next(new AppError('Availability must be an array', 400));
    }

    // Delete existing availability for this service/staff
    const deleteQuery = staff_id
      ? 'DELETE FROM business_service_availability WHERE service_id = $1 AND staff_id = $2'
      : 'DELETE FROM business_service_availability WHERE service_id = $1 AND staff_id IS NULL';

    const deleteParams = staff_id ? [serviceId, staff_id] : [serviceId];
    await pool.query(deleteQuery, deleteParams);

    // Insert new availability
    for (const slot of availability) {
      if (!slot.day_of_week || !slot.start_time || !slot.end_time) {
        return next(new AppError('Each availability slot must have day_of_week, start_time, and end_time', 400));
      }

      await pool.query(
        `INSERT INTO business_service_availability
         (service_id, staff_id, day_of_week, start_time, end_time, is_available)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [serviceId, staff_id || null, slot.day_of_week, slot.start_time, slot.end_time]
      );
    }

    res.json({ message: 'Availability updated successfully' });
  } catch (error) {
    logger.error('Error setting availability', { error });
    next(new AppError('Failed to set availability', 500));
  }
}

// Get available time slots
async function getAvailableSlots(req, res, next) {
  try {
    const { businessId, serviceId } = req.params;
    const { date, staff_id } = req.query;

    if (!date) {
      return next(new AppError('Date is required (YYYY-MM-DD)', 400));
    }

    // Get service details
    const serviceResult = await pool.query(
      'SELECT * FROM business_services WHERE id = $1 AND business_id = $2',
      [serviceId, businessId]
    );

    if (!serviceResult.rows.length) {
      return next(new AppError('Service not found', 404));
    }

    const service = serviceResult.rows[0];
    const slotDuration = service.duration_minutes;

    // Get the day of week from the date
    const dateObj = new Date(date);
    const dayOfWeek = dateObj.getUTCDay();

    // Get availability for this day
    let availQuery = `
      SELECT start_time, end_time FROM business_service_availability
      WHERE service_id = $1 AND day_of_week = $2
    `;
    const availParams = [serviceId, dayOfWeek];

    if (staff_id) {
      availQuery += ` AND staff_id = $${availParams.length + 1}`;
      availParams.push(staff_id);
    }

    const availResult = await pool.query(availQuery, availParams);

    if (!availResult.rows.length) {
      return res.json({ available_slots: [] });
    }

    // Get existing appointments for this service on this date
    const appointmentsResult = await pool.query(
      `SELECT start_time, end_time FROM business_appointments
       WHERE service_id = $1 AND DATE(start_time AT TIME ZONE 'UTC') = $2 AND status != 'cancelled'`,
      [serviceId, date]
    );

    const bookedTimes = appointmentsResult.rows.map(apt => ({
      start: apt.start_time,
      end: apt.end_time
    }));

    // Generate available slots
    const slots = [];
    for (const avail of availResult.rows) {
      const [startHour, startMin] = avail.start_time.split(':').map(Number);
      const [endHour, endMin] = avail.end_time.split(':').map(Number);

      let currentMinutes = startHour * 60 + startMin;
      const endMinutes = endHour * 60 + endMin;

      while (currentMinutes + slotDuration <= endMinutes) {
        const slotStart = `${String(Math.floor(currentMinutes / 60)).padStart(2, '0')}:${String(currentMinutes % 60).padStart(2, '0')}`;
        const slotEnd = `${String(Math.floor((currentMinutes + slotDuration) / 60)).padStart(2, '0')}:${String((currentMinutes + slotDuration) % 60).padStart(2, '0')}`;

        // Check if slot conflicts with existing appointments
        const isBooked = bookedTimes.some(booked => {
          const bookedStart = booked.start.split(':').map(Number);
          const bookedEnd = booked.end.split(':').map(Number);
          const bookedStartMin = bookedStart[0] * 60 + bookedStart[1];
          const bookedEndMin = bookedEnd[0] * 60 + bookedEnd[1];

          return (currentMinutes < bookedEndMin) && (currentMinutes + slotDuration > bookedStartMin);
        });

        if (!isBooked) {
          slots.push({
            start_time: slotStart,
            end_time: slotEnd,
            price_cents: service.base_price_cents
          });
        }

        currentMinutes += 30; // 30-minute intervals
      }
    }

    res.json({ available_slots: slots });
  } catch (error) {
    logger.error('Error getting available slots', { error });
    next(new AppError('Failed to get available slots', 500));
  }
}

module.exports = {
  listServices,
  createService,
  updateService,
  assignStaffToService,
  setServiceAvailability,
  getAvailableSlots
};
