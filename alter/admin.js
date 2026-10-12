(() => {
  const $=id=>document.getElementById(id);let csrf='',setup=false,rows=[],next=null,before=null;const drafts=new Map();
  async function api(path,body){const r=await fetch('/api/admin'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-CSRF-Token':csrf}:{},body:body?JSON.stringify(body):undefined,cache:'no-store'});const data=await r.json();if(!r.ok){if(r.status===401){$('dashboard').hidden=true;$('login').hidden=false;}throw new Error(data.message||'Permintaan gagal.');}return data;}
  function notify(text){$('notice').textContent=text;}
  async function enter(){const s=await api('/session');csrf=s.csrf;$('login').hidden=true;$('dashboard').hidden=false;$('mode').textContent=s.mode==='sandbox'?'Mode percobaan ? tanpa akun asli':'Aktivasi akun asli';await load();}
  async function load(){const data=await api('/orders'+(before?'?before='+before:''));rows=data.orders;next=data.next;$('more').hidden=!next;$('first').hidden=!before;render();}
  const payment={UNPAID:'Belum dibayar',DRAFT:'Belum dibayar',PAID:'Sudah dikonfirmasi',REFUND:'Dikembalikan'};
  const account={PENDING:'Belum dibuat',PROCESSING:'Sedang dibuat / menunggu percobaan ulang',READY:'Siap',CONFLICT:'Perlu pemeriksaan username',REVOKED:'Dinonaktifkan'};
  function element(tag,text,cls){const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e;}
  function render(){
    const filter=$('search').value.toLowerCase();const selected=$('status-filter').value;$('orders').replaceChildren();
    let visible=0;
    for(const row of rows){const name=row.display_username||row.username;if(!(name+' '+row.id+' '+(row.email||'')+' '+(row.phone||'')).toLowerCase().includes(filter))continue;
      if(selected==='pending' && !['UNPAID','DRAFT'].includes(row.payment_status))continue;
      if(selected==='ready' && !(row.payment_status==='PAID' && row.provision_status==='READY'))continue;
      if(selected==='processing' && !(row.payment_status==='PAID' && row.provision_status!=='READY'))continue;
      visible++;
      const card=element('article','','order');const top=element('div','','order-top');const identity=element('div','');identity.append(element('h2',name),element('p',row.id,'meta order-id'));top.append(identity,element('strong','Rp'+row.amount.toLocaleString('id-ID'),'order-price'));card.append(top,element('p',new Date(row.created_at).toLocaleString('id-ID'),'meta'));
      const ready=row.payment_status==='PAID' && row.provision_status==='READY';
      const label=ready?'Akun aktif':row.payment_status==='PAID'?'Dibayar ? akun belum siap':payment[row.payment_status]||row.payment_status;
      card.append(element('span',label,'status-chip '+(ready?'ready':'waiting')));
      if(row.email || row.phone)card.append(element('p',row.email?'Email: '+row.email:'Nomor HP: '+row.phone,'meta'));
      if(row.reference)card.append(element('p','ID transaksi: '+row.reference,'meta'));
      if(row.error_code)card.append(element('p','Pembuatan akun belum selesai. Pembayaran tetap tersimpan; jangan meminta pembayaran ulang.','notice'));
      if(row.method==='MANUAL' && ['UNPAID','DRAFT'].includes(row.payment_status)){
        const form=document.createElement('form');
        const refLabel=element('label','ID transaksi dari GoPay Merchant');const ref=document.createElement('input');ref.name='reference';ref.required=true;ref.minLength=4;ref.maxLength=100;ref.autocomplete='off';ref.placeholder='Salin ID transaksi uang masuk';refLabel.append(ref);
        const amountLabel=element('label','Nominal uang masuk (rupiah)');const amount=document.createElement('input');amount.name='amount';amount.type='number';amount.required=true;amount.min=1;amount.step=1;amount.placeholder=String(row.amount);amountLabel.append(amount);
        const checkLabel=element('label','','check');const check=document.createElement('input');check.type='checkbox';check.required=true;checkLabel.append(check,document.createTextNode('Saya sudah melihat uang masuk di GoPay Merchant dan mencocokkannya dengan pesanan ini.'));
        const button=element('button','Konfirmasi pembayaran & buat akun');button.type='submit';form.append(element('p','Cocokkan uang masuk di GoPay Merchant. Screenshot pelanggan saja tidak cukup.','form-help'),refLabel,amountLabel,checkLabel,button);
        const saved=drafts.get(row.id);if(saved){ref.value=saved.reference;amount.value=saved.amount;check.checked=saved.checked;}
        form.addEventListener('input',()=>drafts.set(row.id,{reference:ref.value,amount:amount.value,checked:check.checked}));
        const errorText=element('p','','form-error');errorText.setAttribute('role','alert');form.append(errorText);const details=element('details','','order-details');details.append(element('summary','Konfirmasi pembayaran'),form);card.append(details);
        form.onsubmit=async e=>{e.preventDefault();button.disabled=true;button.textContent='Memproses...';errorText.textContent='';try{const result=await api('/orders/'+row.id+'/confirm',{reference:ref.value,amount:Number(amount.value),checked:check.checked});drafts.delete(row.id);notify(result.order.provision_status==='READY'?'Pembayaran tercatat. Akun sudah siap di halaman pelanggan.':'Pembayaran tercatat. Pembuatan akun akan dilanjutkan otomatis.');await load();}catch(error){errorText.textContent=error.message;button.disabled=false;button.textContent='Konfirmasi pembayaran & buat akun';}};
      }else if(row.method==='MANUAL' && row.payment_status==='PAID' && row.provision_status!=='READY'){
        const button=element('button','Coba pembuatan akun lagi');card.append(button);button.onclick=async()=>{button.disabled=true;try{await api('/orders/'+row.id+'/retry',{});notify('Percobaan selesai. Periksa status akun.');await load();}catch(e){notify(e.message);button.disabled=false;}};
      }
      $('orders').append(card);
    }
    $('result-count').textContent=visible+' dari '+rows.length+' pesanan pada halaman ini';
    if(!visible){const empty=element('div','','empty-state');empty.append(element('h3',rows.length?'Tidak ada hasil yang cocok':'Belum ada pesanan'),element('p',rows.length?'Coba username lain atau ubah filter status.':'Pesanan pelanggan akan muncul di sini setelah formulir dikirim.'));$('orders').append(empty);}
  }
  $('login').onsubmit=async e=>{e.preventDefault();const button=$('login-submit');button.disabled=true;try{
    const password=$('login').elements.password.value;
    if(setup){if(password!==$('login').elements.repeat.value)throw new Error('Ulangan password berbeda.');await api('/setup',{password});setup=false;$('repeat-label').hidden=true;$('setup-help').hidden=true;$('login-title').textContent='Login admin';button.textContent='Masuk';}
    await api('/login',{password});$('login').reset();notify('Login berhasil.');await enter();
  }catch(error){notify(error.message);}finally{button.disabled=false;}};
  $('search').oninput=render;$('status-filter').onchange=render;$('refresh').onclick=()=>load().catch(e=>notify(e.message));
  $('more').onclick=()=>{before=next;load().catch(e=>notify(e.message));};$('first').onclick=()=>{before=null;load().catch(e=>notify(e.message));};
  $('logout').onclick=async()=>{try{await api('/logout',{});csrf='';drafts.clear();rows=[];$('orders').replaceChildren();$('dashboard').hidden=true;$('login').hidden=false;notify('Sudah keluar.');}catch(e){notify(e.message);}};
  $('backup').onclick=async()=>{$('backup').disabled=true;try{await api('/backup',{});notify('Backup database berhasil disimpan.');}catch(e){notify(e.message);}finally{$('backup').disabled=false;}};
  (async()=>{try{const info=await api('/status');if(!info.configured){if(!info.canSetup){notify('Admin belum disiapkan. Buka localhost di komputer server dengan ADMIN_SETUP_LOCAL=true.');return;}setup=true;$('login-title').textContent='Buat password admin';$('login-submit').textContent='Simpan password & masuk';$('repeat-label').hidden=false;$('setup-help').hidden=false;$('login').elements.password.autocomplete='new-password';$('login').hidden=false;return;}try{await enter();}catch{notify('Masuk untuk memeriksa pesanan.');$('login').hidden=false;}}catch(e){notify(e.message);}})();
})();
