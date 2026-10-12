const path=require('node:path');
const fs=require('node:fs');
const {openStore}=require('./store');
const {createTripay}=require('./tripay');
const {createAccounts}=require('./accounts');
const {createService}=require('./service');
const {createApp}=require('./app');
const {createAdmin}=require('./admin');
const {createBackup}=require('./backup');

function start() {
  const root=path.join(__dirname,'..','..');
  require('dotenv').config({path:path.join(root,'.env'),quiet:true});
  const env=process.env;
  const manualEnabled=env.ORDER_MODE==='manual' && env.MANUAL_ORDERS_ENABLED==='true';
  const accountEnv=manualEnabled?{...env,TRIPAY_MODE:env.ACCOUNT_MODE || 'sandbox',PAYMENTS_ENABLED:'false'}:env;
  const gateway=createTripay(accountEnv);
  const data=env.WEB_DATA_DIR || path.join(root,'data');fs.mkdirSync(data,{recursive:true,mode:0o700});
  const store=openStore(path.join(data,`web-orders-${gateway.mode}.sqlite`),gateway.mode);
  const accounts=createAccounts(accountEnv);
  const service=createService(store,gateway,accounts,{manualEnabled});
  const backupNow=createBackup(store,env.BACKUP_DIR || path.join(data,'backups'));
  const admin=createAdmin({file:path.join(data,'admin-auth.json'),store,service,env,backupNow});
  const app=createApp({store,service,gateway,env,admin,manualEnabled});
  const port=Number(env.WEB_PORT || 3000);const host=env.WEB_HOST || '127.0.0.1';
  const server=app.listen(port,host,()=>{
    console.log(`Website: http://${host}:${port}`);
    console.log(`Tripay: ${gateway.enabled?gateway.mode:'DIBEKUKAN'}`);
    if(manualEnabled)console.log(`Pesanan WhatsApp: ${gateway.mode}. Admin: http://${host}:${port}/admin`);
  });
  const timer=setInterval(()=>service.tick().catch(()=>console.error('Pemeriksaan pesanan tertunda.')),15000);
  timer.unref();service.tick().catch(()=>{});
  const backupTimer=setInterval(()=>backupNow().catch(()=>console.error('Backup otomatis gagal. Periksa penyimpanan.')),3600000);
  backupTimer.unref();backupNow().catch(()=>console.error('Backup otomatis gagal. Periksa penyimpanan.'));
  function stop(){clearInterval(timer);clearInterval(backupTimer);server.close(()=>{store.close();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();}
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  return {server,store};
}
module.exports={start};
