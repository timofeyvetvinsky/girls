const TG_HELP=`Рядом · Знакомства\nОсновные действия — на кнопках под сообщением. Команды тоже работают.
/add Имя — создать анкету
/list — активные знакомства
/find Имя — найти и выбрать анкету
/select ID — выбрать из списка
/show — анкета и фото
/set city Москва — изменить поле
Поля: name, age, city, contact, source, birthday, tags, likes, avoid, about. Для очистки: /set city -
/note Текст — заметка; обычный текст тоже сохранится
Отправь фото — оно добавится к выбранной анкете.
/status new|chat|date|close|pause — этап
/meet 2026-12-01T19:00 | Кафе — встреча
/meet clear — убрать встречу
/before — памятка перед встречей
/after Впечатления — запись после встречи
/ideas — идеи по интересам
/remind 2026-12-01T12:00 | Прислать книгу
/reminders — список задач
/done ID — задача выполнена
/history — история общения
/favorite — избранное
/archive — в архив
/restore — вернуть из архива
/archives — архив
/delete — удаление с подтверждением
/cancel — отменить удаление
/mode girls — добавляю девушек
/mode boys — добавляю парней
/help — эта памятка
Время встреч — то же местное время, которое указано в дневнике. Напоминания можно получать в Telegram. /notifications — настройки, /places — места для встреч.`;
async function telegramCall(env,method,body){let r;try{r=await fetch('https://api.telegram.org/bot'+env.TELEGRAM_BOT_TOKEN+'/'+method,{method:'POST',headers:body instanceof FormData?{}:{'Content-Type':'application/json'},body:body instanceof FormData?body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});}catch{throw Error('Telegram временно недоступен.');}const data=await r.json();if(!data.ok)throw Error('Не удалось отправить ответ в Telegram.');return data.result;}
function telegramUsername(env){const name=env.TELEGRAM_BOT_USERNAME||'ryadom_diary_club_bot';return /^[A-Za-z0-9_]{5,32}$/.test(name)?name:'ryadom_diary_club_bot';}
function telegramUpdateKey(env,id){const botId=env.TELEGRAM_BOT_TOKEN?.split(':')[0];return /^\d+$/.test(botId||'')?botId+':'+id:String(id);}
async function telegramStatus(env,owner){const link=await env.DB.prepare('SELECT telegram_id FROM tg_links WHERE owner=?').bind(owner).first();return {enabled:!!(env.TELEGRAM_BOT_TOKEN&&env.TELEGRAM_WEBHOOK_SECRET),connected:!!link,username:telegramUsername(env)};}
async function telegramPair(env,owner){if(!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_WEBHOOK_SECRET)fail('Серверный бот ещё не активирован.',503);const code=randomToken().slice(0,40);await env.DB.prepare('INSERT INTO tg_pairings (code_hash,owner,expires_at) VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at').bind(await hash(code),owner,Date.now()+10*60000).run();return {username:telegramUsername(env),url:'https://t.me/'+telegramUsername(env)+'?start='+code,expiresIn:600};}
async function telegramMutation(env,owner,b,updateId){const old=await env.DB.prepare('SELECT result FROM bot_updates WHERE owner=? AND update_id=?').bind(owner,'tg-'+updateId).first();if(old)return JSON.parse(old.result);const result=await botAction(env,owner,b);await env.DB.prepare('INSERT OR IGNORE INTO bot_updates (owner,update_id,result) VALUES (?,?,?)').bind(owner,'tg-'+updateId,JSON.stringify(result)).run();return result;}
async function handleTelegramMessage(env,msg,updateId){
 if(!msg||msg.chat?.type!=='private'||String(msg.from?.id)!==String(msg.chat?.id)||msg.from?.is_bot)return;
 const telegramId=String(msg.from.id);let input=(msg.text||msg.caption||'').trim();let menu='main';if(telegramAliases[input])input=telegramAliases[input];const choice=input.match(/^👤 .+ · ([a-f0-9-]{36})$/);if(choice)input='/select '+choice[1];
 const say=async(text,keyboard=telegramMenu(menu))=>{for(let i=0;i<text.length;i+=3900)await telegramCall(env,'sendMessage',{chat_id:telegramId,text:text.slice(i,i+3900),reply_markup:keyboard});};
 let match=input.match(/^\/([a-z_]+)(?:@[\w]+)?(?:\s+([\s\S]*))?$/i),cmd=match?.[1]?.toLowerCase(),arg=match?.[2]?.trim()||'';
 if(cmd==='start'&&/^[a-f0-9]{40}$/.test(arg)){
 const pending=await env.DB.prepare('SELECT owner FROM tg_pairings WHERE code_hash=? AND expires_at>?').bind(await hash(arg),Date.now()).first();
 if(!pending)return say('Ссылка устарела или уже использована. Создай новую в разделе Telegram-бот на сайте.');
 const other=await env.DB.prepare('SELECT owner FROM tg_links WHERE telegram_id=?').bind(telegramId).first();
 if(other&&other.owner!==pending.owner)return say('Этот Telegram уже связан с другим дневником. Сначала отключи бота в настройках того дневника.');
 const consumed=await env.DB.prepare('DELETE FROM tg_pairings WHERE code_hash=? AND expires_at>? RETURNING owner').bind(await hash(arg),Date.now()).first();if(!consumed)return say('Ссылка уже использована. Создай новую на сайте.');
 await env.DB.prepare('INSERT INTO tg_links (owner,telegram_id) VALUES (?,?) ON CONFLICT(owner) DO UPDATE SET telegram_id=excluded.telegram_id,selected_id=NULL,delete_id=NULL,delete_until=NULL').bind(consumed.owner,telegramId).run();
 return say('Дневник подключён! Теперь /add Имя создаст анкету, а /find Имя найдёт существующую.\n\n/help — все команды.');
 }
 const link=await env.DB.prepare('SELECT * FROM tg_links WHERE telegram_id=?').bind(telegramId).first();
 if(!link)return say('Для доступа к личным анкетам открой сайт, войди в свой дневник и нажми «Подключить Telegram» в разделе Telegram-бот. Затем открой одноразовую ссылку.');
 const owner=link.owner;menu=link.selected_id?'profile':'main';
 if(!msg.photo?.length&&await telegramFeatures(env,link,input,say,updateId))return;
 if(!msg.photo?.length){const flow=await telegramButtonFlow(env,link,input,say);if(flow.handled)return;input=flow.input;const parsed=input.match(/^\/([a-z_]+)(?:@[\w]+)?(?:\s+([\s\S]*))?$/i);cmd=parsed?.[1]?.toLowerCase();arg=parsed?.[2]?.trim()||'';}
 const select=async id=>env.DB.prepare('UPDATE tg_links SET selected_id=?,delete_id=NULL,delete_until=NULL WHERE owner=?').bind(id,owner).run();
 const selected=async()=>{if(!link.selected_id)fail('Сначала выбери анкету: /find Имя или /add Имя.');try{return await withPhotos(env,owner,await get(env,owner,link.selected_id));}catch(e){if(e.status===404)fail('Выбранная анкета удалена. Выбери другую через /find Имя.');throw e;}};
 const mutate=async b=>{const result=await telegramMutation(env,owner,b,String(updateId));await telegramFlow(env,owner,null);return result;};
 const brief=p=>(p.favorite?'♥ ':'')+p.name+(p.age?', '+p.age:'')+(p.city?' · '+p.city:'')+'\nID: '+p.id;
 try{
 if(msg.photo?.length){if(link.flow&&link.flow_until>Date.now()&&link.flow!=='photo')return say('Сейчас ожидается текст для выбранного действия. Нажми «Отмена», затем «Фото», если хочешь добавить фотографию.',telegramKeyboard([['Отмена']]));await telegramFlow(env,owner,null);const p=await selected(),ph=msg.photo.at(-1);if(ph.file_size>10*1024*1024)fail('Фото должно быть меньше 10 МБ.');const cacheId='tg-photo-'+updateId;const cached=await env.DB.prepare('SELECT result FROM bot_updates WHERE owner=? AND update_id=?').bind(owner,cacheId).first();if(!cached){const file=await telegramCall(env,'getFile',{file_id:ph.file_id});if(!file.file_path||!/^photos\/[A-Za-z0-9_.-]+$/.test(file.file_path))fail('Не удалось загрузить фото.');const r=await fetch('https://api.telegram.org/file/bot'+env.TELEGRAM_BOT_TOKEN+'/'+file.file_path,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Не удалось скачать фото.');const blob=await r.blob();const photo=await addPhoto(env,owner,p.id,new File([blob],'photo.jpg',{type:'image/jpeg'}));await env.DB.prepare('INSERT OR IGNORE INTO bot_updates (owner,update_id,result) VALUES (?,?,?)').bind(owner,cacheId,JSON.stringify(photo)).run();}if(input)await mutate({action:'note',id:p.id,text:input});return say('Фото сохранено: '+p.name);}
 if(!cmd&&input){const p=await selected();await mutate({action:'note',id:p.id,text:input});return say('Заметка добавлена: '+p.name);}
 if(cmd==='menu'||cmd==='start'){menu='main';return say('Рядом · Знакомства\n\nЛюди, встречи и важные мелочи — в одном месте.\nВыбери действие ниже.');}
 if(cmd==='help')return say(TG_HELP);
 if(cmd==='mode'){const r=await botAction(env,owner,{action:'mode',mode:arg||undefined});return say(r.mode==='boys'?'Режим: добавляю парней. Новые анкеты будут мужскими, сайт — синим.':'Режим: добавляю девушек. Новые анкеты будут женскими, сайт — фиолетовым.');}
 if(cmd==='cancel'){await env.DB.prepare('UPDATE tg_links SET delete_id=NULL,delete_until=NULL WHERE owner=?').bind(owner).run();return say('Действие отменено.');}
 if(cmd==='add'){if(!arg)fail('Пример: /add Имя');const {profile:p}=await mutate({action:'create',profile:{name:arg}});await select(p.id);menu='profile';return say('Анкета создана и выбрана.\n'+brief(p)+'\nОтправь фото или заметку.');}
 if(['list','archives','find','meetings'].includes(cmd)){let p=await all(env,owner);if(cmd==='find'){if(!arg)fail('Пример: /find Имя');p=p.filter(p=>[p.name,p.city,p.contact,p.likes,p.avoid,p.about,p.source,...(p.tags||[]),...(p.notes||[]).map(n=>n.text)].join(' ').toLowerCase().includes(arg.toLowerCase()));if(p.length===1){await select(p[0].id);menu='profile';await telegramFlow(env,owner,null);return say('Анкета выбрана.\n'+brief(p[0]));}}else p=p.filter(p=>cmd==='archives'?p.stage==='archive':p.stage!=='archive');if(cmd==='meetings'){p=p.filter(p=>p.meetingAt).sort((a,b)=>a.meetingAt.localeCompare(b.meetingAt));return say(p.length?p.map(p=>p.meetingAt.replace('T',' ')+' · '+p.name+'\n'+(p.meetingPlace||'')).join('\n\n'):'Встреч пока нет.');}await telegramFlow(env,owner,null);return say(p.length?'Выбери анкету кнопкой ниже.'+(p.length>12?' Показаны первые 12. Для остальных используй поиск.':''):'Анкет не найдено.',await telegramProfileChoices(env,owner,p));}
 if(cmd==='select'){const p=await get(env,owner,arg);await select(p.id);menu='profile';return say('Выбрана анкета:\n'+brief(p));}
 const p=await selected();
 if(cmd==='show'){await say(brief(p)+'\nЭтап: '+p.stage+'\nКонтакт: '+(p.contact||'—')+'\nПознакомились: '+(p.source||'—')+'\nДень рождения: '+(p.birthday||'—')+'\nИнтересы: '+(p.tags||[]).join(', ')+'\nЛюбит: '+(p.likes||'—')+'\nНе любит: '+(p.avoid||'—')+'\n'+(p.gender==='male'?'О нём: ':'О ней: ')+(p.about||'—')+'\nВстреча: '+(p.meetingAt||'—')+' '+(p.meetingPlace||'')+'\n\nЗаметки:\n'+(p.notes||[]).map(n=>n.createdAt.slice(0,10)+' · '+n.text).join('\n'));for(const photo of p.photos){const row=await env.DB.prepare('SELECT object_key,mime FROM photos WHERE owner=? AND id=?').bind(owner,photo.id).first();const object=row&&await env.BUCKET.get(row.object_key);if(object){const form=new FormData();form.append('chat_id',telegramId);form.append('photo',new Blob([await object.arrayBuffer()],{type:row.mime}),'photo');form.append('caption','ID фото: '+photo.id);await telegramCall(env,'sendPhoto',form);}}return;}
 if(cmd==='set'){const m=arg.match(/^(\S+)\s+([\s\S]+)$/);if(!m||!['name','age','city','contact','source','birthday','tags','likes','avoid','about','archiveReason'].includes(m[1]))fail('Поле не распознано. Посмотри /help.');const value=m[2]==='-'?'':m[2];await mutate({action:'update',id:p.id,profile:{[m[1]]:m[1]==='tags'?value.split(',').map(v=>v.trim()).filter(Boolean):value}});return say('Сохранено.');}
 if(cmd==='note'){if(!arg)fail('Пример: /note Любит пионы');await mutate({action:'note',id:p.id,text:arg});return say('Заметка сохранена.');}
 if(cmd==='status'){await mutate({action:'update',id:p.id,profile:{stage:arg}});return say('Этап обновлён.');}
 if(cmd==='favorite'){await mutate({action:'update',id:p.id,profile:{favorite:!p.favorite}});return say('Избранное обновлено.');}
 if(cmd==='archive'||cmd==='restore'){await mutate({action:'update',id:p.id,profile:{stage:cmd==='archive'?'archive':'new'}});return say(cmd==='archive'?'Анкета в архиве.':'Анкета возвращена в знакомства.');}
 if(cmd==='meet'){const a=arg.split('|').map(s=>s.trim());await mutate({action:'update',id:p.id,profile:{meetingAt:arg==='clear'?'':a[0],meetingPlace:arg==='clear'?'':a.slice(1).join(' | ')}});return say('План встречи обновлён.');}
 if(cmd==='before')return say('Перед встречей: '+p.name+'\nВстреча: '+(p.meetingAt||'не выбрана')+' '+(p.meetingPlace||'')+'\nЛюбит: '+(p.likes||'пока не записано')+'\nВажно учитывать: '+(p.avoid||'нет заметок')+'\nТемы: '+(p.tags||[]).join(', ')+'\nПоследние заметки:\n'+(p.notes||[]).slice(0,3).map(n=>n.text).join('\n')+'\nНе забыть:\n'+(p.reminders||[]).filter(r=>!r.done).map(r=>r.text).join('\n'));
 if(cmd==='ideas')return say(dateIdeas(p).map(i=>i.title+'\n'+i.text).join('\n\n')||'Уточни интересы в анкете.');
 if(cmd==='after'){if(!arg)fail('Пример: /after Хорошо погуляли');if(!p.meetingAt)fail('Сначала укажи дату встречи: /meet 2026-12-01T19:00 | Место. Затем /after Текст.');await mutate({action:'reflect',id:p.id,text:arg,metAt:p.meetingAt,wantAgain:'maybe'});return say('Впечатления сохранены.');}
 if(cmd==='remind'){const [dueAt,...text]=arg.split('|');await mutate({action:'remind',id:p.id,dueAt:dueAt.trim(),text:text.join('|').trim()});return say('Напоминание сохранено в дневнике.');}
 if(cmd==='reminders')return say((p.reminders||[]).map(r=>(r.done?'✓ ':'')+r.dueAt+' · '+r.text+'\nID: '+r.id).join('\n\n')||'Напоминаний пока нет.');
 if(cmd==='done'){await mutate({action:'reminder_done',id:p.id,reminderId:arg,done:true});return say('Отмечено выполненным.');}
 if(cmd==='history')return say(storyItems(p).map(i=>i.createdAt.slice(0,16).replace('T',' ')+' · '+i.title+'\n'+i.text).join('\n\n'));
 if(cmd==='delete'){await env.DB.prepare('UPDATE tg_links SET delete_id=?,delete_until=? WHERE owner=?').bind(p.id,Date.now()+120000,owner).run();return say('Удалить анкету «'+p.name+'» с фото и заметками? Подтверждение в течение двух минут:\n/confirm_delete '+p.id+'\n/cancel — отменить');}
 if(cmd==='confirm_delete'){if(link.delete_id!==arg||link.delete_until<Date.now()||p.id!==arg)fail('Подтверждение устарело. Сначала /delete.');await mutate({action:'delete',id:p.id});await select(null);return say('Анкета удалена.');}
 if(cmd==='removephoto'){if(!p.photos.some(ph=>ph.id===arg))fail('В этой анкете нет такого фото. ID виден в /show.');const row=await env.DB.prepare('SELECT object_key FROM photos WHERE owner=? AND id=?').bind(owner,arg).first();if(row){await env.BUCKET.delete(row.object_key);await env.DB.prepare('DELETE FROM photos WHERE owner=? AND id=?').bind(owner,arg).run();}return say('Фото удалено.');}
 return say('Неизвестная команда. /help — список возможностей.');
 }catch(e){if(e.status)return say(e.message);throw e;}
}
async function telegramWebhook(req,env){
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 if(!env.TELEGRAM_WEBHOOK_SECRET||!safeEqual(req.headers.get('X-Telegram-Bot-Api-Secret-Token')||'',env.TELEGRAM_WEBHOOK_SECRET))return json({error:'Unauthorized'},401);
 if(!env.TELEGRAM_BOT_TOKEN)return json({error:'Unavailable'},503);
 const raw=await req.text();if(raw.length>200000)return json({error:'Too large'},413);let update;try{update=JSON.parse(raw);}catch{return json({error:'Invalid JSON'},400);}if(!Number.isSafeInteger(update.update_id))return json({ok:true});
 const id=telegramUpdateKey(env,update.update_id);const existing=await env.DB.prepare('SELECT done,created_at FROM tg_deliveries WHERE update_id=?').bind(id).first();if(existing?.done)return json({ok:true});if(existing&&Date.now()-existing.created_at<60000)return json({error:'Processing'},503);
 if(existing)await env.DB.prepare('DELETE FROM tg_deliveries WHERE update_id=? AND done=0 AND created_at<?').bind(id,Date.now()-60000).run();
 const claimed=await env.DB.prepare('INSERT OR IGNORE INTO tg_deliveries (update_id,created_at,done) VALUES (?,?,0) RETURNING update_id').bind(id,Date.now()).first();if(!claimed)return json({error:'Processing'},503);
 try{await handleTelegramMessage(env,update.message,id);await env.DB.prepare('UPDATE tg_deliveries SET done=1 WHERE update_id=?').bind(id).run();return json({ok:true});}catch{await env.DB.prepare('DELETE FROM tg_deliveries WHERE update_id=? AND done=0').bind(id).run();return json({error:'Temporary failure'},503);}
}
