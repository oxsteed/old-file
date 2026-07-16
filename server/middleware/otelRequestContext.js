const { SpanStatusCode, trace } = require('@opentelemetry/api');

const setSpanAttribute = (span, key, value) => {
  if (value !== undefined && value !== null && value !== '') {
    span.setAttribute(key, value);
  }
};

const getMatchedRoute = (req) => {
  if (!req.route || !req.route.path) return undefined;
  return `${req.baseUrl || ''}${req.route.path}`;
};

const otelRequestContext = (req, res, next) => {
  const span = trace.getActiveSpan();

  if (!span) {
    return next();
  }

  setSpanAttribute(span, 'oxsteed.request_id', req.correlationId || req.id || req.requestId);
  setSpanAttribute(span, 'http.request.method', req.method);
  setSpanAttribute(span, 'url.path', req.path);

  res.on('finish', () => {
    setSpanAttribute(span, 'http.response.status_code', res.statusCode);
    setSpanAttribute(span, 'http.route', getMatchedRoute(req));
    setSpanAttribute(span, 'enduser.id', req.user?.id ? String(req.user.id) : undefined);
    setSpanAttribute(span, 'oxsteed.user_role', req.user?.role);

    if (res.statusCode >= 500) {
      span.setStatus({ code: SpanStatusCode.ERROR });
    }
  });

  return next();
};

const setActiveSpanAttributes = (attributes = {}) => {
  const span = trace.getActiveSpan();
  if (!span) return;

  Object.entries(attributes).forEach(([key, value]) => {
    setSpanAttribute(span, key, value);
  });
};

const addActiveSpanEvent = (name, attributes = {}) => {
  const span = trace.getActiveSpan();
  if (span && name) {
    span.addEvent(name, attributes);
  }
};

module.exports = {
  addActiveSpanEvent,
  otelRequestContext,
  setActiveSpanAttributes,
};
