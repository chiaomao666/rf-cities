import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameLogin} from './login.mjs';
const env={RF_USER_ID:'42',RF_LOGIN_EMAIL:'collector@example.com',RF_LOGIN_PASSWORD:'private-password'};
const reply=()=>({ok:true,json:async()=>({status:'ok',data:{user_id:42,user_token:'new-valid-token-123456'}})});

test('未設定帳密時維持手動憑證模式',()=>{
  assert.equal(createGameLogin({env:{RF_USER_ID:'42'}}),null);
});
test('自動登入只接受原採集帳號，成功也有冷卻',async()=>{
  let time=1000,calls=0;
  const login=createGameLogin({env,now:()=>time,fetchImpl:async(url,options)=>{
    calls++;assert.equal(url,'https://api.komisureiya.com/api/users/log_in');
    assert.equal(options.redirect,'error');assert.equal(new URLSearchParams(options.body).get('user[email]'),env.RF_LOGIN_EMAIL);
    return reply();
  }});
  assert.equal(await login(),'new-valid-token-123456');
  await assert.rejects(login(),/冷卻/);assert.equal(calls,1);
  time+=900000;await login();assert.equal(calls,2);
});
test('帳號不符拒絕更新；網路錯誤不洩漏原始資訊',async()=>{
  const login=createGameLogin({env,fetchImpl:async()=>({ok:true,json:async()=>({status:'ok',data:{user_id:999,user_token:'other-token-123456'}})})});
  await assert.rejects(login(),/ID 不符/);
  const failed=createGameLogin({env,fetchImpl:async()=>{throw new Error('private-password token secret');}});
  await assert.rejects(failed(),error=>error.message==='自動登入連線或回應失敗，稍後重試');
});
test('429 尊重 Retry-After，避免反覆登入',async()=>{
  let time=0,calls=0;
  const login=createGameLogin({env,now:()=>time,fetchImpl:async()=>{
    calls++;return {ok:false,status:429,headers:new Headers({'retry-after':'3600'})};
  }});
  await assert.rejects(login(),/HTTP 429/);
  time=900000;await assert.rejects(login(),/冷卻/);assert.equal(calls,1);
  time=3600000;await assert.rejects(login(),/HTTP 429/);assert.equal(calls,2);
});
