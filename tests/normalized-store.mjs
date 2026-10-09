import http from 'node:http';
import { createNormalizedSupabaseStore } from '../lib/supabase-normalized.mjs';

const tables=['organizations','app_users','app_sessions','app_invites','password_resets','organization_settings','projects','contractors','project_documents','scopes','contractor_matches','invitations','bids','project_questions','audit_events','subscriptions','background_jobs'];
const memory=Object.fromEntries(tables.map(t=>[t,[]]));
let sawAuthorization=false;let sawApiKey=false;
function body(req){return new Promise((resolve,reject)=>{const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{try{resolve(chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):null)}catch(e){reject(e)}});req.on('error',reject);});}
const server=http.createServer(async(req,res)=>{
  sawAuthorization ||= !!req.headers.authorization;
  sawApiKey ||= req.headers.apikey==='sb_secret_test_key';
  const u=new URL(req.url,'http://localhost');const parts=u.pathname.split('/').filter(Boolean);const table=parts[2];
  if(parts[0]!=='rest'||parts[1]!=='v1'||!memory[table]){res.writeHead(404);return res.end('not found');}
  if(req.method==='GET'){res.setHeader('content-type','application/json');return res.end(JSON.stringify(memory[table]));}
  if(req.method==='POST'){
    const rows=await body(req)||[];const pk=(table==='organization_settings'||table==='subscriptions')?'organization_id':'id';
    for(const row of rows){const i=memory[table].findIndex(x=>String(x[pk])===String(row[pk]));if(i>=0)memory[table][i]=row;else memory[table].push(row);}
    res.writeHead(201);return res.end('');
  }
  if(req.method==='DELETE'){
    const pk=(table==='organization_settings'||table==='subscriptions')?'organization_id':'id';const value=u.searchParams.get(pk)?.replace(/^eq\./,'');memory[table]=memory[table].filter(x=>String(x[pk])!==String(value));res.writeHead(204);return res.end();
  }
  res.writeHead(405);res.end();
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port;
const config={configured:true,url:`http://127.0.0.1:${port}`,key:'sb_secret_test_key',keyType:'secret',bucket:'bidmatch-documents',dataBackend:'supabase'};
const store=await createNormalizedSupabaseStore(config);
if(store.runtime.auth.users.length!==0)throw new Error('fresh normalized store should be empty');
const orgId='11111111-1111-4111-8111-111111111111';const userId='22222222-2222-4222-8222-222222222222';const projectId='33333333-3333-4333-8333-333333333333';
const auth={version:2,organizations:[{id:orgId,name:'Cloud Test GC',createdAt:'2026-10-03T12:00:00.000Z'}],users:[{id:userId,orgId,email:'owner@test.example',name:'Owner',role:'owner',passwordHash:'salt:hash',active:true,createdAt:'2026-10-03T12:00:00.000Z'}],sessions:[],invites:[],passwordResets:[]};
await store.saveAuth(auth);
const db={version:5,settings:{},orgSettings:{[orgId]:{organizationName:'Cloud Test GC'}},billing:{},jobs:[],projects:[{id:projectId,orgId,createdBy:userId,name:'Cloud Project',location:'Columbia, MO',state:'MO',projectType:'Commercial',estimatedValue:1000000,bidDue:'2027-01-01',description:'Test',status:'draft',workflowStage:'intake',analysis:null,createdAt:'2026-10-03T12:00:00.000Z'}],documents:[],contractors:[],scopes:[],matches:[],invitations:[],bids:[],qa:[],events:[]};
await store.saveDb(db);
if(memory.organizations.length!==1||memory.projects.length!==1)throw new Error('normalized rows were not written');
if(!sawApiKey)throw new Error('Supabase secret key must be sent on apikey header');
if(sawAuthorization)throw new Error('sb_secret_* must not be sent as Authorization Bearer');
const store2=await createNormalizedSupabaseStore(config);const rt=store2.runtime;
if(rt.auth.users[0]?.email!=='owner@test.example'||rt.db.projects[0]?.name!=='Cloud Project')throw new Error('normalized round trip failed');
rt.db.projects=[];await store2.saveDb(rt.db);if(memory.projects.length!==0)throw new Error('normalized deletion sync failed');
server.close();
console.log('PASS V8 normalized Supabase runtime round-trip and sb_secret header behavior.');
