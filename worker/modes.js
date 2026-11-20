function validDiaryMode(mode){if(!['girls','boys'].includes(mode))fail('Выбери режим: девушки или парни.');return mode;}
async function getDiaryMode(env,owner){return (await env.DB.prepare('SELECT mode FROM diary_preferences WHERE owner=?').bind(owner).first())?.mode||'girls';}
async function saveDiaryMode(env,owner,mode){validDiaryMode(mode);await env.DB.prepare('INSERT INTO diary_preferences (owner,mode) VALUES (?,?) ON CONFLICT(owner) DO UPDATE SET mode=excluded.mode').bind(owner,mode).run();return mode;}
async function createDiaryProfile(env,owner,raw){const mode=await getDiaryMode(env,owner);return save(env,owner,{...clean({...raw,gender:raw.gender??(mode==='boys'?'male':'female')}),id:crypto.randomUUID()});}
