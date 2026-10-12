const fs=require('node:fs/promises');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
function createBackup(store,directory) {
  let pending;
  return function backupNow() {
    if(pending)return pending;
    pending=(async()=>{
      await fs.mkdir(directory,{recursive:true,mode:0o700});
      const date=new Date().toISOString().slice(0,10);
      const filename=`web-orders-${store.mode}-${date}.sqlite`;
      const temporary=path.join(directory,filename+'.tmp');
      await store.backup(temporary);
      const snapshot=new DatabaseSync(temporary);
      try {snapshot.exec('PRAGMA journal_mode=DELETE');}
      finally {snapshot.close();}
      await fs.chmod(temporary,0o600);
      await fs.rename(temporary,path.join(directory,filename));
      // Only prune this application's dated backup files, never arbitrary files.
      const pattern=new RegExp(`^web-orders-${store.mode}-\\d{4}-\\d{2}-\\d{2}\\.sqlite$`);
      const files=(await fs.readdir(directory)).filter(name=>pattern.test(name)).sort().reverse();
      for(const name of files.slice(14))await fs.unlink(path.join(directory,name));
    })().finally(()=>{pending=null;});
    return pending;
  };
}
module.exports={createBackup};
