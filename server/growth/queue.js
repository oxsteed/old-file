"use strict";
let connection;
const STREAM = "activity:ingest";
const MAXLEN = 20000000;
function redis() {
  if (connection) return connection;
  const url = process.env.GROWTH_REDIS_URL;
  if (!url) throw new Error("growth_queue_not_configured");
  connection = new (require("ioredis"))(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  connection.on("error", () => {});
  return connection;
}
async function ready() {
  const conn = redis();
  if (conn.status === "wait") await conn.connect();
  if (conn.status !== "ready") throw new Error("growth_queue_unavailable");
  return conn;
}
// Never trim unacknowledged domain records. Admission control supplies the cap.
async function enqueue(envelopes, { domain = false } = {}) {
  const conn = await ready();
  let accepted = 0,
    dropped = 0;
  for (const row of envelopes) {
    const result = await conn.eval(
      `local n=redis.call('XLEN',KEYS[1]);
      if n>=tonumber(ARGV[1]) then return 0 end;
      if ARGV[3]=='0' and n>=tonumber(ARGV[1])*0.8 and string.sub(ARGV[4],1,3)=='ui.' then return 0 end;
      local id=redis.call('XADD',KEYS[1],'*','payload',ARGV[2]);
      redis.call('SADD',KEYS[2],id);return id;`,
      2,
      STREAM,
      `activity:subject:${require("./identity").key("subject", row.userId)}`,
      MAXLEN,
      JSON.stringify(row),
      domain ? "1" : "0",
      row.event.name,
    );
    if (result) accepted++;
    else {
      dropped++;
      if (domain) throw new Error("growth_queue_full");
    }
  }
  return { accepted, dropped };
}
async function close() {
  if (connection) {
    const c = connection;
    connection = null;
    await c.quit().catch(() => c.disconnect());
  }
}
async function eraseSubject(subject) {
  if (!process.env.GROWTH_REDIS_URL) return;
  const conn = await ready(),
    index = `activity:subject:${subject}`;
  let cursor = "0";
  do {
    const result = await conn.sscan(index, cursor, "COUNT", 1000);
    cursor = result[0];
    const ids = result[1];
    if (ids.length) {
      await conn.xdel(STREAM, ...ids);
      await conn.srem(index, ...ids);
    }
  } while (cursor !== "0");
}
module.exports = { redis, ready, enqueue, close, STREAM, MAXLEN, eraseSubject };
