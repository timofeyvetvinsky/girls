const PLACE_KINDS=['cafe','restaurant','walk','culture','other'];
function cleanPlace(raw,existing={}){
 const p={...existing};for(const [key,max]of Object.entries({name:150,city:120,address:1000,url:2000,notes:5000,visitedAt:10}))if(key in raw)p[key]=str(raw[key],max);
 if(!p.name)fail('Напиши название места.');
 if(p.url){let u;try{u=new URL(p.url);}catch{fail('Вставь полную ссылку, начиная с https://.');}if(!['https:','http:'].includes(u.protocol)||u.username||u.password)fail('Нужна обычная ссылка на сайт или карту.');p.url=u.href;}
 if('kind'in raw){if(!PLACE_KINDS.includes(raw.kind))fail('Выбери тип места.');p.kind=raw.kind;}p.kind||='cafe';
 if('status'in raw){if(!['want','visited'].includes(raw.status))fail('Выбери отметку места.');p.status=raw.status;}p.status||='want';
 if(p.visitedAt&&!validDate(p.visitedAt))fail('Проверь дату посещения.');
 if('favorite'in raw)p.favorite=!!raw.favorite;
 if('profileIds'in raw){if(!Array.isArray(raw.profileIds))fail('Проверь список знакомств.');p.profileIds=[...new Set(raw.profileIds.map(x=>str(x,80)).filter(Boolean))].slice(0,100);}p.profileIds||=[];
 p.createdAt=existing.createdAt||now();p.updatedAt=now();return p;
}
async function listPlaces(env,owner){return (await env.DB.prepare('SELECT id,data FROM places WHERE owner=? ORDER BY updated_at DESC').bind(owner).all()).results.map(r=>({...JSON.parse(r.data),id:r.id}));}
async function getPlace(env,owner,id){const r=await env.DB.prepare('SELECT data FROM places WHERE owner=? AND id=?').bind(owner,id).first();if(!r)fail('Место не найдено.',404);return {...JSON.parse(r.data),id};}
async function savePlace(env,owner,raw,id,creationId){if(!id&&creationId){const found=await env.DB.prepare('SELECT data FROM places WHERE owner=? AND id=?').bind(owner,creationId).first();if(found)return {...JSON.parse(found.data),id:creationId};}const existing=id?await getPlace(env,owner,id):{};const p=cleanPlace(raw,existing);for(const pid of p.profileIds)await get(env,owner,pid);if(!id&&(await listPlaces(env,owner)).length>=1000)fail('В дневнике уже 1000 мест.');p.id=id||creationId||crypto.randomUUID();await env.DB.prepare('INSERT INTO places (id,owner,data,updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at WHERE places.owner=excluded.owner').bind(p.id,owner,JSON.stringify(p),p.updatedAt).run();return p;}
async function placeInPlan(env,owner,id,profileId){const place=await getPlace(env,owner,id),p=await get(env,owner,profileId);return save(env,owner,clean({meetingPlace:[place.name,place.address||place.city].filter(Boolean).join(' · ').slice(0,300)},p));}
async function placesRequest(req,env,owner,path){
 if(path==='/api/places'&&req.method==='GET')return json({places:await listPlaces(env,owner)});
 if(path==='/api/places'&&req.method==='POST')return json(await savePlace(env,owner,await req.json()),201);
 const m=path.match(/^\/api\/places\/([^/]+)(\/plan)?$/);if(!m)return null;
 if(m[2]&&req.method==='POST')return json(await withPhotos(env,owner,await placeInPlan(env,owner,m[1],str((await req.json()).profileId,80))));
 if(!m[2]&&req.method==='GET')return json(await getPlace(env,owner,m[1]));
 if(!m[2]&&req.method==='PATCH')return json(await savePlace(env,owner,await req.json(),m[1]));
 if(!m[2]&&req.method==='DELETE'){await getPlace(env,owner,m[1]);await env.DB.prepare('DELETE FROM places WHERE owner=? AND id=?').bind(owner,m[1]).run();return json({ok:true});}return null;
}
async function importPlans(env,owner,b){
 const places=b.places||[],reminders=b.reminders||[];if(!Array.isArray(places)||places.length>1000||!Array.isArray(reminders)||reminders.length>2000)fail('Неверный формат копии мест и напоминаний.');
 const mapped=id=>str(b.profileMap?.[id],80)||null;
 const cleanPlaces=places.map(p=>cleanPlace({...p,profileIds:(p.profileIds||[]).map(mapped).filter(Boolean)}));
 const cleanReminders=reminders.map(r=>{const text=str(r.text,1000);if(!text)fail('Пустое напоминание в копии.');const timezone=validTimezone(r.timezone),dueAt=validateMoment(str(r.due_local,16));return {text,timezone,dueAt,dueMs:momentMillis(dueAt,timezone),profileId:mapped(r.profile_id),sentAt:Number.isFinite(r.sent_at)?r.sent_at:null};});
 for(const p of cleanPlaces)for(const id of p.profileIds)await get(env,owner,id);for(const r of cleanReminders)if(r.profileId)await get(env,owner,r.profileId);
 for(const p of cleanPlaces)await savePlace(env,owner,p);
 for(const r of cleanReminders)await env.DB.prepare("INSERT INTO reminder_jobs (id,owner,profile_id,text,due_local,timezone,due_at,status,done,sent_at,last_error,created_at) VALUES (?,?,?,?,?,?,?,'cancelled',1,?,'Восстановлено из копии без повторной отправки.',?)").bind(crypto.randomUUID(),owner,r.profileId,r.text,r.dueAt,r.timezone,r.dueMs,r.sentAt,now()).run();return {places:cleanPlaces.length,reminders:cleanReminders.length};
}
