import * as Calendar from "expo-calendar";
import type { MobileAppointment, MobileBooking } from "../api/types";

function bookingValue(booking: MobileBooking, camel: keyof MobileBooking, snake: keyof MobileBooking) {
  return booking[camel] || booking[snake];
}

async function writableCalendarId() {
  const permission = await Calendar.requestCalendarPermissionsAsync();
  if (!permission.granted) {
    throw new Error("Calendar permission is needed to add this booking.");
  }

  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const writable = calendars.find((calendar) => calendar.allowsModifications) || calendars[0];
  if (writable) return writable.id;

  const defaultCalendar = await Calendar.getDefaultCalendarAsync();
  return Calendar.createCalendarAsync({
    title: "OxSteed",
    color: "#f97316",
    entityType: Calendar.EntityTypes.EVENT,
    sourceId: defaultCalendar?.source?.id,
    source: defaultCalendar?.source,
    name: "OxSteed",
    ownerAccount: "OxSteed",
    accessLevel: Calendar.CalendarAccessLevel.OWNER
  });
}

export async function addBookingToDeviceCalendar(booking: MobileBooking) {
  const date = bookingValue(booking, "requestedDate", "requested_date");
  const startTime = bookingValue(booking, "requestedStartTime", "requested_start_time");
  const endTime = bookingValue(booking, "requestedEndTime", "requested_end_time");
  if (!date || !startTime || !endTime) {
    throw new Error("Booking date and time are required before adding to calendar.");
  }

  const calendarId = await writableCalendarId();
  return Calendar.createEventAsync(calendarId, {
    title: `OxSteed: ${bookingValue(booking, "serviceName", "service_name") || "Booking"}`,
    startDate: new Date(`${date}T${startTime}`),
    endDate: new Date(`${date}T${endTime}`),
    location: String(bookingValue(booking, "serviceLocation", "service_location") || ""),
    notes: "Created from the OxSteed mobile app."
  });
}

export async function addAppointmentToDeviceCalendar(appointment: MobileAppointment) {
  if (!appointment.scheduled_start_time || !appointment.scheduled_end_time) {
    throw new Error("Appointment time is required before adding to calendar.");
  }

  const calendarId = await writableCalendarId();
  return Calendar.createEventAsync(calendarId, {
    title: `OxSteed: ${appointment.job_title || appointment.title || appointment.service_description || "Appointment"}`,
    startDate: new Date(appointment.scheduled_start_time),
    endDate: new Date(appointment.scheduled_end_time),
    notes: "Created from the OxSteed mobile app."
  });
}
