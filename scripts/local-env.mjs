import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync,writeFileSync,existsSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
export function createLocalEnv(root){
 if(root)mkdirSync(root,{recursive:true});
 const sqlite=new DatabaseSync(root?resolve(root,'notebook.sqlite'):':memory:');
 if(!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='profiles'").get())sqlite.exec(readFileSync(new URL('../drizzle/0000_notebook.sql',import.meta.url),'utf8').replaceAll('--> statement-breakpoint',''));
 if(!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'").get())sqlite.exec(readFileSync(new URL('../drizzle/0001_accounts.sql',import.meta.url),'utf8').replaceAll('--> statement-breakpoint',''));
 if(!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tg_links'").get())sqlite.exec(readFileSync(new URL('../drizzle/0002_telegram_webhook.sql',import.meta.url),'utf8').replaceAll('--> statement-breakpoint',''));
 if(!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='diary_preferences'").get())sqlite.exec(readFileSync(new URL('../drizzle/0003_diary_modes.sql',import.meta.url),'utf8'));
 if(!sqlite.prepare('PRAGMA table_info(tg_links)').all().some(c=>c.name==='flow'))sqlite.exec(readFileSync(new URL('../drizzle/0004_telegram_buttons.sql',import.meta.url),'utf8').replaceAll('--> statement-breakpoint',''));
 function statement(sql,args=[]){return {bind(...a){return statement(sql,a);},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){return sqlite.prepare(sql).run(...args);}};}
 const objects=new Map();if(root)mkdirSync(resolve(root,'photos'),{recursive:true});
 const fileFor=k=>resolve(root,'photos',Buffer.from(k).toString('hex'));
 const env={AUTH_PEPPER:'local-preview-only-secret',DB:{prepare:statement,async batch(stmts){sqlite.exec('BEGIN');try{const results=[];for(const s of stmts)results.push(await s.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}},BUCKET:{async put(key,bytes){if(root)writeFileSync(fileFor(key),bytes);else objects.set(key,bytes);},async get(key){if(root)return existsSync(fileFor(key))?{body:readFileSync(fileFor(key))}:null;return objects.has(key)?{body:objects.get(key)}:null;},async delete(key){if(root){if(existsSync(fileFor(key)))unlinkSync(fileFor(key));}else objects.delete(key);}}};
 return {env,sqlite,close:()=>sqlite.close()};
}
