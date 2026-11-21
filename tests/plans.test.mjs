import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../worker/index.js';
import {createLocalEnv} from '../scripts/local-env.mjs';
const extra=await import('data:text/javascript;base64,'+Buffer.from(readFileSync('worker/index.js','utf8')+'\nexport {momentMillis,zonedMoment,parseReminderInput,dispatchReminderJobs};').toString('base64'));
function fixture(){const local=createLocalEnv();const call=(path,method='GET',body,owner='alice')=>worker.fetch(new Request('https://notebook.test/api'+path,{method,headers:{'Content-Type':'application/json',...(owner?{'oai-authenticated-user-id':owner}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),local.env);const link=(owner='alice',id='111')=>local.sqlite.prepare('INSERT INTO tg_links (owner,telegram_id) VALUES (?,?)').run(owner,id);return {...local,call,link};}
const future=()=>extra.zonedMoment(Date.now()+3600000,'Europe/Moscow');
test('places persist per diary, validate links and choose a meeting without leaking other profiles',async()=>{
 const {call,close}=fixture();try{
  assert.equal((await call('/places','GET',undefined,null)).status,401);
  const profile=await(await call('/profiles','POST',{name:'Саша'})).json();
  const place=await(await call('/places','POST',{name:'Тихая кофейня',address:'Улица, 10',url:'https://example.com',profileIds:[profile.id],notes:'Любимый столик',status:'want'})).json();
  assert.equal((await(await call('/places')).json()).places.length,1);
  assert.equal((await call('/places/'+place.id,'GET',undefined,'bob')).status,404);
  assert.equal((await call('/places/'+place.id,'PATCH',{name:'Чужое'},'bob')).status,404);
  assert.equal((await call('/places/'+place.id,'DELETE',undefined,'bob')).status,404);
  assert.equal((await call('/places','POST',{name:'X',url:'javascript:alert(1)'})).status,400);
  assert.equal((await call('/places','POST',{name:'X',profileIds:[profile.id]},'bob')).status,404);
  const planned=await(await call('/places/'+place.id+'/plan','POST',{profileId:profile.id})).json();assert.equal(planned.meetingPlace,'Тихая кофейня · Улица, 10');
  const visited=await(await call('/places/'+place.id,'PATCH',{status:'visited',visitedAt:'2026-11-21',favorite:true})).json();assert(visited.favorite);assert.equal(visited.status,'visited');
  assert.equal((await call('/places/'+place.id,'DELETE')).status,200);assert.equal((await(await call('/profiles/'+profile.id)).json()).meetingPlace,planned.meetingPlace);
 }finally{close();}
});
test('reminder time conversion handles midnight, different timezones and nonexistent DST time',()=>{
 assert.equal(extra.momentMillis('2026-11-21T18:00','Europe/Moscow'),Date.parse('2026-11-21T15:00:00Z'));
 assert.equal(extra.momentMillis('2026-11-21T18:00','Asia/Yekaterinburg'),Date.parse('2026-11-21T13:00:00Z'));
 assert.throws(()=>extra.momentMillis('2027-03-28T02:30','Europe/Berlin'),/не существует/);
 assert.throws(()=>extra.momentMillis('2026-02-30T18:00','Europe/Moscow'));
 const reference=Date.parse('2026-11-20T20:50:00Z');
 assert.deepEqual(extra.parseReminderInput('завтра в 18:00 забронировать столик','Europe/Moscow',reference),{dueAt:'2026-11-21T18:00',text:'забронировать столик'});
 assert.equal(extra.parseReminderInput('через 20 минут прислать книгу','Europe/Moscow',reference).dueAt,'2026-11-21T00:10');
 assert.equal(extra.parseReminderInput('через 20 минут прислать книгу','Europe/Moscow',reference+40000).dueAt,'2026-11-21T00:11');
});
test('queue respects cancellation, pause, ownership, link and future due times; successful delivery is not repeated',async()=>{
 const {call,env,sqlite,link,close}=fixture();const native=globalThis.fetch;const sent=[];
 globalThis.fetch=async(url,options)=>{assert(String(url).startsWith('https://api.telegram.org/botTEST/'));sent.push(JSON.parse(options.body));return new Response(JSON.stringify({ok:true,result:{message_id:1}}));};env.TELEGRAM_BOT_TOKEN='TEST';
 try{
  assert.equal((await call('/reminders','POST',{text:'Без привязки',dueAt:future()})).status,400);link();link('bob','222');
  const created=await(await call('/reminders','POST',{text:'Забронировать столик',dueAt:future(),timezone:'Europe/Moscow'})).json();
  assert.equal((await call('/reminders/'+created.id,'PATCH',{done:true},'bob')).status,404);
  assert.equal((await(await call('/reminders','GET',undefined,'bob')).json()).reminders.length,0);
  assert.equal((await extra.dispatchReminderJobs(env)).sent,0);
  sqlite.prepare('UPDATE reminder_jobs SET due_at=? WHERE id=?').run(Date.now()-1000,created.id);
  await call('/notification-preferences','POST',{enabled:false});assert.equal((await extra.dispatchReminderJobs(env)).sent,0);
  await call('/notification-preferences','POST',{enabled:true});const results=await Promise.all([extra.dispatchReminderJobs(env),extra.dispatchReminderJobs(env)]);assert.equal(results.reduce((n,x)=>n+x.sent,0),1);assert.equal(sent.length,1);assert.equal(sent[0].chat_id,'111');assert(sent[0].text.includes('Забронировать столик'));
  await extra.dispatchReminderJobs(env);assert.equal(sent.length,1);assert.equal((await(await call('/reminders')).json()).reminders[0].status,'sent');
  const cancelled=await(await call('/reminders','POST',{text:'Не отправлять',dueAt:future()})).json();await call('/reminders/'+cancelled.id,'PATCH',{done:true});sqlite.prepare('UPDATE reminder_jobs SET due_at=? WHERE id=?').run(Date.now()-1000,cancelled.id);await extra.dispatchReminderJobs(env);assert.equal(sent.length,1);
  const orphan=await(await call('/reminders','POST',{text:'Без связи',dueAt:future()})).json();sqlite.prepare('UPDATE reminder_jobs SET due_at=? WHERE id=?').run(Date.now()-1000,orphan.id);await call('/telegram/server','DELETE');await extra.dispatchReminderJobs(env);assert.equal(sent.length,1);
 }finally{globalThis.fetch=native;close();}
});
test('profile reminders cancel when completed or profile removed, and failed sends retry',async()=>{
 const {call,env,sqlite,link,close}=fixture();const original=globalThis.fetch;env.TELEGRAM_BOT_TOKEN='TEST';let broken=true;globalThis.fetch=async()=>new Response(JSON.stringify(broken?{ok:false,error_code:403}:{ok:true,result:{message_id:1}}));
 try{link();const profile=await(await call('/profiles','POST',{name:'Макс'})).json();
 const saved=await(await call('/profiles/'+profile.id+'/memories','POST',{action:'remind',text:'Книга',dueAt:future(),telegram:true,timezone:'Europe/Moscow'})).json();const id=saved.reminders[0].id;
 await call('/profiles/'+profile.id+'/memories','POST',{action:'reminder_done',reminderId:id,done:true});assert.equal(sqlite.prepare('SELECT status FROM reminder_jobs WHERE id=?').get(id).status,'cancelled');
 const r=await(await call('/reminders','POST',{text:'Повтор',dueAt:future(),profileId:profile.id})).json();sqlite.prepare('UPDATE reminder_jobs SET due_at=? WHERE id=?').run(Date.now()-1000,r.id);assert.equal((await extra.dispatchReminderJobs(env)).failed,1);assert.equal(sqlite.prepare('SELECT attempts FROM reminder_jobs WHERE id=?').get(r.id).attempts,1);
 broken=false;assert.equal((await extra.dispatchReminderJobs(env,Date.now()+600000)).sent,1);
 await call('/profiles/'+profile.id,'DELETE');assert.equal(sqlite.prepare('SELECT done FROM reminder_jobs WHERE id=?').get(r.id).done,1);
 }finally{globalThis.fetch=original;close();}
});
test('scheduler requires a valid GitHub signature and the exact repository, workflow, branch and audience',async()=>{
 const {env,close}=fixture(),original=globalThis.fetch;env.TELEGRAM_BOT_TOKEN='TEST';
 const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);jwk.kid='local-test';
 globalThis.fetch=async(url)=>{assert.equal(String(url),'https://token.actions.githubusercontent.com/.well-known/jwks');return new Response(JSON.stringify({keys:[jwk]}));};
 const seconds=Math.floor(Date.now()/1000),claims={iss:'https://token.actions.githubusercontent.com',aud:'https://closeby-notebook-k7m4.finiterose64.chatgpt.site',repository_id:'1465561990',repository:'timofeyvetvinsky/girls',ref:'refs/heads/main',workflow_ref:'timofeyvetvinsky/girls/.github/workflows/telegram-reminders.yml@refs/heads/main',event_name:'schedule',exp:seconds+300,iat:seconds,nbf:seconds-1};
 const token=async(change={})=>{const h=Buffer.from(JSON.stringify({alg:'RS256',kid:'local-test'})).toString('base64url'),p=Buffer.from(JSON.stringify({...claims,...change})).toString('base64url'),s=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(h+'.'+p));return h+'.'+p+'.'+Buffer.from(s).toString('base64url');};
 const run=(value,method='POST')=>worker.fetch(new Request('https://notebook.test/api/system/dispatch-reminders',{method,headers:{Authorization:'Bearer '+value}}),env);
 try{assert.equal((await run('')).status,401);assert.equal((await run(await token(),'GET')).status,405);
 for(const bad of [{aud:'bad'},{repository_id:'2'},{repository:'evil/fork'},{ref:'refs/heads/other'},{event_name:'pull_request'},{workflow_ref:'other'},{exp:seconds-1},{iat:seconds-1000}])assert.equal((await run(await token(bad))).status,401);
 const legit=await token();assert.equal((await run(legit.slice(0,-5)+'aaaaa')).status,401);const accepted=await run(legit);assert.equal(accepted.status,200);assert.deepEqual(await accepted.json(),{sent:0,failed:0,checked:0});
 }finally{globalThis.fetch=original;close();}
});
test('bot buttons add and edit places and natural-language reminders, preserving idempotency when replies fail',async()=>{
 const {call,env,sqlite,link,close}=fixture();const original=globalThis.fetch;let failReply=false;const replies=[];env.TELEGRAM_BOT_TOKEN='TEST';env.TELEGRAM_WEBHOOK_SECRET='test-secret';link();
 globalThis.fetch=async(url,options)=>{replies.push(JSON.parse(options.body));if(failReply)throw Error('offline');return new Response(JSON.stringify({ok:true,result:{message_id:1}}));};
 const send=(id,text)=>worker.fetch(new Request('https://notebook.test/api/telegram/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':'test-secret'},body:JSON.stringify({update_id:id,message:{from:{id:111},chat:{id:111,type:'private'},text}})}),env);
 try{await send(1,'➕ Добавить место');await send(2,'Кофейня | Улица, 7 | https://example.com');let places=(await(await call('/places')).json()).places;assert.equal(places.length,1);
 await send(3,'✅ Уже были');assert.equal((await(await call('/places')).json()).places[0].status,'visited');
 await send(4,'Заметки о месте');await send(5,'Уютно вечером');assert.equal((await(await call('/places')).json()).places[0].notes,'Уютно вечером');
 await send(6,'⏰ Напомнить');failReply=true;assert.equal((await send(7,'через 20 минут заказать столик')).status,503);failReply=false;assert.equal((await send(7,'через 20 минут заказать столик')).status,200);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM reminder_jobs').get().n,1);
 await send(8,'/reminders');assert(replies.at(-1).text.includes('заказать столик'));
 }finally{globalThis.fetch=original;close();}
});

