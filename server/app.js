const adminRoutes = require('./routes/admin');
app.use('/api/admin', adminRoutes);

const notificationRoutes = require('./routes/notifications');
const reviewRoutes       = require('./routes/reviews');
const disputeRoutes      = require('./routes/disputes');
const consentRoutes     = require('./routes/consent');

app.use('/api/notifications', notificationRoutes);
app.use('/api/reviews',       reviewRoutes);
app.use('/api/disputes',      disputeRoutes);
app.use('/api/consent',      consentRoutes);

