const express=require('express');
const path=require('node:path');
const QRCode=require('qrcode');
const {problem}=require('./store');

function createApp({store,service,gateway,env={},admin,manualEnabled=false}) {
  const app=express();app.disable('x-powered-by');
  if(env.TRUST_PROXY_LOOPBACK==='true')app.set('trust proxy','loopback');
  app.use((req,res,next)=>{
    res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'});
    if(req.path.startsWith('/api/'))res.set('Cache-Control','no-store');
    next();
  });
  // Raw bytes must be captured before the JSON parser for HMAC verification.
  app.post(['/api/tripay/callback','/api/webhook/tripay'],express.raw({type:'application/json',limit:'64kb'}),async(req,res,next)=>{
    try {
      if(!gateway.enabled)throw problem('Pembayaran dinonaktifkan.',503);
      await service.callback(req.body,req.get('X-Callback-Signature'),req.get('X-Callback-Event'));
      res.json({success:true});
    }catch(e){next(e);}
  });
  app.use(express.json({limit:'16kb'}));
  const limits=new Map();
  function limit(req,res,next) {
    const now=Date.now();
    if(limits.size>10000)for(const [key,value] of limits)if(value.until<now)limits.delete(key);
    const key=req.ip;let entry=limits.get(key);
    if(!entry || entry.until<now){entry={count:0,until:now+60000};limits.set(key,entry);}
    if(++entry.count>60)return res.status(429).json({success:false,message:'Terlalu banyak permintaan. Coba lagi sebentar.'});
    next();
  }
  app.use('/api',limit);
  const adminNumber=(env.ADMIN_WHATSAPP||'').replace(/\D/g,'');
  const manualReady=()=>manualEnabled && /^[1-9][0-9]{8,14}$/.test(adminNumber) && Boolean(admin?.configured());
  function originAllowed(req) {
    const expected=env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('Host')}`;
    if(req.get('Origin') && req.get('Origin')!==new URL(expected).origin)throw problem('Asal permintaan tidak diizinkan.',403);
  }
  function whatsapp(order) {
    if(!adminNumber || env.LOCAL_UI_DEMO==='true')return null;
    const contact=order.email?`\nEmail: ${order.email}`:order.phone?`\nNomor HP: ${order.phone}`:'';
    const text=`Halo admin, saya mau pesan VPN.\nNomor pesanan: ${order.id}\nUsername: ${order.display_username || order.username}${contact}\nPaket: ${order.days} hari / ${order.quota} GiB\nTagihan: Rp${order.amount.toLocaleString('id-ID')}\nMohon kirim QRIS pembayaran. Saya akan bayar sesuai tagihan.`;
    return 'https://wa.me/'+adminNumber+'?text='+encodeURIComponent(text);
  }
  app.get('/api/public-config',(req,res)=>res.json({paymentsEnabled:gateway.enabled,paymentMode:gateway.mode,adminWhatsapp:env.LOCAL_UI_DEMO==='true'?'':adminNumber,manualEnabled:manualReady()}));
  if(admin)app.use('/api/admin',admin.router);
  app.post('/api/manual/orders',async(req,res,next)=>{
    try {
      originAllowed(req);
      if(!manualReady())throw problem('Pemesanan belum dibuka. Admin perlu menyelesaikan penyiapan.',503);
      const order=await service.createManual(req.body,req.get('X-Order-Key'));
      res.status(201).json({success:true,order:service.view(order),whatsapp_url:env.LOCAL_UI_DEMO==='true'?null:whatsapp(order)});
    }catch(e){next(e);}
  });
  app.get('/api/my-order',(req,res,next)=>{
    try {const order=store.byKey(req.get('X-Order-Key'));if(!order)throw problem('Pesanan tidak ditemukan.',404);res.json({success:true,order:service.view(order)});}catch(e){next(e);}
  });
  app.get('/api/tripay/health',(req,res)=>res.json({ok:true,mode:gateway.mode,paymentsEnabled:gateway.enabled}));
  app.get('/api/tripay/payment-channels',async(req,res,next)=>{
    try {res.json({success:true,data:(await gateway.channels()).map(({code,name})=>({code,name}))});}catch(e){next(e);}
  });
  app.post('/api/tripay/create-order',async(req,res,next)=>{
    const key=req.get('X-Order-Key');
    try {
      const origin=req.get('Origin');
      const expected=env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('Host')}`;
      if(origin && origin!==new URL(expected).origin)throw problem('Asal permintaan tidak diizinkan.',403);
      const order=await service.create(req.body,key);
      res.status(201).json({success:true,order:service.view(order)});
    }catch(e){
      const order=store.byKey(key);
      if(order && e.status===502)return res.status(202).json({success:true,order:service.view(order)});
      next(e);
    }
  });
  function authorized(req) {
    const order=store.byKey(req.get('X-Order-Key'));
    if(!order || order.id!==req.params.id)throw problem('Pesanan tidak ditemukan atau kunci akses salah.',404);
    return order;
  }
  app.get('/api/orders/:id',(req,res,next)=>{
    try {const order=authorized(req);res.json({...service.view(order),whatsapp_url:order.method==='MANUAL'?whatsapp(order):null});}catch(e){next(e);}
  });
  app.get('/api/orders/:id/qr',async(req,res,next)=>{
    try {
      const order=service.view(authorized(req));
      if(!order.access || order.access.simulated)throw problem('QR VPN belum tersedia.',409);
      const index=Number(req.query.index || 0);
      if(!Number.isSafeInteger(index) || index<0 || !order.access.links[index])throw problem('Config tidak ditemukan.',404);
      const qr=await QRCode.toBuffer(order.access.links[index],{type:'png',width:360,margin:4,errorCorrectionLevel:'M'});
      res.type('png').send(qr);
    }catch(e){next(e);}
  });
  // Alternate storefront uses the same API with an explicit public-file allowlist.
  const alternate=path.join(__dirname,'..','..','alter');
  app.get(/^\/alter$/,(req,res)=>res.redirect(302,'/alter/'));
  app.get('/alter/',(req,res)=>res.sendFile(path.join(alternate,'index.html')));
  for(const filename of ['index.html','style.css','script.js','checkout.js','success.html','success.js','order.css','admin.html','admin.js','admin.css']) {
    app.get('/alter/'+filename,(req,res)=>res.sendFile(path.join(alternate,filename)));
  }
  const root=path.join(__dirname,'..','..','public');
  app.get(['/', '/success'],(req,res)=>res.sendFile(path.join(root,req.path==='/success'?'success.html':'index.html')));
  // Only public assets; never expose source, .env, SQLite, or node_modules.
  app.get('/admin',(req,res)=>res.sendFile(path.join(root,'admin.html')));
  for(const filename of ['index.html','style.css','script.js','checkout.js','success.html','success.js','order.css','admin.html','admin.js','admin.css']) {
    app.get('/'+filename,(req,res)=>res.sendFile(path.join(root,filename)));
  }
  app.use((req,res)=>res.status(404).json({success:false,message:'Halaman tidak ditemukan.'}));
  app.use((error,req,res,next)=>{
    const status=error.type==='entity.parse.failed'?400:error.status || 500;
    res.status(status>=400 && status<=599?status:500).json({success:false,message:error.safe?error.message:status===400?'Data permintaan tidak valid.':'Permintaan belum dapat diproses. Coba lagi nanti.'});
  });
  return app;
}
module.exports={createApp};