test('backup restores places and reminder history without scheduling duplicate sends',async()=>{
 const {call,env,sqlite,link,close}=fixture();try{link();
 const p=await(await call('/profiles','POST',{name:'Копия'})).json();
 const r=await call('/import-plans','POST',{places:[{name:'Сквер',kind:'walk',profileIds:['old-profile']}],reminders:[{text:'Архивная задача',due_local:'2026-01-01T18:00',timezone:'Europe/Moscow',profile_id:'old-profile'}],profileMap:{'old-profile':p.id}});assert.equal(r.status,200);
 assert.equal((await(await call('/places')).json()).places[0].profileIds[0],p.id);const row=sqlite.prepare('SELECT * FROM reminder_jobs').get();assert.equal(row.status,'cancelled');assert.equal(row.done,1);
 await call('/profiles/'+p.id,'DELETE');const place=(await(await call('/places')).json()).places[0];assert.deepEqual(place.profileIds,[]);assert.equal((await call('/places/'+place.id,'PATCH',{favorite:true})).status,200);
 }finally{close();}
});

test('compact bot choices hide IDs, select duplicate names correctly and reject expired or replaced choices',async()=>{
 const {call,env,sqlite,link,close}=fixture();const original=globalThis.fetch;const replies=[];env.TELEGRAM_BOT_TOKEN='TEST';env.TELEGRAM_WEBHOOK_SECRET='test-secret';link();
 globalThis.fetch=async(url,options)=>{replies.push(JSON.parse(options.body));return new Response(JSON.stringify({ok:true,result:{message_id:1}}));};let id=2000;
 const send=text=>worker.fetch(new Request('https://notebook.test/api/telegram/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':'test-secret'},body:JSON.stringify({update_id:id++,message:{from:{id:111},chat:{id:111,type:'private'},text}})}),env);
 try{
  const a=await(await call('/profiles','POST',{name:'Саша'})).json();const b=await(await call('/profiles','POST',{name:'Саша'})).json();
  await send('/menu');const main=replies.at(-1).reply_markup.keyboard;assert.equal(main.length,5);assert(main.flat().find(x=>x.web_app)?.web_app.url.startsWith('https://closeby-notebook-'));assert(main.flat().every(x=>!x.icon_custom_emoji_id));
  await send('⚙️ Настройки');assert(replies.at(-1).reply_markup.keyboard.flat().some(x=>x.text==='⚙️ Режим'));
  await send('/list');const choices=replies.at(-1).reply_markup.keyboard.flat().filter(x=>x.text.startsWith('👤 '));assert.equal(choices.length,2);assert(!choices.some(x=>/[a-f0-9]{8}-[a-f0-9]{4}-/.test(x.text)));assert.notEqual(choices[0].text,choices[1].text);
  const map=JSON.parse(sqlite.prepare('SELECT flow FROM tg_links').get().flow.slice('choices:profile:'.length));await send(choices[1].text);assert.equal(sqlite.prepare('SELECT selected_id FROM tg_links').get().selected_id,map[1].id);
  await send('/list');const expired=replies.at(-1).reply_markup.keyboard.flat().find(x=>x.text.startsWith('👤 ')).text;sqlite.prepare('UPDATE tg_links SET flow_until=0').run();await send(expired);assert(replies.at(-1).text.includes('истекло'));assert.equal((await(await call('/profiles/'+map[1].id)).json()).notes.length,0);
  await call('/places','POST',{name:'Кофейня'});await send('/places');const choice=replies.at(-1).reply_markup.keyboard.flat().find(x=>x.text.startsWith('📍 ')).text;assert(!choice.includes((await(await call('/places')).json()).places[0].id));await send(choice);assert(replies.at(-1).text.includes('Кофейня'));
  const r=await(await call('/reminders','POST',{text:'Забронировать столик',dueAt:future()})).json();await send('/reminders');const done=replies.at(-1).reply_markup.keyboard.flat().find(x=>x.text.startsWith('✓ Готово: '));assert(done);assert.equal(done.style,'success');assert(!done.text.includes(r.id));await send(done.text);assert.equal(sqlite.prepare('SELECT done FROM reminder_jobs WHERE id=?').get(r.id).done,1);
 }finally{globalThis.fetch=original;close();}
});
