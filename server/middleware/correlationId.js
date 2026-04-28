const { v4: uuidv4 } = require('uuid');

// Middleware to assign a unique correlation ID to each request for tracing
// and logging purposes across all services and database operations.
//
// The correlation ID enables:
// - Full request tracing through logs
// - Linking database audit logs to API requests
// - Debugging distributed issues
//
// The ID is stored in req.correlationId and included in all logs via
// the logger middleware.
module.exports = (req, res, next) => {
  req.correlationId = req.headers['x-correlation-id'] || uuidv4();

  res.setHeader('x-correlation-id', req.correlationId);

  next();
};
