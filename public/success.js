(() => {
  const $=id=>document.getElementById(id);
  const query=new URLSearchParams(location.search), fragment=new URLSearchParams(location.hash.slice(1));
  const id=query.get('order');
  let key=fragment.get('key');
  try { key=key || localStorage.getItem('polter-order-'+id);if(id && key)localStorage.setItem('polter-order-'+id,key); } catch {}
  history.replaceState(null,'',location.pathname+location.search);
  let timer, qrObject, lastAccess, currentOrder;
  function headers(){return {'X-Order-Key':key};}
  function privateUrl(){return location.origin+'/success.html?order='+encodeURIComponent(id)+'#key='+key;}
  async function copy(text){try{await navigator.clipboard.writeText(text);$('feedback').textContent='Berhasil disalin.';}catch{$('feedback').textContent='Browser tidak mengizinkan penyalinan. Salin teks secara manual.';}}
  $('save-order').onclick=()=>{
    const a=document.createElement('a');const url=URL.createObjectURL(new Blob([privateUrl()],{type:'text/plain'}));
    a.href=url;a.download='pesanan-polter.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  $('copy-order').onclick=()=>copy(privateUrl());
  $('copy-config').onclick=()=>copy($('vpn-link').value);
  $('refresh').onclick=()=>poll();
  async function showQr(index){
    $('vpn-link').value=currentOrder.access.links[index];
    try {
      const response=await fetch(`/api/orders/${encodeURIComponent(id)}/qr?index=${index}`,{headers:headers(),cache:'no-store'});
      if(!response.ok)throw new Error('QR belum dapat dimuat. Coba lagi.');
      if(qrObject)URL.revokeObjectURL(qrObject);
      qrObject=URL.createObjectURL(await response.blob());$('qr').src=qrObject;
    }catch(e){$('feedback').textContent=e.message;}
  }
  const messages={DRAFT:'Pesanan sedang disiapkan.',CREATING:'Tagihan sedang disiapkan.',CHECKOUT_UNKNOWN:'Gateway belum memastikan tagihan. Jangan membuat pembayaran kedua. Halaman akan diperiksa otomatis.',UNPAID:'Pesanan tersimpan. Selesaikan pembayaran melalui tombol di bawah.',PAID:'Pembayaran terverifikasi. Akun VPN sedang dibuat otomatis.',EXPIRED:'Tagihan kedaluwarsa. Tidak ada akun yang diaktifkan.',FAILED:'Pembayaran gagal. Tidak ada akun yang diaktifkan.',REFUND:'Pembayaran dikembalikan; akses akun dinonaktifkan.'};
  async function poll(){
    clearTimeout(timer);
    if(!id || !/^[a-f0-9]{64}$/.test(key || '')){
      $('title').textContent='Buka tautan pesanan pribadi';$('status').textContent='Gunakan browser tempat memesan, atau buka tautan dari file pesanan yang sudah disimpan. Halaman ini tidak membuktikan pembayaran berhasil.';
      $('order-actions').hidden=true;$('refresh').hidden=true;return;
    }
    try{
      const response=await fetch('/api/orders/'+encodeURIComponent(id),{headers:headers(),cache:'no-store'});
      const o=await response.json();if(!response.ok)throw new Error(o.message || 'Pesanan belum dapat dimuat.');
      currentOrder=o;$('details').hidden=false;$('order-id').textContent=o.id;$('username').textContent=o.username;
      $('total').textContent=new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(o.total ?? o.plan.amount);
      $('fee').textContent=o.fee_customer===null?'Biaya pembayaran ditampilkan setelah tagihan tersedia.':'Termasuk biaya pelanggan Rp'+o.fee_customer.toLocaleString('id-ID');
      $('mode').hidden=o.mode!=='sandbox';$('status').textContent=messages[o.payment_status] || 'Status pesanan diperbarui.';
      $('title').textContent=o.payment_status==='PAID'?'Pembayaran terverifikasi':'Pesanan VPN kamu';
      $('whatsapp').hidden=!o.whatsapp_url;
      if(o.whatsapp_url)$('whatsapp').href=o.whatsapp_url;
      if(o.method==='MANUAL' && o.payment_status==='UNPAID')$('status').textContent='Pesanan sudah disimpan. Kirim pesan ke admin melalui WhatsApp untuk mendapatkan QRIS pembayaran. Setelah admin memeriksa uang masuk, akun dan QR VPN muncul otomatis di sini. Simpan tautan pesanan ini.';
      $('pay').hidden=!o.checkout_url;
      if(o.checkout_url)$('pay').href=o.checkout_url;
      $('access').hidden=!o.access || o.access.simulated;
      if(o.access?.simulated){$('title').textContent='Simulasi selesai';$('status').textContent='Pembayaran percobaan terverifikasi. Tidak ada akun VPN produksi yang dibuat.';}
      else if(o.access){
        $('title').textContent=o.mode==='sandbox'?'Contoh QR berhasil dibuat':'VPN kamu siap dipakai';$('status').textContent=o.mode==='sandbox'?'Ini demo tampilan. QR contoh ini tidak bisa digunakan untuk koneksi VPN.':'Scan QR menggunakan V2Box, atau salin link lalu import dari clipboard.';
        $('expires').textContent=new Date(o.access.expire*1000).toLocaleString('id-ID');
        if(lastAccess!==JSON.stringify(o.access)){
          lastAccess=JSON.stringify(o.access);$('config-choice').replaceChildren(...o.access.links.map((_,i)=>new Option(`Config ${i+1}/${o.access.links.length}`,i)));
          $('config-choice').onchange=()=>showQr(Number($('config-choice').value));await showQr(0);
        }
      }
      if(o.provision_status==='CONFLICT')$('status').textContent='Pembayaran sudah tercatat, tetapi username perlu diperiksa admin. Jangan membayar ulang; simpan nomor pesanan.';
      $('error').textContent='';
      if(!o.access && !['EXPIRED','FAILED','REFUND'].includes(o.payment_status))timer=setTimeout(poll,o.method==='MANUAL'?15000:5000);
    }catch(e){$('error').textContent=e.message;timer=setTimeout(poll,15000);}
  }
  window.addEventListener('pagehide',()=>{clearTimeout(timer);if(qrObject)URL.revokeObjectURL(qrObject);});
  poll();
})();
