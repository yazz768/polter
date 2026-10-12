const axios = require('axios');
const { createHmac, timingSafeEqual } = require('node:crypto');
const { PLAN, problem } = require('./store');

function createTripay(env, http = axios) {
  const mode=env.TRIPAY_MODE || 'sandbox';
  if (!['sandbox','production'].includes(mode)) throw new Error('TRIPAY_MODE harus sandbox atau production.');
  const enabled=env.PAYMENTS_ENABLED === 'true';
  const base=mode==='production'?'https://tripay.co.id/api':'https://tripay.co.id/api-sandbox';
  const origin=env.PUBLIC_BASE_URL?.replace(/\/$/,'');
  const configured=['TRIPAY_API_KEY','TRIPAY_PRIVATE_KEY','TRIPAY_MERCHANT_CODE'].every(k=>env[k] && !/your_|anda|contoh|xxx|replace/i.test(env[k]));
  if (enabled) {
    if (!configured) throw new Error('Kredensial Tripay belum lengkap. Pembayaran tetap harus dibekukan.');
    const url=new URL(origin);
    if (url.protocol!=='https:' || url.username || url.password || url.pathname!=='/' || url.search || url.hash) throw new Error('PUBLIC_BASE_URL harus origin HTTPS publik.');
  }
  function requireEnabled() { if (!enabled) throw problem('Pembayaran online sedang dinonaktifkan. Silakan kembali nanti.',503); }
  async function request(method,path,options={}) {
    requireEnabled();
    try {
      const response=await http.request({method,url:base+path,headers:{Authorization:`Bearer ${env.TRIPAY_API_KEY}`},timeout:20000,maxRedirects:0,...options});
      if (response.data?.success!==true || !response.data.data) throw new Error('Gateway rejected request');
      return response.data.data;
    } catch { throw problem('Gateway pembayaran belum dapat dihubungi. Pesanan tetap tersimpan; jangan membuat pembayaran kedua.',502); }
  }
  async function channels() { return (await request('GET','/merchant/payment-channel')).filter(x=>x.active===true || x.active===1); }
  async function create(order) {
    const signature=createHmac('sha256',env.TRIPAY_PRIVATE_KEY).update(env.TRIPAY_MERCHANT_CODE+order.id+order.amount).digest('hex');
    return request('POST','/transaction/create',{data:{
      method:order.method,merchant_ref:order.id,amount:order.amount,
      customer_name:order.name,customer_email:order.email,customer_phone:order.phone,
      order_items:[{sku:PLAN.id,name:PLAN.name,price:order.amount,quantity:1}],
      callback_url:origin+'/api/tripay/callback',return_url:origin+'/success.html?order='+order.id,
      expired_time:Math.floor(Date.now()/1000)+3600,signature
    }});
  }
  async function detail(reference) { return request('GET','/transaction/detail',{params:{reference}}); }
  async function find(id) {
    const results=await request('GET','/merchant/transactions',{params:{merchant_ref:id,per_page:50}});
    const matches=results.filter(r=>r.merchant_ref===id);
    if(matches.length>1) throw problem('Referensi pembayaran ganda perlu diperiksa admin.',409);
    return matches[0] ? detail(matches[0].reference) : null;
  }
  function verify(raw,signature,event) {
    if (!enabled || event!=='payment_status' || !Buffer.isBuffer(raw) || !/^[a-f0-9]{64}$/i.test(signature||'')) return false;
    const expected=createHmac('sha256',env.TRIPAY_PRIVATE_KEY).update(raw).digest();
    return timingSafeEqual(expected,Buffer.from(signature,'hex'));
  }
  return {mode,enabled,channels,create,detail,find,verify};
}
module.exports={createTripay};
