'use strict';
const service = require('../services/helperPortfolioService');
module.exports = async function image(req, res, next) {
  try {
    const stream = await service.image(req.params.requestId, req.user?.id, req.params.jobId);
    res.set({'Cache-Control':'no-store','Content-Type':'image/jpeg','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"});
    stream.on('error', error => { if (!res.headersSent) next(error); else res.destroy(); });
    stream.pipe(res);
  } catch (error) { next(error); }
};
