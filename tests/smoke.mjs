import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomBytes, scryptSync } from 'node:crypto';

const here=dirname(fileURLToPath(import.meta.url));
const source=join(here,'..');
const work=await mkdtemp(join(tmpdir(),'bidmatch-v7-'));
await cp(source,work,{recursive:true,filter:(src)=>!src.includes('/backups/')&&!src.endsWith('/.env')&&!src.endsWith('/data/auth.json')});

const dbPath=join(work,'data','db.json');
const db=JSON.parse(await readFile(dbPath,'utf8'));
Object.assign(db,{version:5,projects:[],documents:[],scopes:[],matches:[],invitations:[],bids:[],qa:[],events:[],jobs:[],orgSettings:{},billing:{}});
db.contractors=(db.contractors||[]).filter(c=>!c.orgId).map(c=>({...c,orgId:null}));
await writeFile(dbPath,JSON.stringify(db,null,2));

const port=34719;
const adminPassword='AdminSmoke1234!';
const adminSalt=randomBytes(16).toString('hex');
const adminHash=`${adminSalt}:${scryptSync(adminPassword,adminSalt,64).toString('hex')}`;
const child=spawn(process.execPath,['server.mjs'],{cwd:work,env:{...process.env,PORT:String(port),APP_ENV:'development',REQUIRE_LOGIN:'true',ALLOW_SELF_SIGNUP:'true',OPENAI_API_KEY:'',DATA_BACKEND:'local',SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',SUPABASE_SERVICE_ROLE_KEY:'',RESEND_API_KEY:'',STRIPE_SECRET_KEY:'',PLATFORM_ADMIN_EMAIL:'platform@smoke.test',PLATFORM_ADMIN_PASSWORD_HASH:adminHash,PLATFORM_ADMIN_SESSION_SECRET:'smoke-admin-session-secret-123456789'},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
const base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const cookies=new Map();
function cookieHeader(){return [...cookies.entries()].map(([k,v])=>`${k}=${v}`).join('; ');}
function applySetCookie(value){
  if(!value)return;
  for(const raw of value.split(/,(?=[^;,]+=)/)){
    const pair=raw.split(';')[0], i=pair.indexOf('=');
    if(i<1)continue;
    const key=pair.slice(0,i).trim(), val=pair.slice(i+1).trim();
    if(val)cookies.set(key,val); else cookies.delete(key);
  }
}
async function req(path,{method='GET',body,headers={}}={}){
  const ch=cookieHeader();
  const res=await fetch(base+path,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(ch?{Cookie:ch}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  applySetCookie(res.headers.get('set-cookie'));
  const type=res.headers.get('content-type')||'';const payload=type.includes('application/json')?await res.json():await res.text();
  if(!res.ok)throw new Error(`${method} ${path} -> ${res.status}: ${typeof payload==='string'?payload:JSON.stringify(payload)}`);
  return payload;
}
function assert(v,msg){if(!v)throw new Error(`Assertion failed: ${msg}`);}

try{
  for(let i=0;i<50;i++){try{const h=await req('/api/health');if(h.ok)break;}catch{}await sleep(100);if(i===49)throw new Error('Server did not start.');}
  const adminPage=await req('/admin');assert(String(adminPage).includes('SEPARATE ADMIN CONSOLE'),'separate admin page should be served');
  const status=await req('/api/auth/status');assert(status.requiresBootstrap,'fresh instance should require owner bootstrap');
  await req('/api/auth/bootstrap',{method:'POST',body:{orgName:'Smoke Test GC',name:'Owner Test',email:'owner@smoke.test',password:'SmokeTest1234'}});
  let state=await req('/api/state');assert(state.auth?.user?.role==='owner','bootstrap should create owner');assert(!('platformAdmin' in state.auth.user),'client owner must not receive platform-admin status');assert(state.counts.contractors>=50,'demo contractor directory should load');
  let adminBlockedInitially=false;try{await req('/api/admin/summary');}catch(error){adminBlockedInitially=String(error.message).includes('401');}assert(adminBlockedInitially,'client owner session must not access separate platform admin API');
  const adminLogin=await req('/api/admin/auth/login',{method:'POST',body:{email:'platform@smoke.test',password:adminPassword}});assert(adminLogin.ok,'separate admin login should succeed');
  const adminInitial=await req('/api/admin/summary');assert(adminInitial.metrics.organizations===1,'separate platform admin should see first workspace');
  const onboarded=await req('/api/admin/organizations',{method:'POST',body:{orgName:'Pilot GC',ownerEmail:'pilot-owner@smoke.test'}});assert(onboarded.org?.name==='Pilot GC','platform admin should create a client workspace');assert(String(onboarded.inviteUrl||'').includes('invite='),'platform admin onboarding should return an owner invite URL');
  const adminAfterOnboard=await req('/api/admin/summary');assert(adminAfterOnboard.metrics.organizations===2,'admin-created pilot workspace should appear in metrics');

  const sampleDoc=Buffer.from('Project note: roofing, electrical, plumbing and HVAC are included.').toString('base64');
  const created=await req('/api/projects',{method:'POST',body:{name:'Parkview Smoke',location:'Kansas City, MO',projectType:'Multifamily',estimatedValue:18000000,bidDue:'2027-12-12',description:'120-unit 6-story multifamily project with concrete structural steel roofing drywall flooring plumbing HVAC fire protection electrical low voltage paving landscaping and site utilities.',files:[{name:'scope-note.txt',mime:'text/plain',data:sampleDoc}]}});
  const projectId=created.project.id;assert(projectId,'project should be created');assert(created.documents.length===1,'project document should be stored');
  const downloaded=await req(`/api/projects/${projectId}/documents/${created.documents[0].id}/download`);assert(String(downloaded).includes('Project note'),'authenticated project document download should work');

  let bundle=await req(`/api/projects/${projectId}/automation`,{method:'POST',body:{}});
  assert(bundle.scopes.length>=6,'automation should produce scopes');assert(bundle.matches.length>0,'automation should score matches');assert(bundle.invitations.length>0,'automation should build bid list');

  const portalInvitation=bundle.invitations[0];
  const portalLink=await req(`/api/projects/${projectId}/invitations/${portalInvitation.id}/link`,{method:'POST',body:{}});assert(String(portalLink.url||'').includes('/bid/'),'estimator should be able to create a secure subcontractor portal link');
  const portalToken=new URL(portalLink.url).pathname.split('/').filter(Boolean)[1];assert(portalToken,'portal URL should contain a high-entropy token');
  let portal=await req(`/api/public/invitations/${portalToken}`);assert(portal.scope?.trade,'public invitation should expose the invited scope');assert(portal.documents?.length===1,'public invitation should expose project documents but not private workspace data');
  const portalDoc=await req(`/api/public/invitations/${portalToken}/documents/${portal.documents[0].id}`);assert(String(portalDoc).includes('Project note'),'subcontractor portal should download invited project documents');
  portal=await req(`/api/public/invitations/${portalToken}/status`,{method:'POST',body:{status:'accepted'}});assert(portal.invitation.status==='accepted','subcontractor should be able to accept invitation');
  const proposalFile=Buffer.from('Smoke proposal attachment').toString('base64');
  const portalSubmit=await req(`/api/public/invitations/${portalToken}/submit`,{method:'POST',body:{amount:1234567,schedule:'Per project schedule',bondIncluded:'yes',taxIncluded:'yes',inclusions:['Base scope'],exclusions:['Temporary power'],alternates:[],proposalText:'Smoke subcontractor portal proposal',file:{name:'smoke-proposal.txt',mime:'text/plain',data:proposalFile}}});assert(portalSubmit.status==='submitted','subcontractor portal should submit a bid');
  bundle=await req(`/api/projects/${projectId}`);assert(bundle.bids.some(b=>b.contractorId===portalInvitation.contractorId),'portal bid should appear in GC workspace');assert(bundle.documents.some(d=>d.kind==='bid-proposal'),'portal proposal attachment should be stored privately as a bid proposal');

  const concrete=bundle.scopes.find(s=>s.trade==='Concrete')||bundle.scopes[0];
  bundle=await req(`/api/projects/${projectId}/scopes/${concrete.id}`,{method:'PATCH',body:{estimatedPackage:7000000,manualEstimate:true}});
  const concreteMatches=bundle.matches.filter(m=>m.scopeId===concrete.id);assert(concreteMatches.some(m=>m.qualificationStatus==='ineligible'||m.qualificationStatus==='conditional'),'large scope should trigger qualification pressure');

  bundle=await req(`/api/projects/${projectId}/bids/demo`,{method:'POST',body:{}});assert(bundle.bids.length>0,'demo bids should be generated');
  const csv=await req(`/api/projects/${projectId}/export`);assert(csv.includes('Leveled')||csv.includes('leveled')||csv.includes('Base Bid'),'CSV export should contain bid-leveling columns');

  const imported=await req('/api/contractors/import',{method:'POST',body:{csv:'name,email,trades,serviceStates,markets,minPackage,maxPackage,insuranceLimit,bondCapacity,licenseStates,city,employees,prequalStatus\nSmoke Electric,estimating@smokeelectric.test,Electrical,MO,Multifamily,100000,2500000,5000000,2500000,MO,Kansas City,25,Approved\n'}});assert(imported.created===1,'CSV import should add one contractor');

  const invite=await req('/api/team/invite',{method:'POST',body:{email:'estimator@smoke.test',role:'estimator'}});assert(invite.inviteUrl||invite.token,'team invite should be generated');
  const backup=await req('/api/backup',{method:'POST',body:{}});assert(backup.ok,'backup should complete');

  state=await req('/api/state');assert(state.counts.projects===1,'organization state should contain one project');assert(state.counts.bids>0,'organization state should contain bids');
  const resetRequest=await req('/api/auth/forgot-password',{method:'POST',body:{email:'owner@smoke.test'}});assert(resetRequest.resetUrl,'development password-reset flow should expose a test reset URL');
  const resetToken=new URL(resetRequest.resetUrl).searchParams.get('reset');assert(resetToken,'reset URL should contain a reset token');
  await req('/api/auth/reset-password',{method:'POST',body:{token:resetToken,password:'SmokeTest5678'}});
  let oldSessionInvalid=false;try{await req('/api/state');}catch(error){oldSessionInvalid=String(error.message).includes('401');}assert(oldSessionInvalid,'password reset should invalidate existing sessions');
  cookies.clear();await req('/api/auth/login',{method:'POST',body:{email:'owner@smoke.test',password:'SmokeTest5678'}});

  const inviteToken=new URL(invite.inviteUrl).searchParams.get('invite');assert(inviteToken,'team invite URL should contain a token');
  await req('/api/auth/logout',{method:'POST',body:{}});cookies.clear();
  await req('/api/auth/accept-invite',{method:'POST',body:{token:inviteToken,name:'Estimator Test',password:'Estimator1234'}});
  const estimatorState=await req('/api/state');assert(estimatorState.auth.user.role==='estimator','accepted estimator invite should create estimator account');
  let blocked=false;try{await req('/api/backup',{method:'POST',body:{}});}catch(error){blocked=String(error.message).includes('403');}assert(blocked,'estimator must not have admin backup permission');
  await req('/api/auth/logout',{method:'POST',body:{}});cookies.clear();
  await req('/api/auth/login',{method:'POST',body:{email:'owner@smoke.test',password:'SmokeTest5678'}});
  state=await req('/api/state');assert(state.counts.projects===1,'owner should regain original organization data after login');

  await req('/api/auth/logout',{method:'POST',body:{}});cookies.clear();
  await req('/api/auth/register-workspace',{method:'POST',body:{orgName:'Second GC',name:'Second Owner',email:'second@smoke.test',password:'SecondTest1234'}});
  const second=await req('/api/state');assert(second.counts.projects===0,'second organization must not see first organization projects');assert(!second.contractors.some(c=>c.name==='Smoke Electric'),'second organization must not see first organization imported contractor');
  let isolated=false;try{await req(`/api/projects/${projectId}`);}catch(error){isolated=String(error.message).includes('404');}assert(isolated,'second organization must not fetch first organization project by ID');
  let adminBlocked=false;try{await req('/api/admin/summary');}catch(error){adminBlocked=String(error.message).includes('401');}assert(adminBlocked,'client workspace owner must not access separate platform admin without admin login');
  await req('/api/auth/logout',{method:'POST',body:{}});cookies.clear();
  await req('/api/auth/login',{method:'POST',body:{email:'owner@smoke.test',password:'SmokeTest5678'}});
  let clientStillBlocked=false;try{await req('/api/admin/summary');}catch(error){clientStillBlocked=String(error.message).includes('401');}assert(clientStillBlocked,'client login must remain separate from admin login');
  await req('/api/admin/auth/login',{method:'POST',body:{email:'platform@smoke.test',password:adminPassword}});
  const adminFinal=await req('/api/admin/summary');assert(adminFinal.metrics.organizations===3,'separate platform admin should see all three workspaces');

  console.log(`PASS BidMatch AI V8.0.0 smoke test: ${bundle.scopes.length} scopes, ${bundle.matches.length} matches, ${bundle.invitations.length} invitations, ${bundle.bids.length} bids; admin/client isolation, password reset, secure subcontractor portal, role permissions, and tenant isolation verified.`);
} finally {
  child.kill('SIGTERM');
  await sleep(100);
  await rm(work,{recursive:true,force:true});
}
