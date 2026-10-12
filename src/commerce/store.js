const { DatabaseSync, backup } = require('node:sqlite');
const { randomBytes, randomUUID, createHash } = require('node:crypto');

const PLAN = Object.freeze({ id: 'VLESS_30', name: 'VPN VLESS 30 Hari', amount: 15000, days: 30, quota: 50 });
const hash = value => createHash('sha256').update(value).digest('hex');
function problem(message, status = 400) { return Object.assign(new Error(message), { status, safe: true }); }

function openStore(filename, mode) {
  if (!['sandbox', 'production'].includes(mode)) throw new Error('TRIPAY_MODE tidak valid.');
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS web_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS web_orders (
      id TEXT PRIMARY KEY, access_hash TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE, account_uuid TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, method TEXT NOT NULL,
      amount INTEGER NOT NULL, days INTEGER NOT NULL, quota INTEGER NOT NULL,
      payment_status TEXT NOT NULL DEFAULT 'DRAFT', provision_status TEXT NOT NULL DEFAULT 'PENDING',
      gateway_ref TEXT UNIQUE, gateway_amount INTEGER, fee_customer INTEGER,
      checkout_url TEXT, payment_expire INTEGER, account_expire INTEGER, access_json TEXT,
      lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0, next_check INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0, error_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS web_events (
      id INTEGER PRIMARY KEY, order_id TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL
    );`);
  db.prepare("INSERT OR IGNORE INTO web_meta VALUES ('mode',?)").run(mode);
  if (!db.prepare('PRAGMA table_info(web_orders)').all().some(c=>c.name==='callback_version')) {
    db.exec('ALTER TABLE web_orders ADD COLUMN callback_version INTEGER NOT NULL DEFAULT 0');
  }
  if (!db.prepare('PRAGMA table_info(web_orders)').all().some(c=>c.name==='display_username')) {
    db.exec('ALTER TABLE web_orders ADD COLUMN display_username TEXT');
  }
  db.exec(`CREATE TABLE IF NOT EXISTS manual_receipts (
    reference TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE,
    amount INTEGER NOT NULL, confirmed_at INTEGER NOT NULL
  )`);
  if (db.prepare("SELECT value FROM web_meta WHERE key='mode'").get().value !== mode) {
    db.close(); throw new Error('Database mode berbeda. Gunakan database terpisah untuk sandbox dan produksi.');
  }
  const get = id => db.prepare('SELECT * FROM web_orders WHERE id=?').get(id);
  function byKey(key) {
    if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) return null;
    return db.prepare('SELECT * FROM web_orders WHERE access_hash=?').get(hash(key));
  }
  function create(input, key) {
    if (!/^[a-f0-9]{64}$/.test(key || '')) throw problem('Kunci pesanan tidak valid. Muat ulang halaman.');
    const digest = hash(JSON.stringify(input));
    const existing = byKey(key);
    if (existing) {
      if (existing.request_hash !== digest) throw problem('Pesanan ini sudah tersimpan dengan data berbeda. Buka pesanan tersebut atau mulai pesanan baru.', 409);
      return existing;
    }
    const id = `POLTER-${randomBytes(12).toString('hex')}`;
    try {
      db.prepare(`INSERT INTO web_orders
        (id,access_hash,request_hash,username,account_uuid,name,email,phone,method,amount,days,quota,created_at,updated_at,display_username)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,hash(key),digest,input.username,randomUUID(),input.name,input.email,input.phone,input.method,PLAN.amount,PLAN.days,PLAN.quota,Date.now(),Date.now(),input.display_username || null);
    } catch (e) {
      if (String(e.code).includes('CONSTRAINT') || String(e.message).includes('UNIQUE')) {
        const concurrent = byKey(key);
        if (concurrent?.request_hash === digest) return concurrent;
        throw problem('Username sudah dipesan. Pilih username lain.', 409);
      }
      throw e;
    }
    event(id,'ORDER_CREATED');
    return get(id);
  }
  function event(id, kind) { db.prepare('INSERT INTO web_events (order_id,kind,at) VALUES (?,?,?)').run(id,kind,Date.now()); }
  function claim(id) {
    const lease=randomUUID();
    const result=db.prepare('UPDATE web_orders SET lease=?,lease_until=? WHERE id=? AND lease_until<?').run(lease,Date.now()+180000,id,Date.now());
    return result.changes ? lease : null;
  }
  const allowed=new Set(['payment_status','provision_status','gateway_ref','gateway_amount','fee_customer','checkout_url','payment_expire','account_expire','access_json','next_check','attempts','error_code']);
  function save(id, lease, fields) {
    const keys=Object.keys(fields);
    if (!keys.length || keys.some(k=>!allowed.has(k))) throw new Error('Invalid order update');
    const result=db.prepare(`UPDATE web_orders SET ${keys.map(k=>k+'=?').join(',')},updated_at=? WHERE id=? AND lease=? AND lease_until>?`)
      .run(...keys.map(k=>fields[k]),Date.now(),id,lease,Date.now());
    if (!result.changes) throw new Error('Order lease expired');
    return get(id);
  }
  function release(id,lease) { db.prepare('UPDATE web_orders SET lease=NULL,lease_until=0 WHERE id=? AND lease=?').run(id,lease); }
  function due() {
    return db.prepare(`SELECT id FROM web_orders WHERE payment_status IN ('CREATING','CHECKOUT_UNKNOWN','UNPAID','PAID','REFUND')
      AND NOT (method='MANUAL' AND payment_status IN ('CREATING','CHECKOUT_UNKNOWN','UNPAID'))
      AND NOT (payment_status='PAID' AND provision_status='READY' AND callback_version=0)
      AND NOT (payment_status='REFUND' AND provision_status='REVOKED')
      AND provision_status!='CONFLICT' AND next_check<=? AND lease_until<? ORDER BY next_check LIMIT 20`).all(Date.now(),Date.now());
  }
  function wake(id) { db.prepare('UPDATE web_orders SET callback_version=callback_version+1,next_check=0 WHERE id=?').run(id); }
  function acknowledge(id,version) { db.prepare('UPDATE web_orders SET callback_version=0 WHERE id=? AND callback_version=?').run(id,version); }
  function confirmManual(id,reference,amount) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const order=get(id);
      if(!order || order.method!=='MANUAL')throw problem('Pesanan manual tidak ditemukan.',404);
      if(amount!==order.amount)throw problem('Nominal harus sama dengan tagihan.',409);
      const receipt=db.prepare('SELECT * FROM manual_receipts WHERE order_id=? OR reference=?').get(id,reference);
      if(receipt && (receipt.order_id!==id || receipt.reference!==reference || receipt.amount!==amount))throw problem('Referensi pembayaran sudah digunakan atau berbeda dari konfirmasi sebelumnya.',409);
      if(!['DRAFT','UNPAID','PAID'].includes(order.payment_status))throw problem('Status pesanan tidak dapat dikonfirmasi.',409);
      if(!receipt) {
        db.prepare('INSERT INTO manual_receipts VALUES (?,?,?,?)').run(reference,id,amount,Date.now());
        db.prepare("UPDATE web_orders SET payment_status='PAID',gateway_amount=?,fee_customer=0,next_check=0,updated_at=? WHERE id=?").run(amount,Date.now(),id);
        event(id,'MANUAL_PAYMENT_CONFIRMED');
      }
      db.exec('COMMIT');return get(id);
    } catch(e) {db.exec('ROLLBACK');throw e;}
  }
  function list({before=Number.MAX_SAFE_INTEGER,limit=50}={}) {
    return db.prepare(`SELECT o.rowid AS cursor,o.id,o.username,o.display_username,o.email,o.phone,o.method,o.amount,o.payment_status,o.provision_status,o.error_code,o.created_at,r.reference,r.confirmed_at
      FROM web_orders o LEFT JOIN manual_receipts r ON r.order_id=o.id WHERE o.rowid<? ORDER BY o.rowid DESC LIMIT ?`).all(before,limit);
  }
  return { mode, create, get, byKey, claim, save, release, due, event, wake, acknowledge, confirmManual, list,
    backup:destination=>backup(db,destination),close:()=>db.close() };
}
module.exports={openStore,PLAN,problem,hash};
