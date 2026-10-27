import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../../public/studyhub/api.js';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
test('CSRF token and same-origin credentials accompany mutations',async()=>{
  const calls=[];const api=createApi(async(path,options)=>{calls.push({path,options});return json(path==='/api/session'?{user:null,csrfToken:'test-token'}:{ok:true});});
  await api.request('/api/session');await api.request('/api/auth/login',{method:'POST',body:{email:'qa@example.invalid',password:'test-only'}});
  assert.equal(calls[1].options.headers['X-CSRF-Token'],'test-token');
  assert.equal(calls[1].options.credentials,'same-origin');
  assert.equal(JSON.parse(calls[1].options.body).email,'qa@example.invalid');
});
test('server errors reject instead of reporting save success',async()=>{
  const api=createApi(async()=>json({error:{message:'Conflict',code:'VERSION_CONFLICT'}},409));
  await assert.rejects(api.request('/api/lessons/a/attendance',{method:'PUT',body:{}}),error=>error.status===409&&error.message==='Conflict');
});
test('HTML fallback is not accepted as a successful API response',async()=>{
  const api=createApi(async()=>new Response('<html>login</html>',{headers:{'Content-Type':'text/html'}}));
  await assert.rejects(api.request('/api/session'),/некорректный ответ/);
});
test('multipart uploads let the browser provide the boundary',async()=>{
  let options;const api=createApi(async(_path,opts)=>{options=opts;return json({ok:true});});const data=new FormData();data.append('file',new Blob(['SELECT 1;']),'test.sql');
  await api.request('/api/assignments/a/submission',{method:'POST',body:data});
  assert.equal(options.body,data);assert.equal(options.headers['Content-Type'],undefined);
});
test('client does not accept arbitrary external API destinations',async()=>{
  await assert.rejects(createApi().request('https://example.invalid/api/session'),/Некорректный адрес/);
});
