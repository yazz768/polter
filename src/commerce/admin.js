const {randomBytes,scrypt,timingSafeEqual,createHash}=require('node:crypto');
const {promisify}=require('node:util');
const fs=require('node:fs');
const express=require('express');
const {problem}=require('./store');
const derive=promisify(scrypt);
const digest=s=>createHash('sha256').update(s).digest('hex');

async function passwordHash(password) {
  if(typeof password!=='string' || password.length<12 || password.length>200)throw problem('Password admin minimal 12 dan maksimal 200 karakter.');
  const salt=randomBytes(16).toString('hex');
  return {salt,hash:(await derive(password,salt,64)).toString('hex')};
}
async function passwordMatches(password,record) {
  if(typeof password!=='string' || password.length>200)return false;
  const candidate=await derive(password,record.salt,64);
  return timingSafeEqual(candidate,Buffer.from(record.hash,'hex'));
}
function createAdmin({file,store,service,env={},backupNow=async()=>{}}) {
  const sessions=new Map(),failures=new Map();
  let creating=false;
  const configured=()=>fs.existsSync(file);
  function localSetup(req) {
    return env.ADMIN_SETUP_LOCAL==='true' &&
      ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress) &&
      /^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(req.get('Host')||'') &&
      !req.get('Forwarded') && !req.get('X-Forwarded-For') && !req.get('X-Forwarded-Host');
  }
  function origin(req,res,next) {
    try {
      const expected=env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('Host')}`;
      if(req.get('Origin')!==new URL(expected).origin)throw problem('Asal permintaan tidak diizinkan.',403);
      next();
    }catch(e){next(e);}
  }
  function session(req,res,next) {
    const cookie=(req.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('polter_admin='));
    const token=cookie?.slice('polter_admin='.length);
    const item=token?sessions.get(digest(token)):null;
    if(!item || item.expires<Date.now())return next(problem('Silakan login admin.',401));
    if(req.method!=='GET' && req.get('X-CSRF-Token')!==item.csrf)return next(problem('Sesi tidak valid. Muat ulang halaman admin.',403));
    req.adminSession=item;req.adminToken=digest(token);next();
  }
  const router=express.Router();
  router.get('/status',(req,res)=>res.json({configured:configured(),canSetup:!configured()&&localSetup(req)}));
  router.post('/setup',origin,async(req,res,next)=>{
    try {
      if(!localSetup(req) || configured() || creating)throw problem('Penyiapan admin hanya tersedia sekali melalui localhost.',403);
      creating=true;
      try {const record=await passwordHash(req.body?.password);fs.writeFileSync(file,JSON.stringify(record),{flag:'wx',mode:0o600});}
      finally {creating=false;}
      res.json({success:true});
    }catch(e){next(e);}
  });
  router.post('/login',origin,async(req,res,next)=>{
    try {
      const now=Date.now();
      for(const [key,value] of failures)if(value.until<now)failures.delete(key);
      let attempt=failures.get(req.ip);if(!attempt){attempt={count:0,until:now+900000};failures.set(req.ip,attempt);}
      if(++attempt.count>5)throw problem('Terlalu banyak percobaan login. Tunggu 15 menit.',429);
      if(!configured())throw problem('Admin belum disiapkan.',503);
      if(!await passwordMatches(req.body?.password,JSON.parse(fs.readFileSync(file,'utf8'))))throw problem('Password salah.',401);
      failures.delete(req.ip);
      for(const [key,value] of sessions)if(value.expires<now)sessions.delete(key);
      const token=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');
      sessions.set(digest(token),{csrf,expires:now+8*3600000});
      res.cookie('polter_admin',token,{httpOnly:true,sameSite:'strict',secure:req.secure || /^https:/.test(env.PUBLIC_BASE_URL||''),path:'/api/admin',maxAge:8*3600000});
      res.json({success:true,csrf});
    }catch(e){next(e);}
  });
  router.use((req,res,next)=>req.method==='GET'?next():origin(req,res,next),session);
  router.get('/session',(req,res)=>res.json({csrf:req.adminSession.csrf,mode:store.mode}));
  router.post('/logout',(req,res)=>{sessions.delete(req.adminToken);res.clearCookie('polter_admin',{path:'/api/admin'});res.json({success:true});});
  router.get('/orders',(req,res,next)=>{
    const before=Number(req.query.before || Number.MAX_SAFE_INTEGER);
    if(!Number.isSafeInteger(before) || before<1)return next(problem('Halaman tidak valid.'));
    const orders=store.list({before});res.json({orders,mode:store.mode,next:orders.length===50?orders.at(-1).cursor:null});
  });
  router.post('/orders/:id/confirm',async(req,res,next)=>{
    try {const order=await service.confirmManual(req.params.id,req.body);res.json({success:true,order:service.view(order)});}
    catch(e){next(e);}
  });
  router.post('/orders/:id/retry',async(req,res,next)=>{
    try {
      const order=store.get(req.params.id);
      if(!order || order.method!=='MANUAL' || order.payment_status!=='PAID')throw problem('Hanya pesanan manual yang sudah dibayar dapat dicoba ulang.',409);
      await service.run(order.id);res.json({success:true,order:service.view(store.get(order.id))});
    }catch(e){next(e);}
  });
  router.get('/export.csv',(req,res)=>{
    // No credentials, QR, private order keys, or customer contact data are exported.
    function cell(value){let s=String(value??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
    const rows=[['Nomor pesanan','Username','Harga','Status pembayaran','Status akun','Dibuat','Referensi GoPay']];
    let before=Number.MAX_SAFE_INTEGER;
    while(true){const page=store.list({before,limit:500});if(!page.length)break;for(const o of page)rows.push([o.id,o.display_username||o.username,o.amount,o.payment_status,o.provision_status,new Date(o.created_at).toISOString(),o.reference]);before=page.at(-1).cursor;}
    res.set('Content-Disposition','attachment; filename="rekap-polter.csv"').type('text/csv').send('\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n'));
  });
  router.post('/backup',async(req,res,next)=>{try{await backupNow();res.json({success:true});}catch{next(problem('Backup gagal. Periksa folder backup dan ruang penyimpanan.',500));}});
  return {router,configured};
}
module.exports={createAdmin,passwordHash};
