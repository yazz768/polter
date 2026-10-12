const {PLAN,problem,hash}=require('./store');

function validateInput(body) {
  const input={};
  for(const key of ['username','name','email','phone','method']) {
    if(typeof body?.[key]!=='string')throw problem('Isi username, nama, email, nomor HP, dan metode pembayaran.');
    input[key]=body[key].trim();
  }
  input.username=input.username.toLowerCase();input.email=input.email.toLowerCase();input.phone=input.phone.replace(/[\s()+-]/g,'');
  if(!/^[a-z0-9][a-z0-9_]{1,30}[a-z0-9]$/.test(input.username))throw problem('Username harus 3–32 karakter: huruf kecil, angka, atau underscore di tengah.');
  if(input.name.length<2 || input.name.length>100 || /[\x00-\x1f]/.test(input.name))throw problem('Nama harus 2–100 karakter.');
  if(input.email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))throw problem('Alamat email tidak valid.');
  if(!/^\d{9,15}$/.test(input.phone))throw problem('Nomor HP harus 9–15 digit.');
  if(!/^[A-Z0-9_]{2,30}$/.test(input.method))throw problem('Pilih metode pembayaran yang tersedia.');
  return input;
}
function trustedInvoice(order,data) {
  const integer=n=>Number.isSafeInteger(n) && n>=0;
  const items=data?.order_items;
  if(!data || typeof data.reference!=='string' || !data.reference || data.merchant_ref!==order.id ||
      data.payment_method!==order.method || !integer(data.amount) || !integer(data.fee_customer) ||
      data.amount!==order.amount+data.fee_customer || !Array.isArray(items) || items.length!==1 ||
      items[0].sku!==PLAN.id || items[0].price!==order.amount || items[0].quantity!==1 ||
      !['UNPAID','PAID','EXPIRED','FAILED','REFUND'].includes(data.status) ||
      (order.gateway_ref && order.gateway_ref!==data.reference) ||
      (order.gateway_amount!==null && order.gateway_amount!==undefined && order.gateway_amount!==data.amount)) {
    throw problem('Detail pembayaran tidak cocok dengan pesanan.',409);
  }
  let checkout=null;
  if(data.checkout_url) {
    const u=new URL(data.checkout_url);
    if(u.origin!=='https://tripay.co.id' || u.username || u.password)throw problem('Alamat checkout tidak valid.',502);
    checkout=u.href;
  }
  return {gateway_ref:data.reference,gateway_amount:data.amount,fee_customer:data.fee_customer,checkout_url:checkout,payment_expire:data.expired_time || data.expired_at || null};
}

