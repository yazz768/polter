const axios=require('axios');

function createAccounts(env, http=axios) {
  const mode=env.TRIPAY_MODE || 'sandbox';
  if(mode==='sandbox') return {
    mode, exists:async()=>false,
    provision:async order=>({username:order.username,expire:order.account_expire,links:[],simulated:true}),
    revoke:async()=>{}
  };
  const base=(env.MARZBAN_URL || '').replace(/\/$/,'');
  async function connect() {
    if(!base || !env.MARZBAN_ADMIN_USER || !env.MARZBAN_ADMIN_PASS) throw new Error('Marzban configuration missing');
    const login=await http.post(base+'/api/admin/token',new URLSearchParams({username:env.MARZBAN_ADMIN_USER,password:env.MARZBAN_ADMIN_PASS}),{timeout:15000,maxRedirects:0});
    if(!login.data?.access_token) throw new Error('Marzban login failed');
    return {headers:{Authorization:`Bearer ${login.data.access_token}`},timeout:15000,maxRedirects:0};
  }
  async function get(username,config) {
    try { return (await http.get(base+'/api/user/'+encodeURIComponent(username),config)).data; }
    catch(e) { if(e.response?.status===404)return null; throw e; }
  }
  function checkOwner(user,order) {
    if(user.username!==order.username || user.proxies?.vless?.id!==order.account_uuid || user.note!==`order:${order.id}`) {
      throw Object.assign(new Error('Username belongs to another account'),{code:'ACCOUNT_CONFLICT'});
    }
  }
  return {
    mode,
    async exists(username) { return Boolean(await get(username,await connect())); },
    async provision(order) {
      const config=await connect();
      let user=await get(order.username,config);
      if(!user) {
        try {
          user=(await http.post(base+'/api/user',{
            username:order.username,proxies:{vless:{id:order.account_uuid,flow:env.MARZBAN_VLESS_FLOW || ''}},
            inbounds:{vless:[env.MARZBAN_INBOUND_TAG || 'VLESS REALITY']},
            expire:order.account_expire,data_limit:order.quota*1024**3,data_limit_reset_strategy:'no_reset',
            status:'active',note:`order:${order.id}`
          },config)).data;
        } catch(e) { if(e.response?.status!==409)throw e; user=await get(order.username,config); }
      }
      checkOwner(user,order);
      if(user.status!=='active') throw new Error('Created account is not active');
      const links=(user.links || []).filter(link=>{
        try { const url=new URL(link);return url.protocol==='vless:' && decodeURIComponent(url.username)===order.account_uuid; } catch{return false;}
      });
      if(!links.length)throw new Error('No usable VLESS link');
      return {username:user.username,expire:user.expire,links,simulated:false};
    },
    async revoke(order) {
      const config=await connect();const user=await get(order.username,config);
      if(!user)return;
      checkOwner(user,order);
      await http.put(base+'/api/user/'+encodeURIComponent(order.username),{status:'disabled'},config);
    }
  };
}
module.exports={createAccounts};
