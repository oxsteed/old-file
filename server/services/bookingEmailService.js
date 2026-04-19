const emailService = require('./emailService');
const logger = require('../utils/logger');

const sendBookingConfirmation = async (booking, tool, customer, owner) => {
  try {
    const startDate = new Date(booking.start_date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const endDate = new Date(booking.end_date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    // Email to customer
    await emailService.send({
      to: customer.email,
      subject: `Booking Confirmation - ${tool.name}`,
      html: `
        <h2>Booking Confirmation</h2>
        <p>Hi ${customer.first_name},</p>
        <p>Your booking for <strong>${tool.name}</strong> has been submitted and is pending owner approval.</p>

        <h3>Booking Details:</h3>
        <ul>
          <li><strong>Tool:</strong> ${tool.name}</li>
          <li><strong>From:</strong> ${startDate}</li>
          <li><strong>To:</strong> ${endDate}</li>
          <li><strong>Total Price:</strong> $${booking.total_price.toFixed(2)}</li>
        </ul>

        <p>You can view this booking in your <a href="${process.env.CLIENT_URL}/my-bookings">My Bookings</a> page.</p>
        <p>We'll notify you once the owner approves or declines your booking.</p>

        <p>Best regards,<br>OxSteed Team</p>
      `,
    });

    // Email to owner
    await emailService.send({
      to: owner.email,
      subject: `New Booking Request - ${tool.name}`,
      html: `
        <h2>New Booking Request</h2>
        <p>Hi ${owner.first_name},</p>
        <p><strong>${customer.first_name} ${customer.last_name}</strong> has requested to book your <strong>${tool.name}</strong>.</p>

        <h3>Booking Details:</h3>
        <ul>
          <li><strong>Tool:</strong> ${tool.name}</li>
          <li><strong>Renter:</strong> ${customer.first_name} ${customer.last_name}</li>
          <li><strong>From:</strong> ${startDate}</li>
          <li><strong>To:</strong> ${endDate}</li>
          <li><strong>Total Price:</strong> $${booking.total_price.toFixed(2)}</li>
        </ul>

        <p>Please review and approve or decline this booking in your <a href="${process.env.CLIENT_URL}/my-bookings">My Bookings</a> page.</p>

        <p>Best regards,<br>OxSteed Team</p>
      `,
    });

    logger.info('Booking confirmation emails sent', {
      bookingId: booking.id,
      toolId: tool.id,
    });
  } catch (err) {
    logger.error('Failed to send booking confirmation emails', { err });
  }
};

const sendBookingApproved = async (booking, tool, customer) => {
  try {
    const startDate = new Date(booking.start_date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const endDate = new Date(booking.end_date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    await emailService.send({
      to: customer.email,
      subject: `Booking Approved - ${tool.name}`,
      html: `
        <h2>Booking Approved!</h2>
        <p>Hi ${customer.first_name},</p>
        <p>Great news! Your booking for <strong>${tool.name}</strong> has been approved.</p>

        <h3>Booking Details:</h3>
        <ul>
          <li><strong>Tool:</strong> ${tool.name}</li>
          <li><strong>From:</strong> ${startDate}</li>
          <li><strong>To:</strong> ${endDate}</li>
          <li><strong>Total Price:</strong> $${booking.total_price.toFixed(2)}</li>
        </ul>

        <p>Proceed to payment in your <a href="${process.env.CLIENT_URL}/my-bookings">My Bookings</a> page to complete your rental.</p>

        <p>Best regards,<br>OxSteed Team</p>
      `,
    });

    logger.info('Booking approved email sent', { bookingId: booking.id });
  } catch (err) {
    logger.error('Failed to send booking approved email', { err });
  }
};

const sendBookingDeclined = async (booking, tool, customer) => {
  try {
    await emailService.send({
      to: customer.email,
      subject: `Booking Declined - ${tool.name}`,
      html: `
        <h2>Booking Declined</h2>
        <p>Hi ${customer.first_name},</p>
        <p>Unfortunately, your booking request for <strong>${tool.name}</strong> has been declined.</p>

        <p>The owner may have had a scheduling conflict or other reason. You can browse other available tools on <a href="${process.env.CLIENT_URL}/tool-rentals">our marketplace</a>.</p>

        <p>Best regards,<br>OxSteed Team</p>
      `,
    });

    logger.info('Booking declined email sent', { bookingId: booking.id });
  } catch (err) {
    logger.error('Failed to send booking declined email', { err });
  }
};

module.exports = {
  sendBookingConfirmation,
  sendBookingApproved,
  sendBookingDeclined,
};
