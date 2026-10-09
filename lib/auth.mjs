import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

const SESSION_DAYS = 14;
const INVITE_DAYS = 7;
const RESET_MINUTES = 60;

function normalizeEmail(v=''){ return String(v).trim().toLowerCase(); }
function safeUser(u){ return u ? {id:u.id,orgId:u.orgId,name:u.name,email:u.email,role:u.role,createdAt:u.createdAt,lastLoginAt:u.lastLoginAt||null} : null; }
function hashToken(token){ return createHash('sha256').update(token).digest('hex'); }
function passwordHash(password, salt=randomBytes(16).toString('hex')){
  const hash=scryptSync(String(password),salt,64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored=''){
  const [salt,hex]=String(stored).split(':'); if(!salt||!hex) return false;
  const actual=scryptSync(String(password),salt,64); const expected=Buffer.from(hex,'hex');
  return actual.length===expected.length && timingSafeEqual(actual,expected);
}
function parseCookies(req){
  const out={}; for(const part of String(req.headers.cookie||'').split(';')){const i=part.indexOf('=');if(i>0)out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim());} return out;
}
function validatePassword(password){
  const p=String(password||''); if(p.length<10) return 'Password must be at least 10 characters.';
  if(!/[A-Za-z]/.test(p)||!/[0-9]/.test(p)) return 'Password must contain at least one letter and one number.';
  return '';
}

