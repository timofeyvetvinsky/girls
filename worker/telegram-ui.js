const telegramButtonStyles={
 '➕ Новая анкета':'success','➕ Добавить место':'success','Включить уведомления':'success','✅ Уже были':'success',
 '📋 Мои анкеты':'primary','✍️ Заметка':'primary','📅 Встреча':'primary','⏰ Напомнить':'primary','📅 Выбрать для встречи':'primary','🌐 Открыть сайт':'primary',
 '🗑 Удалить':'danger','🗑 Удалить место':'danger','Да, удалить место':'danger'
};
function telegramKeyboard(rows){return {keyboard:rows.map(row=>row.map(item=>{const b=typeof item==='string'?{text:item}:{...item};const style=b.style||telegramButtonStyles[b.text]||(/^✓ Готово: \d+ · /.test(b.text)?'success':undefined);if(style)b.style=style;return b;})),resize_keyboard:true,is_persistent:true,input_field_placeholder:'Что сохраним в дневнике?'};}
function telegramMenu(kind='main'){
 if(kind==='profile')return telegramKeyboard([['👤 Анкета','✏️ Изменить'],['✍️ Заметка','📸 Фото'],['📅 Встреча','🗒 Перед встречей'],['✨ Идеи','⋯ Ещё'],['📋 Мои анкеты','🏠 Меню']]);
 if(kind==='more')return telegramKeyboard([['💭 После встречи','🕘 История'],['⏰ Напомнить','🔔 Напоминания'],['❤️ Избранное','📦 В архив'],['♻️ Вернуть из архива','🗑 Удалить'],['⬅️ К анкете','🏠 Меню']]);
 if(kind==='settings')return telegramKeyboard([['⚙️ Режим','🔔 Уведомления'],['❓ Помощь','🏠 Меню']]);
 if(kind==='mode')return telegramKeyboard([['💜 Добавляю девушек','💙 Добавляю парней'],['🏠 Меню']]);
 return telegramKeyboard([['📋 Мои анкеты','➕ Новая анкета'],['📅 Все встречи','📍 Места'],['⏰ Напомнить','🔔 Напоминания'],['🔎 Поиск','⚙️ Настройки'],[{text:'🌐 Открыть сайт',web_app:{url:'https://closeby-notebook-k7m4.finiterose64.chatgpt.site/'}}]]);
}
async function telegramChoices(env,owner,kind,items,footer){
 const chosen=items.slice(0,kind==='profile'?12:kind==='place'?15:10).map((p,i)=>({id:p.id,text:(kind==='profile'?'👤 ':kind==='place'?'📍 ':'✓ Готово: ')+(i+1)+' · '+String(kind==='reminder'?p.text:p.name).replace(/\s+/g,' ').slice(0,34)}));
 await telegramFlow(env,owner,chosen.length?'choices:'+kind+':'+JSON.stringify(chosen):null);
 return telegramKeyboard([...chosen.map(p=>[p.text]),...footer]);
}
function telegramChosen(link,input,kind){
 const prefix='choices:'+kind+':';if(!link.flow?.startsWith(prefix))return {error:'Этот список устарел. Открой новый список кнопкой меню.'};
 if(link.flow_until<Date.now())return {error:'Время выбора истекло. Открой список ещё раз.'};
 try{const item=JSON.parse(link.flow.slice(prefix.length)).find(p=>p.text===input);return item?{id:item.id}:{error:'Выбери кнопку из последнего открытого списка.'};}catch{return {error:'Открой список ещё раз.'};}
}
const telegramAliases={'📋 Мои анкеты':'/list','📅 Все встречи':'/meetings','❓ Помощь':'/help','🏠 Меню':'/menu','👤 Анкета':'/show','⬅️ К анкете':'/show','🗒 Перед встречей':'/before','✨ Идеи':'/ideas','🕘 История':'/history','🔔 Напоминания':'/reminders','❤️ Избранное':'/favorite','📦 В архив':'/archive','♻️ Вернуть из архива':'/restore','🗑 Удалить':'/delete','💜 Добавляю девушек':'/mode girls','💙 Добавляю парней':'/mode boys','Отмена':'/cancel'};
const telegramEdits={'Имя':'name','Возраст':'age','Город':'city','Контакт':'contact','День рождения':'birthday','Где познакомились':'source','Интересы':'tags','Любит':'likes','Не любит':'avoid','Описание':'about','Этап общения':'stage'};
async function telegramFlow(env,owner,kind){await env.DB.prepare('UPDATE tg_links SET flow=?,flow_until=? WHERE owner=?').bind(kind,kind?Date.now()+15*60000:null,owner).run();}
async function telegramButtonFlow(env,link,input,say){const owner=link.owner;
 const prompts={'➕ Новая анкета':['add','Как зовут человека? Отправь имя одним сообщением.'],'🔎 Поиск':['find','Кого найти? Напиши имя или часть заметки.'],'✍️ Заметка':['note','Напиши, что хочется запомнить.'],'📸 Фото':['photo','Пришли фотографию — она сохранится в выбранную анкету.'],'📅 Встреча':['meet','Напиши дату и место, например:\n2026-12-01 19:00 | Кофейня\nВремя — как в твоём дневнике.'],'💭 После встречи':['after','Поделись впечатлениями после встречи. Дата берётся из текущего плана.'],'⏰ Напомнить':['remind','Напиши дату и задачу, например:\n2026-12-01 12:00 | Прислать книгу']};
 if(input==='⚙️ Настройки'){await telegramFlow(env,owner,null);await say('Настройки дневника и уведомлений.',telegramMenu('settings'));return {handled:true};}
 if(input==='⚙️ Режим'){await telegramFlow(env,owner,null);await say('Кого ты добавляешь? Режим будет общим для сайта и бота.',telegramMenu('mode'));return {handled:true};}
 if(input==='⋯ Ещё'){await telegramFlow(env,owner,null);await say('Ещё действия для выбранной анкеты.',telegramMenu('more'));return {handled:true};}
 if(input==='🌐 Открыть сайт'){await telegramFlow(env,owner,null);await say('Твой дневник: https://closeby-notebook-k7m4.finiterose64.chatgpt.site/');return {handled:true};}
 if(input==='✏️ Изменить'){if(!link.selected_id){await say('Сначала выбери анкету через «Мои анкеты» или «Поиск».');return {handled:true};}await telegramFlow(env,owner,'edit');await say('Какое поле изменить?',telegramKeyboard([['Имя','Возраст'],['Город','Контакт'],['День рождения','Где познакомились'],['Интересы','Любит'],['Не любит','Описание'],['Этап общения','Отмена']]));return {handled:true};}
 if(prompts[input]){const [flow,text]=prompts[input];if(!['add','find'].includes(flow)&&!link.selected_id){await say('Сначала выбери анкету через «Мои анкеты» или «Поиск».');return {handled:true};}await telegramFlow(env,owner,flow);await say(text,telegramKeyboard([['Отмена']]));return {handled:true};}
 if(input.startsWith('/')){await telegramFlow(env,owner,null);return {input};}
 if(link.flow&&link.flow_until<Date.now()){await telegramFlow(env,owner,null);await say('Время ввода истекло. Выбери действие заново — сообщение не сохранено.');return {handled:true};}if(!link.flow)return {input};
 if(link.flow.startsWith('choices:profile:')){const chosen=telegramChosen(link,input,'profile');if(chosen.error){await say(chosen.error);return {handled:true};}await telegramFlow(env,owner,null);return {input:'/select '+chosen.id};}
 if(link.flow==='edit'){const field=telegramEdits[input];if(!field){await say('Выбери поле кнопкой. «Отмена» возвращает меню.');return {handled:true};}await telegramFlow(env,owner,'edit:'+field);const hint=field==='birthday'?' в формате 2000-06-15':field==='tags'?' через запятую':field==='stage'?' из списка ниже':'';await say('Отправь новое значение'+hint+'. Для очистки отправь «-».',field==='stage'?telegramKeyboard([['Новое знакомство','Общаемся'],['Планируем встречу','Близкое общение'],['На паузе','Отмена']]):telegramKeyboard([['Отмена']]));return {handled:true};}
 if(link.flow==='photo'){await say('Жду фотографию. Чтобы выйти, нажми «Отмена».',telegramKeyboard([['Отмена']]));return {handled:true};}
 let value=input;
 if(link.flow==='meet'||link.flow==='remind')value=value.replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/,'$1T$2');
 if(link.flow==='edit:stage'){const stages={'Новое знакомство':'new','Общаемся':'chat','Планируем встречу':'date','Близкое общение':'close','На паузе':'pause'};if(!stages[value]){await say('Выбери этап кнопкой или нажми «Отмена».');return {handled:true};}value=stages[value];}
 const command=link.flow==='edit:stage'?'status':link.flow.startsWith('edit:')?'set '+link.flow.slice(5):link.flow;
 return {input:'/'+command+' '+value,fromFlow:true};
}
async function telegramProfileChoices(env,owner,profiles){return telegramChoices(env,owner,'profile',profiles,[['🔎 Поиск','➕ Новая анкета'],['🏠 Меню']]);}
