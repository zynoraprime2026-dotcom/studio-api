// When a write fails, the whole database should not be declared dead. A full
// disk or a missing table is a problem with one statement; only a broken
// connection means there is no database to talk to. Getting this wrong once
// locked every key out of the studio, because a full Neon project latched the
// service into memory mode and the saved keys could no longer be read.

const FATAL_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  '57P01', // admin shutdown
  '57P02', // crash shutdown
  '57P03', // cannot connect now
  '53300', // too many connections
  '08006', // connection failure
  '08001', // unable to establish connection
  '3D000'  // database does not exist
]);

const FATAL_MESSAGES = [
  'connection terminated',
  'connection refused',
  'timeout exceeded when trying to connect',
  'client has encountered a connection error',
  'server closed the connection',
  'no pg_hba.conf entry'
];

function isFatalDbError(e) {
  if (!e) return false;
  const code = String(e.code || '');
  if (FATAL_CODES.has(code)) return true;
  const msg = String(e.message || '').toLowerCase();
  return FATAL_MESSAGES.some(m => msg.includes(m));
}

module.exports = { isFatalDbError, FATAL_CODES };
