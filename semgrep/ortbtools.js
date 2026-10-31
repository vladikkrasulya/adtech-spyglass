const { chQuery, chExec, chEsc } = require('../lib/clickhouse');
const TABLE = 'analytics.t';

async function bad1(parsed) {
  // ruleid: ortb-clickhouse-tainted-sql, ortb-clickhouse-interpolated-sql
  await chQuery(`SELECT 1 WHERE a = '${parsed.searchParams.get('q')}'`);
}
async function bad2(parsed) {
  // ruleid: ortb-quote-stripping-is-not-escaping
  const lang = (parsed.searchParams.get('lang') || '').replace(/'/g, '');
  // ruleid: ortb-clickhouse-interpolated-sql, ortb-clickhouse-tainted-sql
  await chQuery("SELECT 1 WHERE b = '" + lang + "'");
}
async function bad3(req) {
  const body = await readJson(req);
  // ruleid: ortb-clickhouse-tainted-sql, ortb-clickhouse-interpolated-sql
  await chExec(`ALTER TABLE x UPDATE v = '${body.v}' WHERE 1`);
}
async function bad4(userIdFromSomewhere) {
  // ruleid: ortb-clickhouse-interpolated-sql
  await chExec(`DELETE FROM x WHERE user_id = ${userIdFromSomewhere}`);
}

async function good(parsed) {
  const q = parsed.searchParams.get('q');
  // ok: ortb-clickhouse-tainted-sql
  await chQuery(`SELECT 1 WHERE a = '${chEsc(q)}'`);
  // ok: ortb-clickhouse-interpolated-sql
  await chQuery(`SELECT 1 LIMIT ${Number(q) || 8}`);
  // ok: ortb-clickhouse-interpolated-sql
  await chQuery(`SELECT 1 FROM ${TABLE}`);
  // ok: ortb-clickhouse-interpolated-sql
  await chQuery('SELECT a ' + 'FROM t ' + 'WHERE x = 1');
  const status = parsed.searchParams.get('status');
  if (!['a', 'b'].includes(status)) return;
  // ruleid: ortb-clickhouse-interpolated-sql
  await chQuery(`SELECT 1 WHERE s = '${status}'`);
  // ok: ortb-quote-stripping-is-not-escaping
  const t = ' x '.replace(/\s+/g, ' ');
}
async function ssrf(parsed) {
  const target = parsed.searchParams.get('u');
  // ruleid: ortb-tainted-outbound-url
  await fetch(target, { method: 'GET' });
}
async function ssrfOk() {
  // ok: ortb-tainted-outbound-url
  await fetch('https://api.example.com/x');
}
function dom() {
  const q = new URLSearchParams(location.search).get('q');
  // ruleid: ortb-dom-xss-url-to-html
  document.body.innerHTML = q;
}
async function ownClient() {
  // ruleid: ortb-own-clickhouse-client
  await fetch(CH_URL + '/', { method: 'POST', body: 'SELECT 1' });
}
