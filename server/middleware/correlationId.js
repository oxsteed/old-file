const { uuidv4 } = require('../utils/uuid');

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
  const incoming = String(req.headers['x-correlation-id'] || '').trim();
  // Accept only short, header-safe IDs so callers cannot inject log lines or
  // cause an invalid value to be reflected in the response header.
  req.correlationId = /^[A-Za-z0-9._:-]{1,128}$/.test(incoming) ? incoming : uuidv4();

  res.setHeader('x-correlation-id', req.correlationId);

  next();
};
