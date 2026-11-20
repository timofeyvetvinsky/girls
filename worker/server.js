const STAGES=['new','chat','date','close','pause','archive'];
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const now=()=>new Date().toISOString();
const str=(v,max=10000)=>typeof v==='string'?v.trim().slice(0,max):'';
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(v=>v.toString(16).padStart(2,'0')).join('');
function clean(raw,existing={}) {
 const p={...existing};
 for(const [k,max] of Object.entries({name:120,city:120,contact:300,source:150,birthday:10,likes:5000,avoid:5000,about:10000,meetingAt:16,meetingPlace:300,archiveReason:500})) if(k in raw)p[k]=str(raw[k],max);
 if(!p.name)fail('Добавьте имя.');
 if('age' in raw){p.age=raw.age===''||raw.age==null?'':Number(raw.age);if(p.age!==''&&(!Number.isInteger(p.age)||p.age<18||p.age>120))fail('Возраст: от 18 до 120 лет.');}
 if('birthday' in raw&&p.birthday&&(!/^\d{4}-\d{2}-\d{2}$/.test(p.birthday)||!validDate(p.birthday)))fail('Проверьте дату рождения.');
 if('meetingAt' in raw&&p.meetingAt&&(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(p.meetingAt)||!validDate(p.meetingAt.slice(0,10))||Number(p.meetingAt.slice(11,13))>23||Number(p.meetingAt.slice(14))>59))fail('Проверьте время встречи.');
 if('stage' in raw){if(!STAGES.includes(raw.stage))fail('Неизвестный статус.');p.stage=raw.stage;}
 p.stage ||= 'new';
 if('favorite' in raw)p.favorite=!!raw.favorite;
 if('tags' in raw)p.tags=Array.isArray(raw.tags)?[...new Set(raw.tags.map(v=>str(v,50)).filter(Boolean))].slice(0,20):[];
 p.notes=existing.notes||[];
 p.createdAt=existing.createdAt||now();p.updatedAt=now();
 return p;
}
function validDate(value){const date=new Date(value+'T12:00:00Z');return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;}
function imported(raw){const p=clean(raw);if(!Array.isArray(raw.notes||[]))fail('Неверный формат заметок.');p.notes=(raw.notes||[]).slice(0,2000).map(n=>{if(!str(n.text)||!Number.isFinite(Date.parse(n.createdAt)))fail('Повреждённая заметка в копии.');return {id:crypto.randomUUID(),text:str(n.text),createdAt:new Date(n.createdAt).toISOString()};});if(Number.isFinite(Date.parse(raw.createdAt)))p.createdAt=new Date(raw.createdAt).toISOString();return p;}
async function all(env,owner){const r=await env.DB.prepare('SELECT id,data FROM profiles WHERE owner=? ORDER BY updated_at DESC').bind(owner).all();return r.results.map(r=>({...JSON.parse(r.data),id:r.id}));}
async function get(env,owner,id){const row=await env.DB.prepare('SELECT data FROM profiles WHERE owner=? AND id=?').bind(owner,id).first();if(!row)fail('Анкета не найдена.',404);return {...JSON.parse(row.data),id};}
async function save(env,owner,p){await env.DB.prepare('INSERT INTO profiles (id,owner,data,updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at WHERE profiles.owner=excluded.owner').bind(p.id,owner,JSON.stringify(p),p.updatedAt).run();return p;}
async function remove(env,owner,id){await get(env,owner,id);const photos=await env.DB.prepare('SELECT object_key FROM photos WHERE owner=? AND profile_id=?').bind(owner,id).all();for(const p of photos.results)await env.BUCKET.delete(p.object_key);await env.DB.batch([env.DB.prepare('DELETE FROM photos WHERE owner=? AND profile_id=?').bind(owner,id),env.DB.prepare('DELETE FROM profiles WHERE owner=? AND id=?').bind(owner,id)]);}
async function photoList(env,owner,id){return (await env.DB.prepare('SELECT id,mime,created_at FROM photos WHERE owner=? AND profile_id=? ORDER BY created_at').bind(owner,id).all()).results;}
async function addPhoto(env,owner,id,file){await get(env,owner,id);if((await photoList(env,owner,id)).length>=20)fail('В анкете может быть до 20 фото.');if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type))fail('Выберите JPG, PNG или WebP.');if(file.size>10*1024*1024)fail('Фото должно быть меньше 10 МБ.');const bytes=new Uint8Array(await file.arrayBuffer());const valid=file.type==='image/jpeg'?bytes[0]===255&&bytes[1]===216:file.type==='image/png'?bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71:String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';if(!valid)fail('Содержимое файла не соответствует изображению.');const pid=crypto.randomUUID(),key=owner+'/'+id+'/'+pid;await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:file.type}});try{await env.DB.prepare('INSERT INTO photos (id,owner,profile_id,object_key,mime,created_at) VALUES (?,?,?,?,?,?)').bind(pid,owner,id,key,file.type,now()).run();}catch(e){await env.BUCKET.delete(key);throw e;}return {id:pid,mime:file.type};}
async function withPhotos(env,owner,p){return {...p,photos:await photoList(env,owner,p.id)};}
async function botOwner(req,env){const token=req.headers.get('Authorization')?.replace(/^Bearer /,'');if(!token)fail('Нет ключа подключения.',401);const c=await env.DB.prepare('SELECT owner FROM bot_connections WHERE token_hash=?').bind(await hash(token)).first();if(!c)fail('Ключ подключения недействителен.',401);return c.owner;}
async function botAction(env,owner,b){
 if(b.action==='list')return {profiles:await Promise.all((await all(env,owner)).map(p=>withPhotos(env,owner,p)))};
 if(b.action==='create')return {profile:await save(env,owner,{...clean(b.profile||{}),id:crypto.randomUUID()})};
 if(b.action==='import')return {profile:await save(env,owner,{...imported(b.profile||{}),id:crypto.randomUUID()})};
 if(b.action==='heartbeat'){await env.DB.prepare('UPDATE bot_connections SET last_seen=?,username=? WHERE owner=?').bind(now(),str(b.username,80),owner).run();return {ok:true};}
 const p=await get(env,owner,str(b.id,80));
 if(b.action==='get')return {profile:await withPhotos(env,owner,p)};
 if(b.action==='update')return {profile:await save(env,owner,clean(b.profile||{},p))};
 if(b.action==='note'){const text=str(b.text);if(!text)fail('Заметка пустая.');p.notes.unshift({id:crypto.randomUUID(),text,createdAt:now()});p.updatedAt=now();return {profile:await save(env,owner,p)};}
 if(b.action==='delete'){await remove(env,owner,p.id);return {ok:true};}
 fail('Неизвестная команда.');
}
export default {async fetch(req,env){
 try{
 const url=new URL(req.url),path=url.pathname;
 if(path==='/assets/neon-woman-v2.jpg')return new Response(Uint8Array.from(atob(NEON_JPEG),c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/jpeg','Cache-Control':'public,max-age=31536000,immutable','X-Content-Type-Options':'nosniff'}});
 if(path==='/favicon.ico')return new Response(null,{status:204});
 if(path==='/downloads/telegram-bot.mjs')return new Response(BOT_SOURCE,{headers:{'Content-Type':'text/javascript; charset=utf-8','Content-Disposition':'attachment; filename="telegram-bot.mjs"','Cache-Control':'no-store'}});
 if(!path.startsWith('/api/'))return new Response(path!=='/account'&&await accountIdentity(req,env)?PAGE:WELCOME,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'"}});
 if(!env.DB||!env.BUCKET)fail('Хранилище пока недоступно. Повторите позже.',503);
 if(Number(req.headers.get('Content-Length')||0)>12*1024*1024)fail('Слишком большой запрос.',413);
 if(path.startsWith('/api/auth/'))return await authRequest(req,env,path);
 let owner;
 if(path.startsWith('/api/bot/'))owner=await botOwner(req,env);
 else {owner=await accountIdentity(req,env);if(!owner)fail('Войдите в личный аккаунт.',401);if(!['GET','HEAD'].includes(req.method)&&req.headers.get('Origin')&&req.headers.get('Origin')!==url.origin)fail('Запрос отклонён.',403);}
 if(path==='/api/profiles'&&req.method==='GET')return json({profiles:await Promise.all((await all(env,owner)).map(p=>withPhotos(env,owner,p)))});
 if(path==='/api/profiles'&&req.method==='POST')return json(await withPhotos(env,owner,await save(env,owner,{...clean(await req.json()),id:crypto.randomUUID()})),201);
 if(path==='/api/import'&&req.method==='POST')return json(await withPhotos(env,owner,await save(env,owner,{...imported(await req.json()),id:crypto.randomUUID()})),201);
 let m=path.match(/^\/api\/profiles\/([^/]+)(?:\/(notes|photos))?$/);
 if(m){const id=m[1],sub=m[2];if(!sub&&req.method==='GET')return json(await withPhotos(env,owner,await get(env,owner,id)));if(!sub&&req.method==='PATCH'){const p=await get(env,owner,id);return json(await withPhotos(env,owner,await save(env,owner,clean(await req.json(),p))));}if(!sub&&req.method==='DELETE'){await remove(env,owner,id);return json({ok:true});}if(sub==='notes'&&req.method==='POST'){const r=await botAction(env,owner,{action:'note',id,text:(await req.json()).text});return json(r.profile);}if(sub==='photos'&&req.method==='POST'){const f=await req.formData();return json(await addPhoto(env,owner,id,f.get('file')),201);}}
 m=path.match(/^\/api\/(?:bot\/)?photos\/([^/]+)$/);
 if(m){const p=await env.DB.prepare('SELECT * FROM photos WHERE owner=? AND id=?').bind(owner,m[1]).first();if(!p)fail('Фото не найдено.',404);if(req.method==='DELETE'){await env.BUCKET.delete(p.object_key);await env.DB.prepare('DELETE FROM photos WHERE owner=? AND id=?').bind(owner,m[1]).run();return json({ok:true});}if(req.method==='GET'){const obj=await env.BUCKET.get(p.object_key);if(!obj)fail('Фото не найдено.',404);return new Response(obj.body,{headers:{'Content-Type':p.mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}}
 if(path==='/api/bot/upload'&&req.method==='POST'){const form=await req.formData();const updateId=str(form.get('updateId'),120);if(updateId){const old=await env.DB.prepare('SELECT result FROM bot_updates WHERE owner=? AND update_id=?').bind(owner,'photo-'+updateId).first();if(old)return json(JSON.parse(old.result));}const result=await addPhoto(env,owner,str(form.get('id'),80),form.get('file'));if(updateId)await env.DB.prepare('INSERT OR IGNORE INTO bot_updates (owner,update_id,result) VALUES (?,?,?)').bind(owner,'photo-'+updateId,JSON.stringify(result)).run();return json(result,201);}
 if(path==='/api/bot/action'&&req.method==='POST'){
 const b=await req.json();const updateId=str(b.updateId,120);
 if(updateId){const old=await env.DB.prepare('SELECT result FROM bot_updates WHERE owner=? AND update_id=?').bind(owner,updateId).first();if(old)return json(JSON.parse(old.result));}
 const result=await botAction(env,owner,b);
 if(updateId)await env.DB.prepare('INSERT OR IGNORE INTO bot_updates (owner,update_id,result) VALUES (?,?,?)').bind(owner,updateId,JSON.stringify(result)).run();
 return json(result);
 }
 if(path==='/api/telegram'&&req.method==='GET'){const c=await env.DB.prepare('SELECT last_seen,username FROM bot_connections WHERE owner=?').bind(owner).first();return json({configured:!!c,lastSeen:c?.last_seen||null,username:c?.username||null});}
 if(path==='/api/telegram'&&req.method==='POST'){const token=crypto.randomUUID()+crypto.randomUUID();await env.DB.prepare('INSERT INTO bot_connections (owner,token_hash) VALUES (?,?) ON CONFLICT(owner) DO UPDATE SET token_hash=excluded.token_hash,last_seen=NULL,username=NULL').bind(owner,await hash(token)).run();return json({token});}
 if(path==='/api/telegram'&&req.method==='DELETE'){await env.DB.prepare('DELETE FROM bot_connections WHERE owner=?').bind(owner).run();return json({ok:true});}
 fail('Маршрут не найден.',404);
 }catch(e){return json({error:e.status?e.message:'Не удалось выполнить действие. Попробуйте ещё раз.'},e.status||500);}
}};
