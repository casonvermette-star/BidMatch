const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let adminState = null;

const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmtDate = value => value ? new Date(value).toLocaleString() : '—';
const fmtNum = value => Number(value || 0).toLocaleString();

async function adminApi(path, options={}){
  const response = await fetch(path,{headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
  const text = await response.text();
  let data={}; try{data=text?JSON.parse(text):{};}catch{data={error:text||response.statusText};}
  if(!response.ok) throw Object.assign(new Error(data.error||'Request failed.'),{status:response.status});
  return data;
}

function showLogin(message=''){
  $('#adminLoginGate').classList.remove('hidden');
  $('#adminShell').classList.add('hidden');
  $('#adminLoginError').textContent=message;
  $('#adminLoginError').classList.toggle('hidden',!message);
}
function showShell(email){
  $('#adminLoginGate').classList.add('hidden');
  $('#adminShell').classList.remove('hidden');
  $('#adminAccountEmail').textContent=email||'Platform owner';
}

async function bootstrap(){
  try{
    const status=await adminApi('/api/admin/auth/status');
    if(!status.configured) return showLogin('Platform admin credentials are not configured on this deployment.');
    if(!status.authenticated) return showLogin();
    showShell(status.email);
    await refresh();
  }catch(error){showLogin(error.message);}
}

async function login(event){
  event.preventDefault();
  $('#adminLoginError').classList.add('hidden');
  try{
    const result=await adminApi('/api/admin/auth/login',{method:'POST',body:JSON.stringify({email:$('#adminEmail').value,password:$('#adminPassword').value})});
    showShell(result.admin?.email||$('#adminEmail').value);
    $('#adminPassword').value='';
    await refresh();
  }catch(error){showLogin(error.message);}
}

async function logout(){
  await adminApi('/api/admin/auth/logout',{method:'POST',body:'{}'}).catch(()=>{});
  showLogin();
}

function organizationsTable(orgs=[]){
  if(!orgs.length)return '<div class="empty">No client workspaces yet.</div>';
  return `<div class="admin-table"><table><thead><tr><th>Workspace</th><th>Users</th><th>Projects</th><th>Documents</th><th>Bids</th><th>Invitations</th><th>Imported firms</th><th>Subscription</th><th>Last activity</th></tr></thead><tbody>${orgs.map(org=>`<tr><td><div class="tenant-name"><strong>${esc(org.name)}</strong><small>${esc(org.id.slice(0,8))}</small></div></td><td class="admin-stat">${fmtNum(org.users)}</td><td class="admin-stat">${fmtNum(org.projects)}</td><td class="admin-stat">${fmtNum(org.documents)}</td><td class="admin-stat">${fmtNum(org.bids)}</td><td class="admin-stat">${fmtNum(org.invitations)}</td><td class="admin-stat">${fmtNum(org.customContractors)}</td><td><span class="chip ${['active','trialing','checkout-complete'].includes(org.billing?.status)?'good':'warn'}">${esc(String(org.billing?.status||'not configured'))}</span></td><td>${org.lastActivity?fmtDate(org.lastActivity):'—'}</td></tr>`).join('')}</tbody></table></div>`;
}
function usersTable(users=[]){
  if(!users.length)return '<div class="empty">No client users yet.</div>';
  return `<div class="admin-table"><table><thead><tr><th>User</th><th>Workspace</th><th>Role</th><th>Status</th><th>Created</th><th>Last login</th></tr></thead><tbody>${users.map(u=>`<tr><td><strong>${esc(u.name||u.email)}</strong><br><span class="muted">${esc(u.email)}</span></td><td>${esc(u.organization)}</td><td><span class="chip">${esc(u.role)}</span></td><td><span class="chip ${u.active?'good':'warn'}">${u.active?'Active':'Disabled'}</span></td><td>${fmtDate(u.createdAt)}</td><td>${u.lastLoginAt?fmtDate(u.lastLoginAt):'Never'}</td></tr>`).join('')}</tbody></table></div>`;
}
function activityList(events=[]){
  if(!events.length)return '<div class="empty">No platform activity yet.</div>';
  return `<div class="admin-activity">${events.map(event=>`<div class="admin-event"><strong>${esc(event.organization)} · ${esc(event.projectName)}</strong><span>${esc(event.message||event.type||'Activity')}</span><time>${event.createdAt?fmtDate(event.createdAt):'—'}</time></div>`).join('')}</div>`;
}

function render(data){
  const m=data.metrics||{};
  $('#adminMetricGrid').innerHTML=[['Client organizations',m.organizations],['Client users',m.users],['Projects',m.projects],['Documents',m.documents],['Invitations',m.invitations],['Bids',m.bids]].map(([label,value])=>`<div class="metric"><span>${esc(label)}</span><strong>${fmtNum(value)}</strong></div>`).join('');
  $('#adminOrganizations').innerHTML=organizationsTable((data.organizations||[]).slice(0,8));
  $('#adminOrganizationsFull').innerHTML=organizationsTable(data.organizations||[]);
  $('#adminUsers').innerHTML=usersTable((data.users||[]).slice(0,10));
  $('#adminUsersFull').innerHTML=usersTable(data.users||[]);
  $('#adminActivity').innerHTML=activityList((data.recentActivity||[]).slice(0,10));
  $('#adminActivityFull').innerHTML=activityList(data.recentActivity||[]);
  const s=data.system||{};
  $('#adminSystem').innerHTML=`<div class="health-list"><div class="health-row"><span>AI document layer</span><b class="${s.ai==='live'?'':'warn'}">${esc(String(s.ai||'disabled').toUpperCase())}</b></div><div class="health-row"><span>Database / storage</span><b class="${String(s.supabase).includes('live')?'':'warn'}">${esc(String(s.supabase||'local').toUpperCase())}</b></div><div class="health-row"><span>Email delivery</span><b class="${s.email==='live'?'':'warn'}">${esc(String(s.email||'disabled').toUpperCase())}</b></div><div class="health-row"><span>Subscription billing</span><b class="${s.billing==='live'?'':'warn'}">${esc(String(s.billing||'disabled').toUpperCase())}</b></div><div class="health-row"><span>Shared directory firms</span><b>${fmtNum(s.directoryContractors)}</b></div><div class="health-row"><span>Queued background jobs</span><b>${fmtNum(s.queuedJobs)}</b></div><div class="health-row"><span>Release</span><b>V${esc(s.version||'6.1')}</b></div></div>`;
}

async function refresh(){
  try{adminState=await adminApi('/api/admin/summary');render(adminState);}catch(error){if(error.status===401)showLogin('Admin session expired. Sign in again.');else alert(error.message);}
}

function switchView(name){
  const titles={overview:'Admin Command Center',organizations:'Client Organizations',users:'Client Users',activity:'Audit Activity'};
  $$('.view').forEach(v=>v.classList.remove('active'));
  $(`#admin${name[0].toUpperCase()+name.slice(1)}View`)?.classList.add('active');
  $$('[data-admin-view]').forEach(b=>b.classList.toggle('active',b.dataset.adminView===name));
  $('#adminViewTitle').textContent=titles[name]||'Admin Command Center';
}

$('#adminLoginForm').addEventListener('submit',login);
$('#adminLogoutBtn').addEventListener('click',logout);
$('#adminRefreshBtn').addEventListener('click',refresh);
$$('[data-admin-view]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.adminView)));
bootstrap();
