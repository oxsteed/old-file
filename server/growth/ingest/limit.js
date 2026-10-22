"use strict";
const { key } = require("../identity");
async function permit(req) {
  if (!req.user?.id) return false;
  const redis = await require("../queue").ready();
  const keys = [
    `activity:limit:user:${key("subject", req.user.id)}`,
    `activity:limit:ip:${key("ip", req.ip || "unknown")}`,
  ];
  const result = await redis.eval(
    `local ok=1;for _,k in ipairs(KEYS) do
    local n=redis.call('INCR',k);if n==1 then redis.call('EXPIRE',k,60) end;
    if n>120 then ok=0 end;end;return ok;`,
    2,
    ...keys,
  );
  return result === 1;
}
module.exports = { permit };
