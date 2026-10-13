// 帳密只在採集主機使用；不公開原始回應、帳密或 token。
export function createGameLogin({env, fetchImpl=globalThis.fetch, now=Date.now}) {
  if (!env.RF_LOGIN_EMAIL || !env.RF_LOGIN_PASSWORD || !/^[1-9]\d*$/.test(String(env.RF_USER_ID || ''))) return null;
  let nextAllowedAt=0;
  return async () => {
    if (now()<nextAllowedAt) throw new Error('自動登入冷卻中，稍後重試');
    // 成功、失敗均限制每十五分鐘一次，避免帳密錯誤或官方故障時密集登入。
    nextAllowedAt=now()+15*60*1000;
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),12000);
    try {
      const response=await fetchImpl('https://api.komisureiya.com/api/users/log_in', {
        method:'POST', redirect:'error', signal:controller.signal,
        headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8',Accept:'application/json'},
        body:new URLSearchParams({'user[email]':env.RF_LOGIN_EMAIL.trim(),'user[password]':env.RF_LOGIN_PASSWORD,
          locale:env.RF_LOCALE || 'zh_TW',app_version:env.RF_APP_VERSION || '2.28',key:'t9cTpsbSCYcJgsrrC'}).toString(),
      });
      if (!response.ok) {
        if(response.status===429) {
          const retryAfter=response.headers?.get('retry-after');
          const seconds=Number(retryAfter);
          const retryAt=retryAfter && Number.isFinite(seconds) ? now()+Math.max(0,seconds)*1000 : Date.parse(retryAfter);
          if(Number.isFinite(retryAt))nextAllowedAt=Math.max(nextAllowedAt,retryAt);
        }
        throw new Error(`自動登入失敗（HTTP ${response.status}），稍後重試`);
      }
      const body=await response.json();
      const token=body?.data?.user_token;
      if(body?.status!=='ok' || String(body?.data?.user_id)!==String(env.RF_USER_ID)
        || typeof token!=='string' || token.length<16 || token.length>4096) {
        throw new Error('自動登入未成功或採集帳號 ID 不符，請檢查主機登入設定');
      }
      return token;
    } catch(error) {
      // fetch／JSON 解析錯誤可能含完整 URL 或回應，僅傳回已知安全訊息。
      if(/^自動登入/.test(error?.message || ''))throw error;
      throw new Error('自動登入連線或回應失敗，稍後重試');
    } finally {clearTimeout(timeout);}
  };
}
