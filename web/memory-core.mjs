export function dateIdeas(profile,variant=0){
 const interests=[profile.likes,...(profile.tags||[])].filter(Boolean).join(' ').toLocaleLowerCase('ru'),avoid=(profile.avoid||'').toLocaleLowerCase('ru');
 const catalog=[
 {title:'Кофе и неспешный разговор',text:'Выберите тихую кофейню и оставьте час без плотных планов.',match:/коф|кафе|разговор/,ban:/коф|кафе|кофеин/,kind:'В помещении'},
 {title:'Прогулка с маленькой остановкой',text:'Знакомый парк, спокойный маршрут и чай по дороге. Продолжительность выберите вместе.',match:/прогул|парк|природ|пеш/,ban:/прогул|парк|холод|улиц/,kind:'На свежем воздухе'},
 {title:'Выставка и обмен впечатлениями',text:'Выберите выставку на интересную обоим тему. После обсудите по одной работе, которая запомнилась.',match:/искус|выстав|музе|картин|дизайн/,ban:/музе|выстав|искус/,kind:'Культура'},
 {title:'Книжный маршрут',text:'Зайдите в книжный и выберите друг для друга книгу — покупать её необязательно.',match:/книг|чтен|литерат/,ban:/книг|чтен/,kind:'Спокойный план'},
 {title:'Творческий мастер-класс',text:'Керамика или рисование: заранее сравните программы и выберите то, что нравится обоим.',match:/керамик|рисов|твор|рукодел/,ban:/керамик|рисов|мастер|твор/,kind:'Новое вместе'},
 {title:'Настольная игра на двоих',text:'Выберите простую кооперативную игру и место, где можно спокойно поговорить.',match:/настол|игр|головолом/,ban:/игр|настол|соревн/,kind:'Неформально'},
 {title:'Музыкальный вечер',text:'Обменяйтесь любимыми треками и вместе выберите камерный концерт. Громкость и формат обсудите заранее.',match:/музык|концерт|джаз|песн/,ban:/шум|громк|музык|концерт|толп/,kind:'Музыка'},
 {title:'Десерт и планы на выходные',text:'Каждый выбирает десерт для себя и делится одной идеей для следующей встречи.',match:/слад|десерт|выпеч|пирож/,ban:/слад|сахар|десерт|выпеч/,kind:'Короткая встреча'}
 ];
 const ranked=catalog.filter(c=>!c.ban.test(avoid)).map((c,i)=>({...c,score:c.match.test(interests)?2:0,order:(i+variant)%catalog.length})).sort((a,b)=>b.score-a.score||a.order-b.order);
 return ranked.slice(0,3).map(c=>({title:c.title,text:c.text,kind:c.kind,reason:c.score?'По записанным интересам':'Нейтральная идея — уточни, нравится ли вам обоим'}));
}
export function reminderItems(profiles,reference=new Date()){
 const items=[],today=new Date(reference.getFullYear(),reference.getMonth(),reference.getDate());
 for(const p of profiles.filter(p=>p.stage!=='archive')){
  for(const r of p.reminders||[])items.push({...r,profileId:p.id,name:p.name,type:'manual'});
  if(p.meetingAt){const time=new Date(p.meetingAt);if(time>=reference&&time-reference<=86400000)items.push({id:'meeting-'+p.id,profileId:p.id,name:p.name,type:'meeting',text:'Встреча'+(p.meetingPlace?' · '+p.meetingPlace:''),dueAt:p.meetingAt,done:false});}
  if(p.birthday){const m=Number(p.birthday.slice(5,7))-1,d=Number(p.birthday.slice(8,10));let next=new Date(today.getFullYear(),m,d);if(next.getMonth()!==m)next=new Date(today.getFullYear(),m,28);if(next<today){next=new Date(today.getFullYear()+1,m,d);if(next.getMonth()!==m)next=new Date(today.getFullYear()+1,m,28);}const days=Math.round((next-today)/86400000);if(days<=7)items.push({id:'birthday-'+p.id,profileId:p.id,name:p.name,type:'birthday',text:days===0?'Сегодня день рождения':'День рождения через '+days+' дн.',dueAt:next.getFullYear()+'-'+String(next.getMonth()+1).padStart(2,'0')+'-'+String(next.getDate()).padStart(2,'0')+'T12:00',done:false});}
 }
 return items.sort((a,b)=>Number(a.done)-Number(b.done)||a.dueAt.localeCompare(b.dueAt));
}
export function storyItems(p){
 const items=[{id:'start',type:'start',title:'Начало истории',text:p.source?'Знакомство: '+p.source:'Анкета создана',createdAt:p.createdAt},...(p.history||[])];
 for(const n of p.notes||[])items.push({...n,type:'note',title:'Заметка'});
 for(const r of p.reflections||[])items.push({...r,type:'reflection',title:'После встречи',createdAt:r.metAt,text:[r.feeling,r.text,r.topics?'Обсуждали: '+r.topics:'',r.nextStep?'Дальше: '+r.nextStep:'', 'Ещё встретиться: '+({yes:'да',maybe:'пока думаю',no:'нет'}[r.wantAgain]||'пока думаю')].filter(Boolean).join('\n')});
 for(const ph of p.photos||[])items.push({id:ph.id,type:'photo',title:'Добавлена фотография',text:'',photoId:ph.id,createdAt:ph.created_at});
 if(p.meetingAt&&!items.some(i=>i.type==='meeting'&&i.text?.includes(p.meetingAt)))items.push({id:'meeting-current',type:'meeting',title:'Встреча в текущих планах',text:p.meetingAt+' · '+(p.meetingPlace||''),createdAt:p.meetingAt});
 return items.filter(i=>i.createdAt).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
}