function createService(store,gateway,accounts,options={}) {
  if(store.mode!==gateway.mode || accounts.mode!==store.mode)throw new Error('Mode gateway, database, dan Marzban berbeda');
  async function create(body,key) {
    if(!gateway.enabled)throw problem('Pembayaran online sedang dinonaktifkan. Silakan kembali nanti.',503);
    const input=validateInput(body);
    const existing=store.byKey(key);
    if(!existing) {
      const channels=await gateway.channels();
      if(!channels.some(c=>c.code===input.method))throw problem('Metode pembayaran tidak tersedia.');
      if(await accounts.exists(input.username))throw problem('Username sudah digunakan. Pilih username lain.',409);
    }
    const order=store.create(input,key);
    await run(order.id,{createInvoice:true});
    return store.get(order.id);
  }
  async function createManual(body,key) {
    if(!options.manualEnabled)throw problem('Pemesanan WhatsApp belum tersedia.',503);
    if(typeof key!=='string' || !/^[a-f0-9]{64}$/.test(key))throw problem('Kunci pesanan tidak valid.');
    const nickname=typeof body?.username==='string'?body.username.normalize('NFKC').trim().replace(/ +/g,' '):'';
    if(nickname.length<2 || nickname.length>40 || !/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(nickname))throw problem('Username 2-40 karakter. Gunakan huruf, angka, spasi, titik, garis bawah, atau tanda hubung. Tidak perlu nama asli.');
    // The nickname is independent of Marzban naming restrictions and may be reused.
    const contactType=body?.contactType;
    let contact=typeof body?.contact==='string'?body.contact.trim():'';
    if(contactType==='email') {
      if(contact.length>254 || !/^[^\s@\x00-\x1f]+@[^\s@\x00-\x1f]+\.[^\s@\x00-\x1f]+$/.test(contact))throw problem('Isi alamat email yang valid.');
    } else if(contactType==='phone') {
      if(!/^\+?[0-9 ()-]+$/.test(contact) || contact.length>30)throw problem('Isi nomor HP yang valid.');
      contact=contact.replace(/[ ()+-]/g,'');
      if(!/^\d{9,15}$/.test(contact))throw problem('Nomor HP harus 9-15 digit.');
    } else throw problem('Pilih salah satu kontak: email atau nomor HP.');
    const input={username:'vpn_'+hash(key).slice(0,24),display_username:nickname,name:'',email:contactType==='email'?contact:'',phone:contactType==='phone'?contact:'',method:'MANUAL'};
    const order=store.create(input,key);
    const lease=store.claim(order.id);
    if(lease){try{if(store.get(order.id).payment_status==='DRAFT')store.save(order.id,lease,{payment_status:'UNPAID',gateway_amount:order.amount,fee_customer:0});}finally{store.release(order.id,lease);}}
    return store.get(order.id);
  }
  async function confirmManual(id,body) {
    if(!options.manualEnabled)throw problem('Pemesanan manual dinonaktifkan.',503);
    const reference=typeof body?.reference==='string'?body.reference.trim().toUpperCase():'';
    if(!/^[A-Z0-9][A-Z0-9._/-]{3,99}$/.test(reference))throw problem('Isi ID transaksi dari riwayat GoPay Merchant (4-100 karakter).');
    if(body.checked!==true || !Number.isSafeInteger(body.amount))throw problem('Periksa uang masuk dan centang konfirmasi terlebih dahulu.');
    store.confirmManual(id,reference,body.amount);
    try{await run(id);}catch{/* Payment is durable; worker retries account creation. */}
    return store.get(id);
  }
  async function fulfill(order,lease) {
    if(order.payment_status==='REFUND') {
      if(order.provision_status==='REVOKED')return;
      await accounts.revoke(order);
      store.save(order.id,lease,{provision_status:'REVOKED',access_json:null,error_code:null});
      store.event(order.id,'ACCOUNT_REVOKED');return;
    }
    if(order.payment_status!=='PAID' || order.provision_status==='READY' || order.provision_status==='CONFLICT')return;
    order=store.save(order.id,lease,{provision_status:'PROCESSING',account_expire:order.account_expire || Math.floor(Date.now()/1000)+order.days*86400});
    const access=await accounts.provision(order);
    if(access.username!==order.username || !Array.isArray(access.links) || (store.mode==='production' && (access.simulated || !access.links.length)))throw new Error('Invalid provisioning result');
    store.save(order.id,lease,{provision_status:'READY',access_json:JSON.stringify(access),error_code:null});
    store.event(order.id,'ACCOUNT_READY');
  }
  async function applyDetail(order,lease,data) {
    const invoice=trustedInvoice(order,data);
    // A late UNPAID/EXPIRED notification must never roll back a verified PAID order.
    let status=data.status;
    if(order.payment_status==='REFUND')status='REFUND';
    else if(order.payment_status==='PAID' && status!=='REFUND')status='PAID';
    order=store.save(order.id,lease,{...invoice,payment_status:status,error_code:null,next_check:Date.now()+60000});
    await fulfill(order,lease);
  }
  async function run(id,{createInvoice=false,callback=null}={}) {
    const lease=store.claim(id);if(!lease)return false;
    try {
      let order=store.get(id);
      const callbackVersion=order?.callback_version;
      if(!order)throw problem('Pesanan tidak ditemukan.',404);
      if(order.method==='MANUAL') {
        if(!options.manualEnabled)return false;
        store.save(id,lease,{next_check:Date.now()+60000});
        await fulfill(order,lease);
        return true;
      }
      if(!gateway.enabled)return false;
      store.save(id,lease,{next_check:Date.now()+60000});
      if(order.payment_status==='DRAFT') {
        if(!createInvoice)return false;
        order=store.save(id,lease,{payment_status:'CREATING'});
        // Never blindly retry POST after timeout: recover by merchant_ref instead.
        const data=await gateway.create(order);
        const invoice=trustedInvoice(order,data);
        order=store.save(id,lease,{...invoice,payment_status:'UNPAID'});
      }
      if(!order.gateway_ref) {
        const found=await gateway.find(order.id);
        if(!found) {store.save(id,lease,{payment_status:'CHECKOUT_UNKNOWN',error_code:'CHECKOUT_PENDING'});return false;}
        const invoice=trustedInvoice(order,found);
        order=store.save(id,lease,invoice);
      }
      if(callback && (callback.reference!==order.gateway_ref || callback.merchant_ref!==order.id || callback.total_amount!==order.gateway_amount || callback.payment_method_code!==order.method || callback.is_closed_payment!==1)) {
        throw problem('Callback tidak cocok dengan pesanan.',409);
      }
      // Always independently fetch the authoritative state, including callback/retries.
      const detail=await gateway.detail(order.gateway_ref);
      await applyDetail(order,lease,detail);
      store.acknowledge(id,callbackVersion);
      return true;
    } catch(error) {
      const order=store.get(id);
      const fields={error_code:error.code==='ACCOUNT_CONFLICT'?'ACCOUNT_CONFLICT':'RETRY_PENDING',attempts:(order?.attempts||0)+1,next_check:Date.now()+Math.min(300000,15000*2**Math.min(order?.attempts||0,4))};
      if(error.code==='ACCOUNT_CONFLICT')fields.provision_status='CONFLICT';
      if(order?.payment_status==='CREATING')fields.payment_status='CHECKOUT_UNKNOWN';
      store.save(id,lease,fields);
      store.event(id,fields.error_code);
      if(error.safe)throw error;
      throw problem('Pesanan tersimpan dan akan dicoba lagi otomatis. Jangan membayar ulang.',502);
    } finally {store.release(id,lease);}
  }
  async function callback(raw,signature,event) {
    if(!gateway.verify(raw,signature,event))throw problem('Signature callback tidak valid.',401);
    let data;try{data=JSON.parse(raw.toString('utf8'));}catch{throw problem('JSON tidak valid.');}
    if(!data || typeof data.merchant_ref!=='string' || !store.get(data.merchant_ref))throw problem('Pesanan tidak ditemukan.',404);
    // When the order is busy, worker reconciliation is durable and will check it again.
    store.wake(data.merchant_ref);
    await run(data.merchant_ref,{callback:data});
  }
  function view(order) {
    if(!order)throw problem('Pesanan tidak ditemukan atau kunci akses salah.',404);
    return {id:order.id,username:order.display_username || order.username,method:order.method,mode:store.mode,plan:PLAN,payment_status:order.payment_status,
      provision_status:order.provision_status,total:order.gateway_amount,fee_customer:order.fee_customer,
      checkout_url:order.payment_status==='UNPAID'?order.checkout_url:null,payment_expire:order.payment_expire,
      needs_help:order.provision_status==='CONFLICT' || order.payment_status==='CHECKOUT_UNKNOWN',
      access:order.payment_status==='PAID' && order.provision_status==='READY'?JSON.parse(order.access_json):null};
  }
  let working=false;
  async function tick() {
    if(working || (!gateway.enabled && !options.manualEnabled))return;working=true;
    try {for(const row of store.due()){try{await run(row.id);}catch{/* Safe error state is persisted; no secrets logged. */}}}
    finally{working=false;}
  }
  return {create,createManual,confirmManual,run,callback,view,tick};
}
module.exports={createService,validateInput,trustedInvoice};
