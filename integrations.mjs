import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function integrationConfig(env=process.env){
  return {
    resend:{configured:!!env.RESEND_API_KEY,key:env.RESEND_API_KEY||'',from:env.EMAIL_FROM||'BidMatch AI <onboarding@resend.dev>'},
    stripe:{configured:!!env.STRIPE_SECRET_KEY,key:env.STRIPE_SECRET_KEY||'',webhookSecret:env.STRIPE_WEBHOOK_SECRET||'',priceId:env.STRIPE_PRICE_ID||'',successUrl:env.STRIPE_SUCCESS_URL||'http://localhost:3000/?billing=success',cancelUrl:env.STRIPE_CANCEL_URL||'http://localhost:3000/?billing=cancel'},
    supabase:{configured:!!(env.SUPABASE_URL&&env.SUPABASE_SERVICE_ROLE_KEY),url:String(env.SUPABASE_URL||'').replace(/\/$/,''),key:env.SUPABASE_SERVICE_ROLE_KEY||'',bucket:env.SUPABASE_STORAGE_BUCKET||'bidmatch-documents'},
    appUrl:env.APP_URL||'http://localhost:3000'
  };
}

export async function sendEmail(config,{to,subject,html,text,idempotencyKey}){
  if(!config?.configured) return {ok:false,skipped:true,error:'Email provider is not configured.'};
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${config.key}`,'Content-Type':'application/json',...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},body:JSON.stringify({from:config.from,to:Array.isArray(to)?to:[to],subject,html,text})});
  const payload=await response.json().catch(()=>({}));if(!response.ok)return {ok:false,status:response.status,error:payload.message||payload.error||`Email provider returned ${response.status}`};return {ok:true,id:payload.id||null};
}

export async function createCheckoutSession(config,{customerEmail,orgId,userId}){
  if(!config?.configured) throw new Error('Stripe is not configured.');
  if(!config.priceId) throw new Error('STRIPE_PRICE_ID is not configured.');
  const body=new URLSearchParams();body.set('mode','subscription');body.set('line_items[0][price]',config.priceId);body.set('line_items[0][quantity]','1');body.set('success_url',config.successUrl);body.set('cancel_url',config.cancelUrl);body.set('customer_email',customerEmail);body.set('client_reference_id',orgId);body.set('metadata[org_id]',orgId);body.set('metadata[user_id]',userId);body.set('subscription_data[metadata][org_id]',orgId);body.set('subscription_data[metadata][user_id]',userId);body.set('allow_promotion_codes','true');
  const response=await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{Authorization:`Bearer ${config.key}`,'Content-Type':'application/x-www-form-urlencoded'},body});const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error?.message||`Stripe returned ${response.status}`);return payload;
}

function supaHeaders(config,extra={}){return {apikey:config.key,Authorization:`Bearer ${config.key}`,...extra};}
export async function supabaseHealth(config){
  if(!config?.configured) return {ok:false,configured:false};
  try{const [state,auth]=await Promise.all([fetch(`${config.url}/rest/v1/bidmatch_state?select=id&limit=1`,{headers:supaHeaders(config)}),fetch(`${config.url}/rest/v1/bidmatch_auth_state?select=id&limit=1`,{headers:supaHeaders(config)})]);const ok=state.ok&&auth.ok;return {ok,configured:true,status:ok?200:(!state.ok?state.status:auth.status),error:ok?'':(!state.ok?await state.text():await auth.text())};}catch(error){return {ok:false,configured:true,error:error.message};}
}
export async function loadCloudState(config){
  if(!config?.configured) return null;const r=await fetch(`${config.url}/rest/v1/bidmatch_state?id=eq.primary&select=payload`,{headers:supaHeaders(config)});if(!r.ok)return null;const rows=await r.json();return rows?.[0]?.payload||null;
}
export async function saveCloudState(config,payload){
  if(!config?.configured) return {ok:false,skipped:true};const r=await fetch(`${config.url}/rest/v1/bidmatch_state?on_conflict=id`,{method:'POST',headers:supaHeaders(config,{'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'}),body:JSON.stringify([{id:'primary',payload,updated_at:new Date().toISOString()}])});return {ok:r.ok,status:r.status,error:r.ok?'':await r.text()};
}

export async function loadCloudAuthState(config){
  if(!config?.configured) return null;const r=await fetch(`${config.url}/rest/v1/bidmatch_auth_state?id=eq.primary&select=payload`,{headers:supaHeaders(config)});if(!r.ok)return null;const rows=await r.json();return rows?.[0]?.payload||null;
}
export async function saveCloudAuthState(config,payload){
  if(!config?.configured) return {ok:false,skipped:true};const r=await fetch(`${config.url}/rest/v1/bidmatch_auth_state?on_conflict=id`,{method:'POST',headers:supaHeaders(config,{'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'}),body:JSON.stringify([{id:'primary',payload,updated_at:new Date().toISOString()}])});return {ok:r.ok,status:r.status,error:r.ok?'':await r.text()};
}
export async function uploadSupabaseObject(config,{path,buffer,mime='application/octet-stream'}){
  if(!config?.configured) return {ok:false,skipped:true};const encoded=path.split('/').map(encodeURIComponent).join('/');const r=await fetch(`${config.url}/storage/v1/object/${encodeURIComponent(config.bucket)}/${encoded}`,{method:'POST',headers:supaHeaders(config,{'Content-Type':mime,'x-upsert':'false'}),body:buffer});const payload=await r.json().catch(()=>({}));return {ok:r.ok,status:r.status,path,error:r.ok?'':payload.message||payload.error||`Storage returned ${r.status}`};
}
export async function downloadSupabaseObject(config,path){
  if(!config?.configured) throw new Error('Supabase Storage is not configured.');const encoded=path.split('/').map(encodeURIComponent).join('/');const r=await fetch(`${config.url}/storage/v1/object/authenticated/${encodeURIComponent(config.bucket)}/${encoded}`,{headers:supaHeaders(config)});if(!r.ok)throw new Error(`Storage download failed (${r.status}).`);return Buffer.from(await r.arrayBuffer());
}

export function createBackupManager({rootDir,dataFile,authFile}){
  const backupDir=join(rootDir,'backups');
  return {async create(label='manual'){await mkdir(backupDir,{recursive:true});const stamp=new Date().toISOString().replace(/[:.]/g,'-');const path=join(backupDir,`${stamp}-${String(label).replace(/[^a-z0-9_-]+/gi,'-').slice(0,30)}.json`);const db=existsSync(dataFile)?JSON.parse(await readFile(dataFile,'utf8')):null;const auth=existsSync(authFile)?JSON.parse(await readFile(authFile,'utf8')):null;await writeFile(path,JSON.stringify({createdAt:new Date().toISOString(),db,auth},null,2));return path;}};
}
