import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {createLocalEnv} from './local-env.mjs';
import worker from '../worker/index.js';
const {env,close}=createLocalEnv('.local');
const server=createServer(async(req,res)=>{try{const headers=new Headers();for(const[k,v]of Object.entries(req.headers))if(v)headers.set(k,Array.isArray(v)?v.join(','):v);headers.set('oai-authenticated-user-id','local-preview-owner');const request=new Request('http://127.0.0.1:4173'+req.url,{method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Readable.toWeb(req),duplex:'half'})});const response=await worker.fetch(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));if(response.body)for await(const chunk of response.body)res.write(chunk);res.end();}catch{res.writeHead(500);res.end('Preview error');}});
server.listen(4173,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:4173'));
process.once('SIGINT',()=>server.close(()=>{close();process.exit();}));
process.once('SIGTERM',()=>server.close(()=>{close();process.exit();}));
