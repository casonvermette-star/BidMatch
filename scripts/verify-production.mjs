import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { integrationConfig, supabaseHeaders } from '../lib/integrations.mjs';

const root=process.cwd();
function loadEnv(text){for(const line of text.split(/\r?\n/)){const t=line.trim();if(!t||t.startsWith('#')||!t.includes('='))continue;const i=t.indexOf('=');const k=t.slice(0,i).trim();let v=t.slice(i+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!(k in process.env))process.env[k]=v;}}
const envPath=join(root,'.env');if(existsSync(envPath))loadEnv(await readFile(envPath,'utf8'));
const results=[];const add=(name,ok,detail)=>results.push({name,ok,detail});
const cfg=integrationConfig(process.env);
add('APP_ENV',process.env.APP_ENV==='production',process.env.APP_ENV||'not set');
add('APP_URL',/^https:\/\//i.test(process.env.APP_URL||''),process.env.APP_URL||'not set');
add('DATA_BACKEND',cfg.supabase.dataBackend==='supabase',cfg.supabase.dataBackend);
add('Client authentication',String(process.env.REQUIRE_LOGIN||'true').toLowerCase()!=='false','REQUIRE_LOGIN must not be false');
add('Platform admin email',!!process.env.PLATFORM_ADMIN_EMAIL,process.env.PLATFORM_ADMIN_EMAIL?'configured':'missing');
add('Platform admin password hash',!!process.env.PLATFORM_ADMIN_PASSWORD_HASH,process.env.PLATFORM_ADMIN_PASSWORD_HASH?'configured':'missing');
add('Platform admin session secret',(process.env.PLATFORM_ADMIN_SESSION_SECRET||'').length>=24,(process.env.PLATFORM_ADMIN_SESSION_SECRET||'').length>=24?'configured':'missing/too short');
add('Supabase URL',/^https:\/\//i.test(process.env.SUPABASE_URL||''),process.env.SUPABASE_URL?'configured':'missing');
add('Supabase server secret',!!cfg.supabase.key,cfg.supabase.key?`${cfg.supabase.keyType} configured`:'missing');
add('Private storage bucket',!!process.env.SUPABASE_STORAGE_BUCKET,process.env.SUPABASE_STORAGE_BUCKET||'missing');
add('Transactional email',!!process.env.RESEND_API_KEY,process.env.RESEND_API_KEY?'configured':'missing');
add('Stripe secret',!!process.env.STRIPE_SECRET_KEY,process.env.STRIPE_SECRET_KEY?'configured':'missing');
add('Stripe webhook secret',!!process.env.STRIPE_WEBHOOK_SECRET,process.env.STRIPE_WEBHOOK_SECRET?'configured':'missing');
add('OpenAI',!!process.env.OPENAI_API_KEY,process.env.OPENAI_API_KEY?'configured':'optional / fallback mode');
if(cfg.supabase.configured){
  const tables=['organizations','app_users','projects','project_documents','contractors','scopes','contractor_matches','invitations','bids'];
  for(const table of tables){try{const r=await fetch(`${cfg.supabase.url}/rest/v1/${table}?select=*&limit=1`,{headers:supabaseHeaders(cfg.supabase)});add(`DB table ${table}`,r.ok,r.ok?'reachable':`${r.status} ${(await r.text()).slice(0,160)}`);}catch(e){add(`DB table ${table}`,false,e.message);}}
  try{const r=await fetch(`${cfg.supabase.url}/storage/v1/bucket/${encodeURIComponent(cfg.supabase.bucket)}`,{headers:supabaseHeaders(cfg.supabase)});add('Private storage API',r.ok,r.ok?'reachable':`${r.status} ${(await r.text()).slice(0,160)}`);}catch(e){add('Private storage API',false,e.message);}
}
console.log('\nBidMatch V8 production readiness\n');
for(const r of results)console.log(`${r.ok?'PASS':'WARN'}  ${r.name}: ${r.detail}`);
const critical=['APP_ENV','APP_URL','DATA_BACKEND','Client authentication','Platform admin email','Platform admin password hash','Platform admin session secret','Supabase URL','Supabase server secret','Private storage bucket'];
const failed=results.filter(r=>critical.includes(r.name)&&!r.ok);
console.log(`\n${failed.length?'Not production-ready yet.':'Core V8 production configuration checks passed.'}`);
if(failed.length)process.exitCode=2;
