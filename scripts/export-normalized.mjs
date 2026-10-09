import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const root=process.cwd();
const db=JSON.parse(await readFile(join(root,'data','db.json'),'utf8'));
const authPath=join(root,'data','auth.json');
const auth=existsSync(authPath)?JSON.parse(await readFile(authPath,'utf8')):{organizations:[],users:[],sessions:[],invites:[]};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function uuid(kind,value){
  const raw=String(value||''); if(UUID.test(raw)) return raw;
  const b=Buffer.from(createHash('sha256').update(`bidmatch:v7:${kind}:${raw}`).digest().subarray(0,16));
  b[6]=(b[6]&0x0f)|0x50;b[8]=(b[8]&0x3f)|0x80;
  const h=b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
const orgMap=new Map((auth.organizations||[]).map(o=>[o.id,uuid('org',o.id)]));
const userMap=new Map((auth.users||[]).map(u=>[u.id,uuid('user',u.id)]));
const projectMap=new Map((db.projects||[]).map(p=>[p.id,uuid('project',p.id)]));
const contractorMap=new Map((db.contractors||[]).map(c=>[c.id,uuid('contractor',c.id)]));
const scopeMap=new Map((db.scopes||[]).map(s=>[s.id,uuid('scope',s.id)]));
const oneOrg=(auth.organizations||[]).length===1?orgMap.get(auth.organizations[0].id):null;
const orgId=v=>v?orgMap.get(v)||uuid('org',v):oneOrg;
const projectId=v=>projectMap.get(v)||uuid('project',v);
const contractorId=v=>contractorMap.get(v)||uuid('contractor',v);
const scopeId=v=>scopeMap.get(v)||uuid('scope',v);
const userId=v=>v?(userMap.get(v)||uuid('user',v)):null;
const projectById=new Map((db.projects||[]).map(p=>[p.id,p]));

const out={
  organizations:(auth.organizations||[]).map(o=>({id:orgId(o.id),name:o.name,created_at:o.createdAt||new Date().toISOString()})),
  app_users:(auth.users||[]).map(u=>({id:userId(u.id),organization_id:orgId(u.orgId),email:u.email,display_name:u.name||'',role:u.role,password_hash:u.passwordHash||null,active:u.active!==false,created_at:u.createdAt||new Date().toISOString(),last_login_at:u.lastLoginAt||null})),
  app_sessions:(auth.sessions||[]).map(s=>({id:uuid('session',s.id),user_id:userId(s.userId),token_hash:s.tokenHash,created_at:s.createdAt,expires_at:s.expiresAt})),
  app_invites:(auth.invites||[]).map(i=>({id:uuid('invite',i.id),organization_id:orgId(i.orgId),email:i.email,role:i.role,token_hash:i.tokenHash,created_by:i.createdBy||null,created_at:i.createdAt,expires_at:i.expiresAt,accepted_at:i.acceptedAt||null})),
  password_resets:(auth.passwordResets||[]).map(r=>({id:uuid('reset',r.id),user_id:userId(r.userId),token_hash:r.tokenHash,created_at:r.createdAt,expires_at:r.expiresAt,used_at:r.usedAt||null})),
  organization_settings:Object.entries(db.orgSettings||{}).map(([id,settings])=>({organization_id:orgId(id),settings,updated_at:new Date().toISOString()})),
  projects:(db.projects||[]).filter(p=>orgId(p.orgId)).map(p=>({id:projectId(p.id),organization_id:orgId(p.orgId),created_by:userId(p.createdBy),name:p.name,location:p.location||'',state:p.state||null,project_type:p.projectType||null,estimated_value:Number(p.estimatedValue||0),bid_due:p.bidDue||null,description:p.description||'',status:p.status||'draft',workflow_stage:p.workflowStage||'intake',analysis:p.analysis||null,created_at:p.createdAt||new Date().toISOString(),updated_at:p.updatedAt||p.createdAt||new Date().toISOString()})),
  project_documents:(db.documents||[]).filter(d=>projectMap.has(d.projectId)).map(d=>({id:uuid('document',d.id),project_id:projectId(d.projectId),file_name:d.name,mime_type:d.mime||'application/octet-stream',file_size:Number(d.size||0),storage_provider:d.storageProvider||'local',storage_path:d.storagePath||d.diskName||'',kind:d.kind||'project-document',bid_id:d.bidId?uuid('bid',d.bidId):null,invitation_id:d.invitationId?uuid('invitation',d.invitationId):null,contractor_id:d.contractorId?contractorId(d.contractorId):null,metadata:{legacyDiskName:d.diskName||''},created_at:d.createdAt||new Date().toISOString()})),
  contractors:(db.contractors||[]).map(c=>({id:contractorId(c.id),organization_id:c.orgId?orgId(c.orgId):null,company_name:c.name,email:c.email||null,city:c.city||null,home_state:c.homeState||null,service_states:c.serviceStates||[],license_states:c.licenseStates||[],markets:c.markets||[],trades:c.trades||[],capabilities:c.capabilities||[],min_package:Number(c.minPackage||0),max_package:Number(c.maxPackage||0),insurance_limit:Number(c.insuranceLimit||0),bond_capacity:Number(c.bondCapacity||0),response_rate:Number(c.responseRate||0),avg_response_hours:Number(c.avgResponseHours||0),employees:Number(c.employees||0),years_in_business:Number(c.yearsInBusiness||0),avg_annual_volume:Number(c.avgAnnualVolume||0),current_backlog:Number(c.currentBacklog||0),backlog_utilization:Number(c.backlogUtilization||0),quality_score:Number(c.qualityScore||0),on_time_rate:Number(c.onTimeRate||0),relationship_score:Number(c.relationshipScore||0),prequal_status:c.prequalStatus||null,safety_data:c.safety||{},insurance_expiry:c.insuranceExpiry||null,bonding_status:c.bondingStatus||null,certifications:c.certifications||[],description:c.description||null,past_projects:c.pastProjects||[],qualification_data:{qualified:c.qualified!==false},demo_data:!!c.demoData,last_verified:c.lastVerified||null,created_at:c.createdAt||new Date().toISOString(),updated_at:c.updatedAt||c.createdAt||new Date().toISOString()})),
  scopes:(db.scopes||[]).filter(s=>projectMap.has(s.projectId)).map(s=>({id:scopeId(s.id),project_id:projectId(s.projectId),trade:s.trade,csi_division:String(s.division||s.csiDivision||''),summary:s.summary||'',requirements:s.requirements||[],keywords:s.keywords||[],confidence:Number(s.confidence||0),estimated_package:Number(s.estimatedPackage||0),manual_estimate:!!s.manualEstimate,qualification:s.qualification||null,source:s.source||'automation',created_at:s.createdAt||new Date().toISOString(),updated_at:s.updatedAt||s.createdAt||new Date().toISOString()})),
  contractor_matches:(db.matches||[]).filter(m=>projectMap.has(m.projectId)&&scopeMap.has(m.scopeId)&&contractorMap.has(m.contractorId)).map(m=>({id:uuid('match',m.id||`${m.scopeId}:${m.contractorId}`),project_id:projectId(m.projectId),scope_id:scopeId(m.scopeId),contractor_id:contractorId(m.contractorId),eligible:m.eligible!==false&&m.qualificationStatus!=='ineligible',qualification_status:m.qualificationStatus||'conditional',score:Number(m.score||0),recommendation:m.recommendation||null,components:m.components||{},reasons:m.reasons||[],risks:m.risks||[],qualification:m.qualification||{},created_at:m.createdAt||new Date().toISOString(),updated_at:m.updatedAt||m.createdAt||new Date().toISOString()})),
  invitations:(db.invitations||[]).filter(i=>projectMap.has(i.projectId)&&scopeMap.has(i.scopeId)&&contractorMap.has(i.contractorId)).map(i=>({id:uuid('invitation',i.id),project_id:projectId(i.projectId),scope_id:scopeId(i.scopeId),contractor_id:contractorId(i.contractorId),status:i.status||'queued',message:i.message||null,manual:!!i.manual,sent_externally:!!i.sentExternally,external_message_id:i.externalMessageId||null,public_token_hash:i.publicTokenHash||null,public_token_expires_at:i.publicTokenExpiresAt||null,sent_at:i.sentAt||null,created_at:i.createdAt||new Date().toISOString(),updated_at:i.updatedAt||null})),
  bids:(db.bids||[]).filter(b=>projectMap.has(b.projectId)&&scopeMap.has(b.scopeId)&&contractorMap.has(b.contractorId)).map(b=>({id:uuid('bid',b.id),project_id:projectId(b.projectId),scope_id:scopeId(b.scopeId),contractor_id:contractorId(b.contractorId),raw_proposal:b.raw||b.rawProposal||null,parsed:b.parsed||{},manual_adjustment:Number(b.manualAdjustment||0),manual_adjustment_reason:b.manualAdjustmentReason||null,proposal_document_id:b.proposalDocumentId?uuid('document',b.proposalDocumentId):null,created_at:b.createdAt||new Date().toISOString(),updated_at:b.updatedAt||null})),
  project_questions:(db.qa||[]).filter(q=>projectMap.has(q.projectId)).map(q=>({id:uuid('qa',q.id),project_id:projectId(q.projectId),user_id:userId(q.userId),question:q.question,answer:q.answer||'',sources:q.sources||[],created_at:q.createdAt||new Date().toISOString()})),
  audit_events:(db.events||[]).map(e=>{const p=e.projectId?projectById.get(e.projectId):null;const oid=e.meta?.orgId||p?.orgId||null;return {id:uuid('event',e.id),organization_id:oid?orgId(oid):null,project_id:e.projectId&&projectMap.has(e.projectId)?projectId(e.projectId):null,actor_user_id:userId(e.meta?.actorUserId),event_type:e.type||'activity',message:e.message||'',metadata:e.meta||{},created_at:e.createdAt||new Date().toISOString()};}),
  subscriptions:Object.entries(db.billing||{}).map(([id,b])=>({organization_id:orgId(id),status:b.status||'not-configured',plan:b.plan||'none',customer_id:b.customerId||null,subscription_id:b.subscriptionId||null,metadata:b,updated_at:b.updatedAt||new Date().toISOString()})),
  background_jobs:(db.jobs||[]).map(j=>({id:uuid('job',j.id),organization_id:j.orgId?orgId(j.orgId):null,job_type:j.type||'unknown',status:j.status||'queued',run_at:j.runAt||new Date().toISOString(),payload:j.payload||{},error:j.error||null,attempts:Number(j.attempts||0),created_at:j.createdAt||new Date().toISOString(),completed_at:j.completedAt||null}))
};

const output=join(root,'data','normalized-export.json');
await writeFile(output,JSON.stringify(out,null,2));
console.log(`Normalized export written to ${output}`);
for(const [table,rows] of Object.entries(out)) console.log(`${table}: ${rows.length}`);
