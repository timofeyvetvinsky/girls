const sessionName='__Host-ryadom';
const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32))).map(n=>n.toString(16).padStart(2,'0')).join('');
const sessionToken=req=>(req.headers.get('Cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(sessionName+'='))?.slice(sessionName.length+1);
async function accountIdentity(req,env){const token=sessionToken(req);if(token&&env.DB){const account=await env.DB.prepare('SELECT a.owner FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?').bind(await hash(token),Date.now()).first();if(account)return account.owner;}return req.headers.get('oai-authenticated-user-id')||null;}
async function passwordHash(password,salt,env){if(!env.AUTH_PEPPER)fail('Вход временно недоступен.',503);const enc=new TextEncoder();const pepper=await crypto.subtle.importKey('raw',enc.encode(env.AUTH_PEPPER),{name:'HMAC',hash:'SHA-256'},false,['sign']);const mixed=await crypto.subtle.sign('HMAC',pepper,enc.encode(password));const key=await crypto.subtle.importKey('raw',mixed,'PBKDF2',false,['deriveBits']);const bytes=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-512',salt:enc.encode(salt),iterations:100000},key,256);return Array.from(new Uint8Array(bytes)).map(n=>n.toString(16).padStart(2,'0')).join('');}
function safeEqual(a,b){let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return diff===0;}
async function authLimit(env,key,max){const window=Math.floor(Date.now()/900000);await env.DB.prepare('INSERT INTO auth_limits (key,window,attempts) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN auth_limits.window=excluded.window THEN auth_limits.attempts+1 ELSE 1 END,window=excluded.window').bind(key,window).run();const row=await env.DB.prepare('SELECT attempts FROM auth_limits WHERE key=?').bind(key).first();if(row.attempts>max)fail('Слишком много попыток. Повтори через 15 минут.',429);}
async function sessionResponse(env,accountId,data={ok:true}){const token=randomToken(),expires=Date.now()+30*86400000;await env.DB.prepare('INSERT INTO sessions (token_hash,account_id,expires_at) VALUES (?,?,?)').bind(await hash(token),accountId,expires).run();const r=json(data);r.headers.set('Set-Cookie',`${sessionName}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);return r;}
async function authRequest(req,env,path){
 if(req.method!=='POST')fail('Метод не поддерживается.',405);
 const origin=req.headers.get('Origin');if(origin&&origin!==new URL(req.url).origin||req.headers.get('Sec-Fetch-Site')==='cross-site')fail('Запрос отклонён.',403);
 if(path==='/api/auth/logout'){const token=sessionToken(req);if(token)await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(token)).run();const r=json({ok:true});r.headers.set('Set-Cookie',`${sessionName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);return r;}
 if(!req.headers.get('Content-Type')?.includes('application/json'))fail('Ожидается JSON.',415);
 const raw=await req.text();if(raw.length>4096)fail('Слишком большой запрос.',413);let b;try{b=JSON.parse(raw);}catch{fail('Проверь данные.');}
 const email=str(b.email,254).toLowerCase(),password=typeof b.password==='string'?b.password:'';
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('Укажи корректный email.');
 await authLimit(env,'mail:'+await hash(email),10);const ip=req.headers.get('cf-connecting-ip');if(ip)await authLimit(env,'ip:'+await hash(ip),60);
 const account=await env.DB.prepare('SELECT * FROM accounts WHERE email=?').bind(email).first();
 if(path==='/api/auth/register'||path==='/api/auth/recover'){if(password.length<12||password.length>128)fail('Пароль должен содержать от 12 до 128 символов.');}
 if(path==='/api/auth/register'){
 if(b.diaryMode!==undefined)validDiaryMode(b.diaryMode);
 if(account)fail('Не удалось создать аккаунт. Попробуй войти или восстановить доступ.');
 const id=crypto.randomUUID(),owner=await accountIdentity(req,env)||'account:'+id,salt=randomToken(),recovery=randomToken();
 const password_hash=await passwordHash(password,salt,env);
 try{await env.DB.prepare('INSERT INTO accounts (id,owner,email,salt,password_hash,recovery_hash,created_at) VALUES (?,?,?,?,?,?,?)').bind(id,owner,email,salt,password_hash,await hash(recovery),now()).run();}catch{fail('Не удалось создать аккаунт. Попробуй войти.');}
 if(b.diaryMode!==undefined)await saveDiaryMode(env,owner,b.diaryMode);
 return sessionResponse(env,id,{ok:true,recoveryCode:recovery});
 }
 if(path==='/api/auth/login'){const candidate=await passwordHash(password.slice(0,128),account?.salt||'invalid-account-salt',env);if(!account||password.length>128||!safeEqual(candidate,account.password_hash))fail('Неверный email или пароль.',401);return sessionResponse(env,account.id);}
 if(path==='/api/auth/recover'){if(!account||!safeEqual(await hash(str(b.recoveryCode,100)),account.recovery_hash))fail('Неверный email или код восстановления.',401);const salt=randomToken(),recovery=randomToken(),password_hash=await passwordHash(password,salt,env);await env.DB.batch([env.DB.prepare('UPDATE accounts SET salt=?,password_hash=?,recovery_hash=? WHERE id=?').bind(salt,password_hash,await hash(recovery),account.id),env.DB.prepare('DELETE FROM sessions WHERE account_id=?').bind(account.id)]);return sessionResponse(env,account.id,{ok:true,recoveryCode:recovery});}
 fail('Маршрут не найден.',404);
}
