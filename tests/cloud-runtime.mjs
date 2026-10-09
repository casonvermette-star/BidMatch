import http from 'node:http';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomBytes, scryptSync } from 'node:crypto';

const tableNames=['organizations','app_users','app_sessions','app_invites','password_resets','organization_settings','projects','contractors','project_documents','scopes','contractor_matches','invitations','bids','project_questions','audit_events','subscriptions','background_jobs'];
const memory=Object.fromEntries(tableNames.map(t=>[t,[]]));let badBearer=false;
function readBody(req){return new Promise((resolve,reject)=>{const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{try{resolve(chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):null)}catch(e){reject(e)}});req.on('error',reject);});}
const supa=http.createServer(async(req,res)=>{
  if(req.headers.apikey!=='sb_secret_cloud_runtime') {res.writeHead(401);return res.end('bad api key');}
  if(req.headers.authorization)badBearer=true;
  const u=new URL(req.url,'http://localhost');const parts=u.pathname.split('/').filter(Boolean);
  if(parts[0]==='rest'&&parts[1]==='v1'&&memory[parts[2]]){
    const table=parts[2],pk=(table==='organization_settings'||table==='subscriptions')?'organization_id':'id';
    if(req.method==='GET'){res.setHeader('content-type','application/json');return res.end(JSON.stringify(memory[table]));}
    if(req.method==='POST'){const rows=await readBody(req)||[];for(const row of rows){const i=memory[table].findIndex(x=>String(x[pk])===String(row[pk]));if(i>=0)memory[table][i]=row;else memory[table].push(row);}res.writeHead(201);return res.end();}
    if(req.method==='DELETE'){const v=u.searchParams.get(pk)?.replace(/^eq\./,'');memory[table]=memory[table].filter(x=>String(x[pk])!==String(v));res.writeHead(204);return res.end();}
  }
  res.writeHead(404);res.end('not found');
});
await new Promise(r=>supa.listen(0,'127.0.0.1',r));const supaUrl=`http://127.0.0.1:${supa.address().port}`;
const here=dirname(fileURLToPath(import.meta.url)),source=join(here,'..'),work=await mkdtemp(join(tmpdir(),'bidmatch-v8-cloud-'));
await cp(source,work,{recursive:true,filter:src=>!src.includes('/backups/')&&!src.endsWith('/.env')&&!src.endsWith('/data/auth.json')});
const localDb=JSON.parse(await readFile(join(work,'data','db.json'),'utf8'));Object.assign(localDb,{projects:[],documents:[],scopes:[],matches:[],invitations:[],bids:[],qa:[],events:[],jobs:[],orgSettings:{},billing:{}});await writeFile(join(work,'data','db.json'),JSON.stringify(localDb,null,2));
const port=34729,adminPassword='AdminCloud1234!',salt=randomBytes(16).toString('hex'),adminHash=`${salt}:${scryptSync(adminPassword,salt,64).toString('hex')}`;
const child=spawn(process.execPath,['server.mjs'],{cwd:work,env:{...process.env,PORT:String(port),APP_ENV:'development',DATA_BACKEND:'supabase',REQUIRE_LOGIN:'true',ALLOW_SELF_SIGNUP:'true',SUPABASE_URL:supaUrl,SUPABASE_SECRET_KEY:'sb_secret_cloud_runtime',SUPABASE_SERVICE_ROLE_KEY:'',SUPABASE_STORAGE_BUCKET:'bidmatch-documents',OPENAI_API_KEY:'',RESEND_API_KEY:'',STRIPE_SECRET_KEY:'',PLATFORM_ADMIN_EMAIL:'platform@cloud.test',PLATFORM_ADMIN_PASSWORD_HASH:adminHash,PLATFORM_ADMIN_SESSION_SECRET:'cloud-admin-session-secret-123456789'},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
const base=`http://127.0.0.1:${port}`,cookies=new Map(),sleep=ms=>new Promise(r=>setTimeout(r,ms));
function cookieHeader(){return [...cookies.entries()].map(([k,v])=>`${k}=${v}`).join('; ');}function setCookie(v){if(!v)return;for(const raw of v.split(/,(?=[^;,]+=)/)){const pair=raw.split(';')[0],i=pair.indexOf('=');if(i<1)continue;const k=pair.slice(0,i).trim(),val=pair.slice(i+1).trim();if(val)cookies.set(k,val);else cookies.delete(k);}}
async function req(path,{method='GET',body}={}){const res=await fetch(base+path,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(cookieHeader()?{Cookie:cookieHeader()}:{})},body:body===undefined?undefined:JSON.stringify(body)});setCookie(res.headers.get('set-cookie'));const type=res.headers.get('content-type')||'',out=type.includes('application/json')?await res.json():await res.text();if(!res.ok)throw new Error(`${method} ${path} -> ${res.status}: ${typeof out==='string'?out:JSON.stringify(out)}`);return out;}
try{
  let ready=false;for(let i=0;i<60;i++){try{const h=await req('/api/health');if(h.ok&&h.dataBackend==='supabase'){ready=true;break}}catch{}await sleep(100);}if(!ready)throw new Error(`V8 cloud server failed to start: ${logs}`);
  const status=await req('/api/auth/status');if(!status.requiresBootstrap)throw new Error('empty cloud runtime should require bootstrap');
  await req('/api/auth/bootstrap',{method:'POST',body:{orgName:'Cloud GC',name:'Owner',email:'owner@cloud.test',password:'CloudTest1234'}});
  const project=await req('/api/projects',{method:'POST',body:{name:'Cloud Runtime Project',location:'Columbia, MO',projectType:'Commercial',estimatedValue:1000000,bidDue:'2027-02-01',description:'Cloud runtime test',files:[]}});
  if(!project.project?.id)throw new Error('project create failed');
  if(memory.organizations.length!==1||memory.app_users.length!==1||memory.projects.length!==1)throw new Error('server did not persist normalized cloud rows');
  const state=await req('/api/state');if(state.config.dataBackend!=='supabase')throw new Error('state did not report Supabase runtime');
  if(badBearer)throw new Error('server sent sb_secret key as Bearer token');
  console.log('PASS V8 full server booted against normalized Supabase runtime and persisted auth/project rows with sb_secret apikey auth.');
} finally {child.kill('SIGTERM');supa.close();await sleep(100);await rm(work,{recursive:true,force:true});}
