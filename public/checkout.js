const dialog=document.querySelector('#subscription-dialog');
const product=document.querySelector('#product-dialog');
const form=document.querySelector('#manual-form');
const status=document.querySelector('#tripay-status');
const submit=form.querySelector('button[type=submit]');
let available=false;
const contactInput=form.elements.contact;
const contactValues={email:'',phone:''};let currentContactType='email';
form.elements.contactType.addEventListener('change',()=>{
  contactValues[currentContactType]=contactInput.value;
  currentContactType=form.elements.contactType.value;
  const phone=currentContactType==='phone';
  contactInput.type=phone?'tel':'email';contactInput.autocomplete=phone?'tel':'email';
  contactInput.maxLength=phone?30:254;contactInput.placeholder=phone?'08xxxxxxxxxx':'contoh@gmail.com';
  contactInput.value=contactValues[currentContactType];
  document.querySelector('#contact-label').textContent=phone?'Nomor HP':'Email';
});
const resume=document.querySelector('#resume-order');
function orderUrl(id,key){return '/success.html?order='+encodeURIComponent(id)+'#key='+key;}
try {const last=JSON.parse(localStorage.getItem('polter-last-order')||'null');if(last?.id && /^[a-f0-9]{64}$/.test(last.key)){resume.href=orderUrl(last.id,last.key);resume.hidden=false;}}catch{}
document.querySelectorAll('[data-open-subscription]').forEach(button=>button.addEventListener('click',()=>{if(product.open)product.close();dialog.showModal();}));
document.querySelector('[data-open-product]').addEventListener('click',()=>product.showModal());
document.querySelector('[data-close-product]').addEventListener('click',()=>product.close());
document.querySelector('[data-close-subscription]').addEventListener('click',()=>dialog.close());
for(const item of [dialog,product])item.addEventListener('click',event=>{if(event.target===item)item.close();});
fetch('/api/public-config').then(r=>r.json()).then(config=>{
  available=config.manualEnabled===true;submit.disabled=!available;
  status.textContent=available?'':'Pemesanan belum dibuka. Admin sedang menyiapkan layanan.';
  document.querySelectorAll('a[href^="https://wa.me/"]').forEach(a=>{
    if(config.adminWhatsapp)a.href='https://wa.me/'+config.adminWhatsapp+'?text='+encodeURIComponent('Halo admin Polter VPN, saya ingin bertanya tentang layanan VPN.');
    else {a.removeAttribute('href');a.setAttribute('aria-disabled','true');}
  });
}).catch(()=>{status.textContent='Website belum tersambung ke server. Muat ulang halaman.';});
form.addEventListener('submit',async event=>{
  event.preventDefault();if(!available)return;
  submit.disabled=true;status.textContent='Menyimpan pesanan sebelum membuka WhatsApp...';
  try {
    let key=localStorage.getItem('polter-manual-pending');
    if(!/^[a-f0-9]{64}$/.test(key||'')) {key=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');localStorage.setItem('polter-manual-pending',key);}
    // Recover a prior successful request if the response was lost.
    const previous=await fetch('/api/my-order',{headers:{'X-Order-Key':key}});
    let result;
    if(previous.ok)result=await previous.json();
    else {
      if(previous.status!==404)throw new Error('Pesanan belum dapat diperiksa. Coba lagi sebentar.');
      const response=await fetch('/api/manual/orders',{method:'POST',headers:{'Content-Type':'application/json','X-Order-Key':key},body:JSON.stringify({username:form.elements.username.value,contactType:form.elements.contactType.value,contact:contactInput.value})});
      result=await response.json();if(!response.ok)throw new Error(result.message||'Pesanan gagal disimpan.');
    }
    const id=result.order.id;
    localStorage.setItem('polter-order-'+id,key);
    localStorage.setItem('polter-last-order',JSON.stringify({id,key}));
    localStorage.removeItem('polter-manual-pending');
    const url=orderUrl(id,key);
    // Back from WhatsApp lands on the private order page, not a second checkout.
    if(result.whatsapp_url){history.replaceState(null,'',url);location.assign(result.whatsapp_url);}
    else location.assign(url);
  }catch(error){status.textContent=error.message||'Gagal menyimpan pesanan. Pastikan penyimpanan browser diizinkan, lalu coba lagi.';submit.disabled=false;}
});
