import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { integrationConfig, supabaseHeaders } from '../lib/integrations.mjs';

function loadDotEnv(path){if(!existsSync(path))return;const txt=requireText(path);for(const line of txt.split(/\r?\n/)){const t=line.trim();if(!t||t.startsWith('#')||!t.includes('='))continue;const i=t.indexOf('=');const k=t.slice(0,i).trim();let v=t.slice(i+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!(k in process.env))process.env[k]=v;}}
function requireText(path){return String(requireText.cache?.[path]??'');}
requireText.cache={};
const root=process.cwd();const envPath=join(root,'.env');if(existsSync(envPath))requireText.cache[envPath]=await readFile(envPath,'utf8');loadDotEnv(envPath);
const apply=process.argv.includes('--apply');
const cfg=integrationConfig(process.env);const supa=cfg.supabase;
if(apply&&!supa.configured) throw new Error('Apply mode requires SUPABASE_URL and SUPABASE_SECRET_KEY in .env (legacy SUPABASE_SERVICE_ROLE_KEY is supported only for migration compatibility).');
const exportPath=join(root,'data','normalized-export.json');
const exp=spawnSync(process.execPath,[join(root,'scripts','export-normalized.mjs')],{cwd:root,stdio:'inherit'});if(exp.status!==0)process.exit(exp.status||1);
const data=JSON.parse(await readFile(exportPath,'utf8'));
const bucket=supa.bucket||'bidmatch-documents';
if(apply&&Array.isArray(data.project_documents)){
  const projectOrg=new Map((data.projects||[]).map(p=>[p.id,p.organization_id]));
  for(const doc of data.project_documents){
    if(doc.storage_provider==='supabase'&&doc.storage_path)continue;
    const disk=doc.metadata?.legacyDiskName;if(!disk)continue;
    const local=join(root,'data','uploads',disk);if(!existsSync(local)){console.warn(`Document bytes not found locally: ${doc.file_name}`);continue;}
    const safe=String(doc.file_name||'document').replace(/[^a-zA-Z0-9._-]+/g,'-').slice(-100);
    const path=`${projectOrg.get(doc.project_id)||'unclaimed'}/${doc.project_id}/${doc.id}-${safe}`;const encoded=path.split('/').map(encodeURIComponent).join('/');const bytes=await readFile(local);
    const up=await fetch(`${supa.url}/storage/v1/object/${encodeURIComponent(bucket)}/${encoded}`,{method:'POST',headers:supabaseHeaders(supa,{'Content-Type':doc.mime_type||'application/octet-stream','x-upsert':'true'}),body:bytes});
    if(!up.ok)throw new Error(`Document upload failed for ${doc.file_name} (${up.status}): ${await up.text()}`);
    doc.storage_provider='supabase';doc.storage_path=path;console.log(`uploaded document: ${doc.file_name}`);
  }
}
const order=['organizations','app_users','app_sessions','app_invites','password_resets','organization_settings','projects','contractors','project_documents','scopes','contractor_matches','invitations','bids','project_questions','audit_events','subscriptions','background_jobs'];
console.log(apply?'APPLY MODE: writing normalized data to Supabase.':'DRY RUN: no cloud data will be changed. Add --apply when ready.');
for(const table of order){
  const rows=data[table]||[];console.log(`${table}: ${rows.length}`);if(!apply||!rows.length)continue;
  const conflict=(table==='organization_settings'||table==='subscriptions')?'organization_id':'id';
  const response=await fetch(`${supa.url}/rest/v1/${table}?on_conflict=${conflict}`,{method:'POST',headers:supabaseHeaders(supa,{'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'}),body:JSON.stringify(rows)});
  if(!response.ok)throw new Error(`${table} migration failed (${response.status}): ${await response.text()}`);
}
console.log(apply?'Normalized database migration completed. Set DATA_BACKEND=supabase and restart BidMatch to use PostgreSQL as the runtime source of truth.':'Dry run complete. Review data/normalized-export.json before using --apply.');
