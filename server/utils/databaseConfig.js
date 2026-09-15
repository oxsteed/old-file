'use strict';

const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);

function parseDatabaseUrl(databaseUrl) {
  const value = String(databaseUrl || '').trim();
  if (!value) throw new Error('DATABASE_URL is empty');

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }

  if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) {
    throw new Error('DATABASE_URL must use the postgres or postgresql scheme');
  }
  if (!parsed.hostname) throw new Error('DATABASE_URL must include a database host');
  if (!parsed.username) throw new Error('DATABASE_URL must include a database user');
  return parsed;
}

function getDatabaseSslConfig(databaseUrl = process.env.DATABASE_URL, nodeEnv = process.env.NODE_ENV) {
  const value = String(databaseUrl || '');
  const sslMode = (() => {
    try {
      return new URL(value).searchParams.get('sslmode');
    } catch {
      return null;
    }
  })();

  if (sslMode === 'disable') return false;
  if (nodeEnv === 'production' || ['require', 'verify-ca', 'verify-full'].includes(sslMode)) {
    return { rejectUnauthorized: false };
  }
  return false;
}

function describeDatabaseTarget(databaseUrl) {
  try {
    const parsed = parseDatabaseUrl(databaseUrl);
    return {
      host: parsed.hostname,
      port: parsed.port || '5432',
      database: decodeURIComponent(parsed.pathname.replace(/^\//, '')) || '(default)',
      user: decodeURIComponent(parsed.username),
    };
  } catch {
    return { host: '(unparseable)', port: '(unknown)', database: '(unknown)', user: '(unknown)' };
  }
}

function classifyDatabaseError(error) {
  const code = error?.code || null;
  const message = String(error?.message || '');
  if (code === '28P01' || /password authentication failed/i.test(message)) {
    return {
      category: 'authentication',
      hint: 'PostgreSQL rejected the password. In Coolify, make DATABASE_URL use the same user and password configured on the PostgreSQL service, URL-encoding special password characters.',
    };
  }
  if (code === '3D000' || /database .* does not exist/i.test(message)) {
    return {
      category: 'database_not_found',
      hint: 'The database name in DATABASE_URL does not exist on the configured PostgreSQL service.',
    };
  }
  if (code === 'ECONNREFUSED' || /connection refused/i.test(message)) {
    return {
      category: 'connection_refused',
      hint: 'PostgreSQL is not accepting connections at the DATABASE_URL host and port, or the service is not on the application network.',
    };
  }
  if (code === 'ENOTFOUND' || /getaddrinfo.*not found/i.test(message)) {
    return {
      category: 'host_not_found',
      hint: 'The DATABASE_URL host could not be resolved from the application container; verify the Coolify database service hostname and network.',
    };
  }
  return {
    category: 'database_connection',
    hint: 'Verify DATABASE_URL, database service health, credentials, and network membership before restarting the application.',
  };
}

module.exports = {
  parseDatabaseUrl,
  getDatabaseSslConfig,
  describeDatabaseTarget,
  classifyDatabaseError,
};
