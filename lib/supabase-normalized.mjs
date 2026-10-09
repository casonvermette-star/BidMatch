import { supabaseHeaders } from './integrations.mjs';

const AUTH_TABLES=['organizations','app_users','app_sessions','app_invites','password_resets'];
const DB_TABLES=['organization_settings','projects','contractors','project_documents','scopes','contractor_matches','invitations','bids','project_questions','audit_events','subscriptions','background_jobs'];
const ALL_TABLES=[...AUTH_TABLES,...DB_TABLES];
const PRIMARY_KEY={organization_settings:'organization_id',subscriptions:'organization_id'};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function pkFor(table){return PRIMARY_KEY[table]||'id';}
function clean(v){return v===undefined?null:v;}
function iso(v){return v||new Date().toISOString();}
function requireUuid(value,label){if(value==null)return null;if(!UUID.test(String(value)))throw new Error(`${label} must be a UUID in DATA_BACKEND=supabase mode. Run the V8 migration before switching the runtime.`);return String(value);}
function mapBy(rows,key='id'){return new Map((rows||[]).map(r=>[String(r[key]),r]));}

async function rest(config,path,{method='GET',body,headers={}}={}){
  const response=await fetch(`${config.url}/rest/v1/${path}`,{method,headers:supabaseHeaders(config,{...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers}),body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();
  if(!response.ok) throw new Error(`Supabase ${method} ${path} failed (${response.status}): ${text.slice(0,500)}`);
  if(!text)return null;
  try{return JSON.parse(text);}catch{return text;}
}

async function fetchAll(config,table){
  const pageSize=500;const rows=[];
  for(let offset=0;;offset+=pageSize){
    const response=await fetch(`${config.url}/rest/v1/${table}?select=*`,{headers:supabaseHeaders(config,{Range:`${offset}-${offset+pageSize-1}`})});
    const text=await response.text();
    if(!response.ok) throw new Error(`Supabase table ${table} is unavailable (${response.status}): ${text.slice(0,500)}`);
    const page=text?JSON.parse(text):[];rows.push(...page);if(page.length<pageSize)break;
  }
  return rows;
}

function emptyDb(){return {version:5,settings:{},orgSettings:{},billing:{},jobs:[],projects:[],documents:[],contractors:[],scopes:[],matches:[],invitations:[],bids:[],qa:[],events:[]};}
function emptyAuth(){return {version:2,organizations:[],users:[],sessions:[],invites:[],passwordResets:[]};}

export function normalizedToRuntime(tables){
  const db=emptyDb(),auth=emptyAuth();
  auth.organizations=(tables.organizations||[]).map(r=>({id:r.id,name:r.name,createdAt:r.created_at}));
  auth.users=(tables.app_users||[]).map(r=>({id:r.id,orgId:r.organization_id,email:r.email,name:r.display_name||'',role:r.role,passwordHash:r.password_hash||'',active:r.active!==false,createdAt:r.created_at,lastLoginAt:r.last_login_at||null}));
  auth.sessions=(tables.app_sessions||[]).map(r=>({id:r.id,userId:r.user_id,tokenHash:r.token_hash,createdAt:r.created_at,expiresAt:r.expires_at}));
  auth.invites=(tables.app_invites||[]).map(r=>({id:r.id,orgId:r.organization_id,email:r.email,role:r.role,tokenHash:r.token_hash,createdBy:r.created_by||null,createdAt:r.created_at,expiresAt:r.expires_at,acceptedAt:r.accepted_at||null}));
  auth.passwordResets=(tables.password_resets||[]).map(r=>({id:r.id,userId:r.user_id,tokenHash:r.token_hash,createdAt:r.created_at,expiresAt:r.expires_at,usedAt:r.used_at||null}));

  db.orgSettings=Object.fromEntries((tables.organization_settings||[]).map(r=>[r.organization_id,r.settings||{}]));
  db.projects=(tables.projects||[]).map(r=>({id:r.id,orgId:r.organization_id,createdBy:r.created_by||null,name:r.name,location:r.location||'',state:r.state||'',projectType:r.project_type||'',estimatedValue:Number(r.estimated_value||0),bidDue:r.bid_due||'',description:r.description||'',status:r.status||'draft',workflowStage:r.workflow_stage||'intake',analysis:r.analysis||null,createdAt:r.created_at,updatedAt:r.updated_at||r.created_at}));
  db.documents=(tables.project_documents||[]).map(r=>({id:r.id,projectId:r.project_id,name:r.file_name,mime:r.mime_type||'application/octet-stream',size:Number(r.file_size||0),diskName:'',storageProvider:r.storage_provider||'supabase',storagePath:r.storage_path||'',kind:r.kind||'project-document',bidId:r.bid_id||null,invitationId:r.invitation_id||null,contractorId:r.contractor_id||null,parsedText:r.parsed_text||'',metadata:r.metadata||{},createdAt:r.created_at}));
  db.contractors=(tables.contractors||[]).map(r=>({id:r.id,orgId:r.organization_id||null,name:r.company_name,email:r.email||'',city:r.city||'',homeState:r.home_state||'',serviceStates:r.service_states||[],licenseStates:r.license_states||[],markets:r.markets||[],trades:r.trades||[],capabilities:r.capabilities||[],minPackage:Number(r.min_package||0),maxPackage:Number(r.max_package||0),insuranceLimit:Number(r.insurance_limit||0),bondCapacity:Number(r.bond_capacity||0),responseRate:Number(r.response_rate||0),avgResponseHours:Number(r.avg_response_hours||0),employees:Number(r.employees||0),yearsInBusiness:Number(r.years_in_business||0),avgAnnualVolume:Number(r.avg_annual_volume||0),currentBacklog:Number(r.current_backlog||0),backlogUtilization:Number(r.backlog_utilization||0),qualityScore:Number(r.quality_score||0),onTimeRate:Number(r.on_time_rate||0),relationshipScore:Number(r.relationship_score||0),prequalStatus:r.prequal_status||'',safety:r.safety_data||{},insuranceExpiry:r.insurance_expiry||null,bondingStatus:r.bonding_status||'',certifications:r.certifications||[],description:r.description||'',pastProjects:r.past_projects||[],qualified:(r.qualification_data||{}).qualified!==false,demoData:!!r.demo_data,lastVerified:r.last_verified||null,createdAt:r.created_at,updatedAt:r.updated_at||r.created_at}));
  db.scopes=(tables.scopes||[]).map(r=>({id:r.id,projectId:r.project_id,trade:r.trade,division:r.csi_division||'',csiDivision:r.csi_division||'',summary:r.summary||'',requirements:r.requirements||[],keywords:r.keywords||[],confidence:Number(r.confidence||0),estimatedPackage:Number(r.estimated_package||0),manualEstimate:!!r.manual_estimate,qualification:r.qualification||null,source:r.source||'automation',createdAt:r.created_at,updatedAt:r.updated_at||r.created_at}));
  db.matches=(tables.contractor_matches||[]).map(r=>({id:r.id,projectId:r.project_id,scopeId:r.scope_id,contractorId:r.contractor_id,eligible:r.eligible!==false,qualificationStatus:r.qualification_status||'conditional',score:Number(r.score||0),recommendation:r.recommendation||'',components:r.components||{},reasons:r.reasons||[],risks:r.risks||[],qualification:r.qualification||{},createdAt:r.created_at,updatedAt:r.updated_at||r.created_at}));
  db.invitations=(tables.invitations||[]).map(r=>({id:r.id,projectId:r.project_id,scopeId:r.scope_id,contractorId:r.contractor_id,status:r.status||'queued',message:r.message||'',manual:!!r.manual,sentExternally:!!r.sent_externally,externalMessageId:r.external_message_id||null,publicTokenHash:r.public_token_hash||null,publicTokenExpiresAt:r.public_token_expires_at||null,sentAt:r.sent_at||null,createdAt:r.created_at,updatedAt:r.updated_at||null}));
  db.bids=(tables.bids||[]).map(r=>({id:r.id,projectId:r.project_id,scopeId:r.scope_id,contractorId:r.contractor_id,raw:r.raw_proposal||'',parsed:r.parsed||{},manualAdjustment:Number(r.manual_adjustment||0),manualAdjustmentReason:r.manual_adjustment_reason||'',proposalDocumentId:r.proposal_document_id||null,createdAt:r.created_at,updatedAt:r.updated_at||null}));
  db.qa=(tables.project_questions||[]).map(r=>({id:r.id,projectId:r.project_id,userId:r.user_id||null,question:r.question,answer:r.answer||'',sources:r.sources||[],createdAt:r.created_at}));
  db.events=(tables.audit_events||[]).map(r=>({id:r.id,type:r.event_type||'activity',projectId:r.project_id||null,message:r.message||'',meta:{...(r.metadata||{}),orgId:r.organization_id||r.metadata?.orgId||null,actorUserId:r.actor_user_id||r.metadata?.actorUserId||null},createdAt:r.created_at})).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  db.billing=Object.fromEntries((tables.subscriptions||[]).map(r=>[r.organization_id,{...(r.metadata||{}),status:r.status||'not-configured',plan:r.plan||'none',customerId:r.customer_id||null,subscriptionId:r.subscription_id||null,updatedAt:r.updated_at}]));
  db.jobs=(tables.background_jobs||[]).map(r=>({id:r.id,orgId:r.organization_id||null,type:r.job_type,status:r.status||'queued',runAt:r.run_at,payload:r.payload||{},error:r.error||null,attempts:Number(r.attempts||0),createdAt:r.created_at,completedAt:r.completed_at||null}));
  return {db,auth};
}

export function authToNormalized(auth){
  return {
    organizations:(auth.organizations||[]).map(o=>({id:requireUuid(o.id,'organization id'),name:o.name,created_at:iso(o.createdAt)})),
    app_users:(auth.users||[]).map(u=>({id:requireUuid(u.id,'user id'),organization_id:requireUuid(u.orgId,'user organization id'),email:u.email,display_name:u.name||'',role:u.role,password_hash:u.passwordHash||null,active:u.active!==false,created_at:iso(u.createdAt),last_login_at:u.lastLoginAt||null})),
    app_sessions:(auth.sessions||[]).map(s=>({id:requireUuid(s.id,'session id'),user_id:requireUuid(s.userId,'session user id'),token_hash:s.tokenHash,created_at:iso(s.createdAt),expires_at:s.expiresAt})),
    app_invites:(auth.invites||[]).map(i=>({id:requireUuid(i.id,'invite id'),organization_id:requireUuid(i.orgId,'invite organization id'),email:i.email,role:i.role,token_hash:i.tokenHash,created_by:i.createdBy||null,created_at:iso(i.createdAt),expires_at:i.expiresAt,accepted_at:i.acceptedAt||null})),
    password_resets:(auth.passwordResets||[]).map(r=>({id:requireUuid(r.id,'password reset id'),user_id:requireUuid(r.userId,'password reset user id'),token_hash:r.tokenHash,created_at:iso(r.createdAt),expires_at:r.expiresAt,used_at:r.usedAt||null}))
  };
}

export function dbToNormalized(db){
  const projectOrg=new Map((db.projects||[]).map(p=>[p.id,p.orgId||null]));
  return {
    organization_settings:Object.entries(db.orgSettings||{}).map(([id,settings])=>({organization_id:requireUuid(id,'settings organization id'),settings,updated_at:new Date().toISOString()})),
    projects:(db.projects||[]).map(p=>({id:requireUuid(p.id,'project id'),organization_id:requireUuid(p.orgId,'project organization id'),created_by:requireUuid(p.createdBy,'project creator id'),name:p.name,location:p.location||'',state:p.state||null,project_type:p.projectType||null,estimated_value:Number(p.estimatedValue||0),bid_due:p.bidDue||null,description:p.description||'',status:p.status||'draft',workflow_stage:p.workflowStage||'intake',analysis:p.analysis||null,created_at:iso(p.createdAt),updated_at:p.updatedAt||p.createdAt||new Date().toISOString()})),
    contractors:(db.contractors||[]).map(c=>({id:requireUuid(c.id,'contractor id'),organization_id:c.orgId?requireUuid(c.orgId,'contractor organization id'):null,company_name:c.name,email:c.email||null,city:c.city||null,home_state:c.homeState||null,service_states:c.serviceStates||[],license_states:c.licenseStates||[],markets:c.markets||[],trades:c.trades||[],capabilities:c.capabilities||[],min_package:Number(c.minPackage||0),max_package:Number(c.maxPackage||0),insurance_limit:Number(c.insuranceLimit||0),bond_capacity:Number(c.bondCapacity||0),response_rate:Number(c.responseRate||0),avg_response_hours:Number(c.avgResponseHours||0),employees:Number(c.employees||0),years_in_business:Number(c.yearsInBusiness||0),avg_annual_volume:Number(c.avgAnnualVolume||0),current_backlog:Number(c.currentBacklog||0),backlog_utilization:Number(c.backlogUtilization||0),quality_score:Number(c.qualityScore||0),on_time_rate:Number(c.onTimeRate||0),relationship_score:Number(c.relationshipScore||0),prequal_status:c.prequalStatus||null,safety_data:c.safety||{},insurance_expiry:c.insuranceExpiry||null,bonding_status:c.bondingStatus||null,certifications:c.certifications||[],description:c.description||null,past_projects:c.pastProjects||[],qualification_data:{qualified:c.qualified!==false},demo_data:!!c.demoData,last_verified:c.lastVerified||null,created_at:iso(c.createdAt),updated_at:c.updatedAt||c.createdAt||new Date().toISOString()})),
    project_documents:(db.documents||[]).map(d=>({id:requireUuid(d.id,'document id'),project_id:requireUuid(d.projectId,'document project id'),file_name:d.name,mime_type:d.mime||'application/octet-stream',file_size:Number(d.size||0),storage_provider:d.storageProvider||'supabase',storage_path:d.storagePath||d.diskName||'',parsed_text:d.parsedText||null,kind:d.kind||'project-document',bid_id:d.bidId?requireUuid(d.bidId,'document bid id'):null,invitation_id:d.invitationId?requireUuid(d.invitationId,'document invitation id'):null,contractor_id:d.contractorId?requireUuid(d.contractorId,'document contractor id'):null,metadata:d.metadata||{},created_at:iso(d.createdAt)})),
    scopes:(db.scopes||[]).map(s=>({id:requireUuid(s.id,'scope id'),project_id:requireUuid(s.projectId,'scope project id'),trade:s.trade,csi_division:String(s.division||s.csiDivision||''),summary:s.summary||'',requirements:s.requirements||[],keywords:s.keywords||[],confidence:Number(s.confidence||0),estimated_package:Number(s.estimatedPackage||0),manual_estimate:!!s.manualEstimate,qualification:s.qualification||null,source:s.source||'automation',created_at:iso(s.createdAt),updated_at:s.updatedAt||s.createdAt||new Date().toISOString()})),
    contractor_matches:(db.matches||[]).map(m=>({id:requireUuid(m.id,'match id'),project_id:requireUuid(m.projectId,'match project id'),scope_id:requireUuid(m.scopeId,'match scope id'),contractor_id:requireUuid(m.contractorId,'match contractor id'),eligible:m.eligible!==false&&m.qualificationStatus!=='ineligible',qualification_status:m.qualificationStatus||'conditional',score:Number(m.score||0),recommendation:m.recommendation||null,components:m.components||{},reasons:m.reasons||[],risks:m.risks||[],qualification:m.qualification||{},created_at:iso(m.createdAt),updated_at:m.updatedAt||m.createdAt||new Date().toISOString()})),
    invitations:(db.invitations||[]).map(i=>({id:requireUuid(i.id,'invitation id'),project_id:requireUuid(i.projectId,'invitation project id'),scope_id:requireUuid(i.scopeId,'invitation scope id'),contractor_id:requireUuid(i.contractorId,'invitation contractor id'),status:i.status||'queued',message:i.message||null,manual:!!i.manual,sent_externally:!!i.sentExternally,external_message_id:i.externalMessageId||null,public_token_hash:i.publicTokenHash||null,public_token_expires_at:i.publicTokenExpiresAt||null,sent_at:i.sentAt||null,created_at:iso(i.createdAt),updated_at:i.updatedAt||null})),
    bids:(db.bids||[]).map(b=>({id:requireUuid(b.id,'bid id'),project_id:requireUuid(b.projectId,'bid project id'),scope_id:requireUuid(b.scopeId,'bid scope id'),contractor_id:requireUuid(b.contractorId,'bid contractor id'),raw_proposal:b.raw||b.rawProposal||null,parsed:b.parsed||{},manual_adjustment:Number(b.manualAdjustment||0),manual_adjustment_reason:b.manualAdjustmentReason||null,proposal_document_id:b.proposalDocumentId?requireUuid(b.proposalDocumentId,'bid proposal document id'):null,created_at:iso(b.createdAt),updated_at:b.updatedAt||null})),
    project_questions:(db.qa||[]).map(q=>({id:requireUuid(q.id,'question id'),project_id:requireUuid(q.projectId,'question project id'),user_id:q.userId?requireUuid(q.userId,'question user id'):null,question:q.question,answer:q.answer||'',sources:q.sources||[],created_at:iso(q.createdAt)})),
    audit_events:(db.events||[]).map(e=>({id:requireUuid(e.id,'event id'),organization_id:(e.meta?.orgId||projectOrg.get(e.projectId))?requireUuid(e.meta?.orgId||projectOrg.get(e.projectId),'event organization id'):null,project_id:e.projectId?requireUuid(e.projectId,'event project id'):null,actor_user_id:e.meta?.actorUserId?requireUuid(e.meta.actorUserId,'event actor id'):null,event_type:e.type||'activity',message:e.message||'',metadata:e.meta||{},created_at:iso(e.createdAt)})),
    subscriptions:Object.entries(db.billing||{}).map(([id,b])=>({organization_id:requireUuid(id,'subscription organization id'),status:b.status||'not-configured',plan:b.plan||'none',customer_id:b.customerId||null,subscription_id:b.subscriptionId||null,metadata:b,updated_at:b.updatedAt||new Date().toISOString()})),
    background_jobs:(db.jobs||[]).map(j=>({id:requireUuid(j.id,'job id'),organization_id:j.orgId?requireUuid(j.orgId,'job organization id'):null,job_type:j.type||'unknown',status:j.status||'queued',run_at:j.runAt||new Date().toISOString(),payload:j.payload||{},error:j.error||null,attempts:Number(j.attempts||0),created_at:iso(j.createdAt),completed_at:j.completedAt||null}))
  };
}

function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object'){const out={};for(const key of Object.keys(value).sort())out[key]=canonical(value[key]);return out;}return value;}
function stable(value){return JSON.stringify(canonical(value));}
function rowMap(rows,table){const key=pkFor(table);return new Map((rows||[]).map(r=>[String(r[key]),r]));}

async function upsertRows(config,table,rows){
  if(!rows.length)return;
  const key=pkFor(table);
  for(let i=0;i<rows.length;i+=200){
    const batch=rows.slice(i,i+200);
    await rest(config,`${table}?on_conflict=${encodeURIComponent(key)}`,{method:'POST',body:batch,headers:{Prefer:'resolution=merge-duplicates,return=minimal'}});
  }
}
async function deleteRows(config,table,ids){
  const key=pkFor(table);
  for(const id of ids) await rest(config,`${table}?${key}=eq.${encodeURIComponent(id)}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});
}

export async function createNormalizedSupabaseStore(config){
  if(!config?.configured) throw new Error('Supabase is not configured.');
  const tables={};
  for(const table of ALL_TABLES) tables[table]=await fetchAll(config,table);
  const snapshots=Object.fromEntries(ALL_TABLES.map(t=>[t,rowMap(tables[t],t)]));

  async function syncGroup(target,group){
    const names=group==='auth'?AUTH_TABLES:DB_TABLES;
    const changes=[];
    for(const table of names){
      const nextRows=target[table]||[];const prev=snapshots[table]||new Map();const next=rowMap(nextRows,table);const upserts=[];const deletes=[];
      for(const [id,row] of next){const old=prev.get(id);if(!old||stable(old)!==stable(row))upserts.push(row);}
      for(const id of prev.keys())if(!next.has(id))deletes.push(id);
      changes.push({table,upserts,deletes,next});
    }
    // Delete children before parents, then upsert parents before children.
    for(const c of [...changes].reverse())if(c.deletes.length)await deleteRows(config,c.table,c.deletes);
    for(const c of changes)if(c.upserts.length)await upsertRows(config,c.table,c.upserts);
    for(const c of changes)snapshots[c.table]=c.next;
    return {ok:true,changed:changes.reduce((n,c)=>n+c.upserts.length+c.deletes.length,0)};
  }

  return {
    tables,
    runtime:normalizedToRuntime(tables),
    async saveAuth(auth){return syncGroup(authToNormalized(auth),'auth');},
    async saveDb(db){return syncGroup(dbToNormalized(db),'db');},
    async refresh(){const fresh={};for(const table of ALL_TABLES)fresh[table]=await fetchAll(config,table);for(const table of ALL_TABLES)snapshots[table]=rowMap(fresh[table],table);return normalizedToRuntime(fresh);}
  };
}

export const normalizedTables={auth:AUTH_TABLES,db:DB_TABLES,all:ALL_TABLES};
