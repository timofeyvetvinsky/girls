/** Рядом · личный Telegram-бот. Node.js 22+. Настройка: README.md, раздел Telegram. */
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const HELP=`Рядом · личный дневник знакомств

/add Аня — новая анкета
/list — все активные анкеты
/find Аня — поиск (один результат выбирается сразу)
/select ID — выбрать анкету из списка
/show — анкета и фотографии
/set age 25 — изменить поле
/set city Москва — изменить город
/set contact @username — контакт
/set source У друзей — где познакомились
/set birthday 2000-06-15 — день рождения
/set tags Кино, йога — интересы
/set likes Пионы и матча — что любит
/set avoid Громкие места — что не любит
/set about Текст — описание
Для очистки поля: /set city -
/status new|chat|date|close|pause — этап общения
/note Текст — новая заметка
Обычное сообщение тоже станет заметкой.
/meet 2026-12-01T19:00 | Кафе — встреча
/meet clear — убрать встречу
/meetings — список встреч
/favorite — переключить избранное
/archive — в архив
/restore — вернуть из архива
/archives — архивные анкеты
/removephoto ID — удалить фотографию
/delete — запросить удаление
/confirm_delete ID — удалить навсегда
/export — скачать копию с фото
/cancel — отменить удаление
/before — памятка перед встречей
/ideas — идеи по интересам
/after Текст — впечатления после встречи
/remind 2026-12-01T12:00 | Прислать книгу — напоминание
/reminders — напоминания выбранной анкеты
/done ID — отметить напоминание
/history — встречи и заметки

Фото отправь прямо в этот чат: оно сохранится в выбранную анкету. Для новой анкеты сначала /add. Все даты встреч — местное время, как на сайте.`;
const allowedFields=new Set(['name','age','city','contact','source','birthday','tags','likes','avoid','about','archiveReason']);
export async function startBot(env=process.env){
 const {TELEGRAM_BOT_TOKEN,TELEGRAM_OWNER_ID,SITE_URL,SITE_ACCESS_TOKEN,NOTEBOOK_KEY}=env;
 if(!TELEGRAM_BOT_TOKEN||!/^\d+$/.test(TELEGRAM_OWNER_ID||'')||!SITE_URL||!NOTEBOOK_KEY)throw Error('Заполните TELEGRAM_BOT_TOKEN, TELEGRAM_OWNER_ID, SITE_URL и NOTEBOOK_KEY в окружении.');
 const base=new URL(SITE_URL);if(base.protocol!=='https:')throw Error('SITE_URL должен использовать HTTPS.');
 const stateFile=resolve(env.BOT_STATE_FILE||'.bot-state.json');
 let state={offset:0,selected:null,pendingDelete:null};
 try{state={...state,...JSON.parse(await readFile(stateFile,'utf8'))};}catch(e){if(e.code!=='ENOENT')throw Error('Не удалось прочитать состояние бота. Проверьте BOT_STATE_FILE.');}
 let stopping=false,lastHeartbeat=0;process.once('SIGINT',()=>{stopping=true;});process.once('SIGTERM',()=>{stopping=true;});
 const persist=async()=>{await mkdir(dirname(stateFile),{recursive:true});await writeFile(stateFile+'.tmp',JSON.stringify(state),{mode:0o600});await rename(stateFile+'.tmp',stateFile);};
 const tg=async(method,body)=>{let response;try{response=await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,{method:'POST',headers:body instanceof FormData?{}:{'Content-Type':'application/json'},body:body instanceof FormData?body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});}catch{throw Error('Telegram временно недоступен.');}const r=await response.json();if(!r.ok)throw Error('Ошибка Telegram: '+(r.error_code||response.status)+'. Проверьте подключение и настройки бота.');return r.result;};
 const request=async(path,body,method='POST')=>{let response;try{response=await fetch(new URL('/api/bot/'+path,base),{method,headers:{...(SITE_ACCESS_TOKEN?{'OAI-Sites-Authorization':'Bearer '+SITE_ACCESS_TOKEN}:{}),Authorization:'Bearer '+NOTEBOOK_KEY,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:method==='GET'||method==='DELETE'?undefined:body instanceof FormData?body:JSON.stringify(body),signal:AbortSignal.timeout(30000),redirect:'error'});}catch{throw Error('Дневник временно недоступен.');}if(path.startsWith('photos/')&&method==='GET'){if(!response.ok)throw Error('Фотография недоступна.');return response.blob();}const r=await response.json().catch(()=>({error:'Проверьте защищённый доступ к сайту.'}));if(!response.ok)throw Error(r.error||'Ошибка дневника.');return r;};
 const action=(b)=>request('action',b);
 const say=async(text)=>{for(let i=0;i<text.length;i+=3900)await tg('sendMessage',{chat_id:TELEGRAM_OWNER_ID,text:text.slice(i,i+3900)});};
 const all=async()=> (await action({action:'list'})).profiles;
 const selected=async()=>{if(!state.selected)throw Error('Сначала выбери анкету: /find Имя или /add Имя.');return (await action({action:'get',id:state.selected})).profile;};
 const brief=p=>`${p.favorite?'♥ ':''}${p.name}${p.age?', '+p.age:''}${p.city?' · '+p.city:''}\nID: ${p.id}`;
 const me=await tg('getMe',{});
 const webhook=await tg('getWebhookInfo',{});if(webhook.url)throw Error('У бота уже настроен webhook. Отключите его осознанно перед запуском этого обработчика.');
 await action({action:'heartbeat',username:me.username});
 console.log('Личный бот запущен. Принимаются только сообщения владельца в личном чате.');
 async function handle(update){
 const msg=update.message;if(!msg||String(msg.from?.id)!==TELEGRAM_OWNER_ID||msg.chat?.type!=='private'||String(msg.chat.id)!==TELEGRAM_OWNER_ID)return;
 const input=(msg.text||msg.caption||'').trim();const match=input.match(/^\/([a-z_]+)(?:@[\w]+)?(?:\s+([\s\S]*))?$/i);const cmd=match?.[1].toLowerCase(),arg=match?.[2]?.trim()||'';
 const mutate=(body,suffix='')=>action({...body,updateId:String(update.update_id)+suffix});
 if(msg.photo?.length){const p=await selected();const ph=msg.photo.at(-1);if(ph.file_size>10*1024*1024)throw Error('Фото должно быть меньше 10 МБ.');const file=await tg('getFile',{file_id:ph.file_id});if(!file.file_path)throw Error('Не удалось загрузить фото.');let r;try{r=await fetch(`https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`,{signal:AbortSignal.timeout(30000)});}catch{throw Error('Не удалось скачать фото из Telegram.');}if(!r.ok)throw Error('Не удалось скачать фото.');const bytes=await r.arrayBuffer();if(bytes.byteLength>10*1024*1024)throw Error('Фото должно быть меньше 10 МБ.');const form=new FormData();form.append('id',p.id);form.append('updateId',String(update.update_id));form.append('file',new Blob([bytes],{type:'image/jpeg'}),'photo.jpg');await request('upload',form);if(input)await mutate({action:'note',id:p.id,text:input},'-caption');return say('Фото сохранено: '+p.name);}
 if(!cmd&&input){const p=await selected();await mutate({action:'note',id:p.id,text:input});return say('Заметка добавлена: '+p.name);}
 if(cmd==='start'||cmd==='help')return say(HELP);
 if(cmd==='cancel'){state.pendingDelete=null;await persist();return say('Удаление отменено.');}
 if(cmd==='add'){if(!arg)throw Error('Пример: /add Аня');const {profile:p}=await mutate({action:'create',profile:{name:arg}});state.selected=p.id;await persist();return say('Анкета создана и выбрана.\n'+brief(p)+'\n\nОтправь фото, заметку или /set likes Текст.');}
 if(['list','archives','find','meetings'].includes(cmd)){
 let p=await all();if(cmd==='archives')p=p.filter(p=>p.stage==='archive');else if(cmd==='list')p=p.filter(p=>p.stage!=='archive');
 if(cmd==='find'){if(!arg)throw Error('Пример: /find Аня');const q=arg.toLocaleLowerCase('ru');p=p.filter(p=>[p.name,p.city,p.contact,p.likes,p.about,...(p.tags||[])].join(' ').toLocaleLowerCase('ru').includes(q));if(p.length===1){state.selected=p[0].id;await persist();return say('Анкета выбрана.\n'+brief(p[0]));}}
 if(cmd==='meetings'){p=p.filter(p=>p.stage!=='archive'&&p.meetingAt).sort((a,b)=>a.meetingAt.localeCompare(b.meetingAt));return say(p.length?p.map(p=>p.meetingAt.replace('T',' ')+' · '+p.name+'\n'+(p.meetingPlace||'Место не указано')).join('\n\n'):'Встреч пока нет.');}
 return say(p.length?p.map(brief).join('\n\n')+'\n\nВыбери анкету: /select ID':'Анкет не найдено.');
 }
 if(cmd==='select'){const p=(await action({action:'get',id:arg})).profile;state.selected=p.id;state.pendingDelete=null;await persist();return say('Выбрана анкета:\n'+brief(p));}
 if(cmd==='export'){
 const profiles=await all();let total=0;for(const p of profiles){const photos=[];for(const photo of p.photos){const blob=await request('photos/'+photo.id,undefined,'GET');total+=blob.size;if(total>40*1024*1024)throw Error('Копия больше 40 МБ. Скачай её в настройках сайта.');photos.push({mime:photo.mime,data:`data:${photo.mime};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`});}p.photos=photos;}const form=new FormData();form.append('chat_id',TELEGRAM_OWNER_ID);form.append('document',new Blob([JSON.stringify({format:'closeby-backup',version:1,createdAt:new Date().toISOString(),profiles})],{type:'application/json'}),'ryadom-backup.json');return tg('sendDocument',form);
 }
 if(!cmd)return say('Отправь текст, фото или /help.');
 const p=await selected();
 if(cmd==='ideas'){const r=await action({action:'ideas',id:p.id});return say(r.ideas.map(i=>i.title+'\n'+i.text+'\n'+i.reason).join('\n\n')||'Подходящих идей пока нет.');}
 if(cmd==='before')return say('Перед встречей: '+p.name+'\nВстреча: '+(p.meetingAt||'не выбрана')+' '+(p.meetingPlace||'')+'\nЛюбит: '+(p.likes||'пока не записано')+'\nВажно учитывать: '+(p.avoid||'пока нет заметок')+'\nИнтересы: '+(p.tags||[]).join(', ')+'\nПоследние заметки:\n'+(p.notes||[]).slice(0,3).map(n=>n.text).join('\n')+'\nНе забыть:\n'+(p.reminders||[]).filter(r=>!r.done).map(r=>r.text).join('\n'));
 if(cmd==='after'){if(!arg)throw Error('Пример: /after Хорошо погуляли, хочу повторить');await mutate({action:'reflect',id:p.id,text:arg,metAt:p.meetingAt||new Date().toISOString().slice(0,16),wantAgain:'maybe'});return say('Впечатления добавлены в историю.');}
 if(cmd==='remind'){const [dueAt,...text]=arg.split('|');await mutate({action:'remind',id:p.id,dueAt:dueAt.trim(),text:text.join('|').trim()});return say('Напоминание сохранено в дневнике. Фоновая рассылка не подключена.');}
 if(cmd==='reminders')return say((p.reminders||[]).map(r=>(r.done?'✓ ':'')+r.dueAt+' · '+r.text+'\nID: '+r.id).join('\n\n')||'Напоминаний пока нет.');
 if(cmd==='done'){await mutate({action:'reminder_done',id:p.id,reminderId:arg,done:true});return say('Отмечено выполненным.');}
 if(cmd==='history')return say('История: '+p.name+'\n'+[...(p.reflections||[]).map(r=>r.metAt+' · После встречи: '+r.text),...(p.notes||[]).map(n=>n.createdAt+' · '+n.text),...(p.history||[]).map(h=>h.createdAt+' · '+h.title+' '+h.text)].sort().reverse().join('\n\n'));
 if(cmd==='show'){const text=brief(p)+`\nЭтап: ${p.stage}\nКонтакт: ${p.contact||'—'}\nПознакомились: ${p.source||'—'}\nДень рождения: ${p.birthday||'—'}\nИнтересы: ${(p.tags||[]).join(', ')||'—'}\nЛюбит: ${p.likes||'—'}\nНе любит: ${p.avoid||'—'}\nО ней: ${p.about||'—'}\nВстреча: ${p.meetingAt||'—'} ${p.meetingPlace||''}\n\nЗаметки:\n`+(p.notes||[]).map(n=>n.createdAt.slice(0,10)+' · '+n.text).join('\n');await say(text);for(const photo of p.photos||[]){const form=new FormData();form.append('chat_id',TELEGRAM_OWNER_ID);form.append('photo',await request('photos/'+photo.id,undefined,'GET'),'photo');form.append('caption','ID фото: '+photo.id);await tg('sendPhoto',form);}return;}
 if(cmd==='note'){if(!arg)throw Error('Пример: /note Любит пионы');await mutate({action:'note',id:p.id,text:arg});return say('Заметка сохранена.');}
 if(cmd==='set'){const m=arg.match(/^(\S+)\s+([\s\S]+)$/);if(!m||!allowedFields.has(m[1]))throw Error('Поле не распознано. Посмотри /help.');const key=m[1],value=m[2]==='-'?'':m[2];await mutate({action:'update',id:p.id,profile:{[key]:key==='tags'?value.split(',').map(v=>v.trim()).filter(Boolean):value}});return say('Сохранено: '+key);}
 if(cmd==='status'){await mutate({action:'update',id:p.id,profile:{stage:arg}});return say('Статус обновлён.');}
 if(cmd==='meet'){const clear=arg==='clear',a=arg.split('|').map(s=>s.trim());await mutate({action:'update',id:p.id,profile:{meetingAt:clear?'':a[0],meetingPlace:clear?'':a.slice(1).join(' | ')}});return say(clear?'Встреча убрана.':'Встреча сохранена.');}
 if(cmd==='favorite'){const r=await mutate({action:'update',id:p.id,profile:{favorite:!p.favorite}});return say(r.profile.favorite?'Добавлено в избранное.':'Убрано из избранного.');}
 if(cmd==='archive'||cmd==='restore'){await mutate({action:'update',id:p.id,profile:{stage:cmd==='archive'?'archive':'new'}});return say(cmd==='archive'?'Анкета перенесена в архив.':'Анкета возвращена в знакомства.');}
 if(cmd==='removephoto'){if(!p.photos.some(ph=>ph.id===arg))throw Error('В выбранной анкете нет такого фото. ID виден в /show.');await request('photos/'+arg,undefined,'DELETE');return say('Фото удалено.');}
 if(cmd==='delete'){state.pendingDelete={id:p.id,expires:Date.now()+120000};await persist();return say('Удалить анкету «'+p.name+'» со всеми фото и заметками?\nДля подтверждения в течение двух минут:\n/confirm_delete '+p.id+'\nОтмена: /cancel');}
 if(cmd==='confirm_delete'){if(state.pendingDelete?.id!==arg||state.pendingDelete.expires<Date.now()||p.id!==arg)throw Error('Подтверждение устарело или анкета изменилась. Сначала /delete.');await mutate({action:'delete',id:p.id});state.selected=null;state.pendingDelete=null;await persist();return say('Анкета удалена.');}
 return say('Неизвестная команда. /help — список команд.');
 }
 while(!stopping){try{if(Date.now()-lastHeartbeat>60000){await action({action:'heartbeat',username:me.username});lastHeartbeat=Date.now();}const updates=await tg('getUpdates',{offset:state.offset,timeout:25,allowed_updates:['message']});for(const u of updates){try{await handle(u);}catch(e){if(u.message?.chat?.type==='private'&&String(u.message.from?.id)===TELEGRAM_OWNER_ID)await say(e.message);}state.offset=u.update_id+1;await persist();}}catch{console.error('Временная ошибка соединения. Повтор через 5 секунд.');await new Promise(r=>setTimeout(r,5000));}}
 console.log('Бот остановлен.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)startBot().catch(e=>{console.error(e.message);process.exitCode=1;});