export async function createAuthStore(file, {secureCookies=false, loginRequired=true, initialData=null, onSave=null, strictExternalSave=false}={}){
  await mkdir(dirname(file),{recursive:true});
  let data={version:2,organizations:[],users:[],sessions:[],invites:[],passwordResets:[]};
  if(initialData && typeof initialData==='object') data={...data,...initialData};
  else if(existsSync(file)){
    try{data={...data,...JSON.parse(await readFile(file,'utf8'))};}catch{}
  }
  data.passwordResets=data.passwordResets||[];
  for(const user of data.users) delete user.platformAdmin;
  const save=async()=>{await writeFile(file,JSON.stringify(data,null,2));if(onSave){if(strictExternalSave)await onSave(data);else{try{await onSave(data);}catch(error){console.error('Cloud auth persistence:',error.message);}}}};
  if(initialData && typeof initialData==='object') await writeFile(file,JSON.stringify(data,null,2));
  const cleanup=()=>{const now=Date.now();data.sessions=data.sessions.filter(s=>new Date(s.expiresAt).getTime()>now);data.invites=data.invites.filter(i=>i.acceptedAt||new Date(i.expiresAt).getTime()>now);data.passwordResets=data.passwordResets.filter(r=>r.usedAt||new Date(r.expiresAt).getTime()>now);};
  const setSessionCookie=(res,token)=>{const max=SESSION_DAYS*86400;res.setHeader('Set-Cookie',`bm_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${max}${secureCookies?'; Secure':''}`);};
  const clearSessionCookie=res=>res.setHeader('Set-Cookie',`bm_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookies?'; Secure':''}`);
  const context=async req=>{
    cleanup();
    if(!loginRequired) return {authenticated:true,user:{id:'local-owner',orgId:'local-demo-org',name:'Local Owner',email:'local@bidmatch.test',role:'owner'},org:{id:'local-demo-org',name:'Local Workspace'},loginRequired:false};
    const token=parseCookies(req).bm_session; if(!token) return {authenticated:false,loginRequired:true};
    const session=data.sessions.find(s=>s.tokenHash===hashToken(token)); if(!session) return {authenticated:false,loginRequired:true};
    const user=data.users.find(u=>u.id===session.userId&&u.active!==false); if(!user) return {authenticated:false,loginRequired:true};
    const org=data.organizations.find(o=>o.id===user.orgId); if(!org) return {authenticated:false,loginRequired:true};
    return {authenticated:true,user:safeUser(user),org,loginRequired:true};
  };
  const status=async req=>{const ctx=await context(req);return {...ctx,requiresBootstrap:loginRequired&&data.users.length===0};};
  const createWorkspaceOwner=async({orgName,name,email,password},res)=>{
    const pwErr=validatePassword(password); if(pwErr) throw new Error(pwErr);
    const e=normalizeEmail(email); if(!e.includes('@')) throw new Error('Enter a valid email address.');
    if(data.users.some(u=>u.email===e)) throw new Error('An account already exists for this email.');
    const org={id:randomUUID(),name:String(orgName||'BidMatch Workspace').trim().slice(0,120),createdAt:new Date().toISOString()};
    const user={id:randomUUID(),orgId:org.id,name:String(name||'Owner').trim().slice(0,100),email:e,role:'owner',passwordHash:passwordHash(password),active:true,createdAt:new Date().toISOString(),lastLoginAt:new Date().toISOString()};
    data.organizations.push(org);data.users.push(user); const token=randomBytes(32).toString('hex');data.sessions.push({id:randomUUID(),userId:user.id,tokenHash:hashToken(token),createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+SESSION_DAYS*86400000).toISOString()});await save();setSessionCookie(res,token);return {user:safeUser(user),org};
  };
  const bootstrap=async({orgName,name,email,password},res)=>{
    if(!loginRequired) throw new Error('Authentication is disabled in local mode.');
    if(data.users.length) throw new Error('Workspace owner has already been created.');
    return createWorkspaceOwner({orgName,name,email,password},res);
  };
  const registerWorkspace=async({orgName,name,email,password},res)=>{
    if(!loginRequired) throw new Error('Authentication is disabled in local mode.');
    return createWorkspaceOwner({orgName,name,email,password},res);
  };
  const login=async({email,password},res)=>{
    cleanup();const e=normalizeEmail(email);const user=data.users.find(u=>u.email===e&&u.active!==false);if(!user||!verifyPassword(password,user.passwordHash))throw new Error('Invalid email or password.');
    user.lastLoginAt=new Date().toISOString();const token=randomBytes(32).toString('hex');data.sessions.push({id:randomUUID(),userId:user.id,tokenHash:hashToken(token),createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+SESSION_DAYS*86400000).toISOString()});await save();setSessionCookie(res,token);return {user:safeUser(user),org:data.organizations.find(o=>o.id===user.orgId)};
  };
  const logout=async(req,res)=>{const token=parseCookies(req).bm_session;if(token)data.sessions=data.sessions.filter(s=>s.tokenHash!==hashToken(token));await save();clearSessionCookie(res);};
  const createPasswordReset=async(email)=>{
    cleanup();const e=normalizeEmail(email);const user=data.users.find(u=>u.email===e&&u.active!==false);if(!user)return null;
    data.passwordResets=data.passwordResets.filter(r=>r.userId!==user.id||r.usedAt);
    const raw=randomBytes(32).toString('hex');const row={id:randomUUID(),userId:user.id,tokenHash:hashToken(raw),createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+RESET_MINUTES*60000).toISOString(),usedAt:null};
    data.passwordResets.push(row);await save();return {token:raw,email:user.email,name:user.name,expiresAt:row.expiresAt};
  };
  const resetPassword=async({token,password})=>{
    cleanup();const tokenHash=hashToken(String(token||''));const row=data.passwordResets.find(r=>r.tokenHash===tokenHash&&!r.usedAt&&new Date(r.expiresAt).getTime()>Date.now());if(!row)throw new Error('Password reset link is invalid or expired.');
    const pwErr=validatePassword(password);if(pwErr)throw new Error(pwErr);const user=data.users.find(u=>u.id===row.userId&&u.active!==false);if(!user)throw new Error('Account is no longer available.');
    user.passwordHash=passwordHash(password);row.usedAt=new Date().toISOString();data.sessions=data.sessions.filter(s=>s.userId!==user.id);await save();return {ok:true,email:user.email};
  };
  const listTeam=orgId=>data.users.filter(u=>u.orgId===orgId).map(safeUser);
  const createInvite=async({orgId,email,role='estimator',createdBy})=>{
    const e=normalizeEmail(email);if(!e.includes('@'))throw new Error('Enter a valid email address.');if(data.users.some(u=>u.orgId===orgId&&u.email===e))throw new Error('That email is already on the team.');
    const allowed=['admin','estimator','viewer'];if(!allowed.includes(role))throw new Error('Invalid role.');const raw=randomBytes(24).toString('hex');const invite={id:randomUUID(),orgId,email:e,role,tokenHash:hashToken(raw),createdBy,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+INVITE_DAYS*86400000).toISOString(),acceptedAt:null};data.invites.push(invite);await save();return {...invite,token:raw};
  };

  const createOrganizationInvite=async({orgName,email,createdBy='platform-admin'})=>{
    const e=normalizeEmail(email);if(!e.includes('@'))throw new Error('Enter a valid owner email address.');
    if(data.users.some(u=>u.email===e))throw new Error('An account already exists for this email.');
    if(data.invites.some(i=>i.email===e&&!i.acceptedAt&&new Date(i.expiresAt).getTime()>Date.now()))throw new Error('An active invitation already exists for this email.');
    const name=String(orgName||'').trim().slice(0,120);if(!name)throw new Error('Organization name is required.');
    const org={id:randomUUID(),name,createdAt:new Date().toISOString()};
    data.organizations.push(org);
    const raw=randomBytes(24).toString('hex');
    const invite={id:randomUUID(),orgId:org.id,email:e,role:'owner',tokenHash:hashToken(raw),createdBy,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+INVITE_DAYS*86400000).toISOString(),acceptedAt:null};
    data.invites.push(invite);await save();return {org,invite:{...invite,token:raw}};
  };

  const inspectInvite=token=>{cleanup();const i=data.invites.find(x=>x.tokenHash===hashToken(token)&&!x.acceptedAt);if(!i)return null;return {id:i.id,email:i.email,role:i.role,org:data.organizations.find(o=>o.id===i.orgId),expiresAt:i.expiresAt};};
  const acceptInvite=async({token,name,password},res)=>{
    cleanup();const invite=data.invites.find(x=>x.tokenHash===hashToken(token)&&!x.acceptedAt);if(!invite)throw new Error('Invite is invalid or expired.');const pwErr=validatePassword(password);if(pwErr)throw new Error(pwErr);if(data.users.some(u=>u.email===invite.email))throw new Error('An account already exists for this email.');
    const user={id:randomUUID(),orgId:invite.orgId,name:String(name||invite.email.split('@')[0]).trim().slice(0,100),email:invite.email,role:invite.role,passwordHash:passwordHash(password),active:true,createdAt:new Date().toISOString(),lastLoginAt:new Date().toISOString()};data.users.push(user);invite.acceptedAt=new Date().toISOString();const raw=randomBytes(32).toString('hex');data.sessions.push({id:randomUUID(),userId:user.id,tokenHash:hashToken(raw),createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+SESSION_DAYS*86400000).toISOString()});await save();setSessionCookie(res,raw);return {user:safeUser(user),org:data.organizations.find(o=>o.id===user.orgId)};
  };
  const updateRole=async({orgId,userId,role,actorId})=>{const actor=data.users.find(u=>u.id===actorId&&u.orgId===orgId);if(!actor||!['owner','admin'].includes(actor.role))throw new Error('Admin permission required.');const user=data.users.find(u=>u.id===userId&&u.orgId===orgId);if(!user)throw new Error('Team member not found.');if(user.role==='owner'&&role!=='owner')throw new Error('The workspace owner role cannot be changed here.');if(!['admin','estimator','viewer'].includes(role))throw new Error('Invalid role.');user.role=role;await save();return safeUser(user);};
  return {status,context,bootstrap,registerWorkspace,login,logout,createPasswordReset,resetPassword,listTeam,createInvite,createOrganizationInvite,inspectInvite,acceptInvite,updateRole,save,raw:()=>data};
}

export function roleAtLeast(user,minimum='viewer'){
  const rank={viewer:1,estimator:2,admin:3,owner:4};return (rank[user?.role]||0)>=(rank[minimum]||99);
}
