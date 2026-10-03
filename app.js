let state = null;
let currentProject = null;
let currentBundle = null;
let currentTab = 'overview';
let newProjectFiles = [];
let addDocumentFiles = [];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]));
const fmtMoney = value => Number(value || 0).toLocaleString('en-US', { style:'currency', currency:'USD', maximumFractionDigits:0 });
const fmtPct = value => `${Math.round(Number(value || 0) * 100)}%`;
const fmtSignedPct = value => `${Number(value || 0) >= 0 ? '+' : ''}${Math.round(Number(value || 0) * 100)}%`;
const fmtDate = value => value ? new Date(value.includes('T') ? value : `${value}T12:00:00`).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' }) : 'Not set';
const fmtBytes = value => value < 1024 ? `${value} B` : value < 1048576 ? `${(value/1024).toFixed(1)} KB` : `${(value/1048576).toFixed(1)} MB`;

async function api(path, options = {}) {
  const response = await fetch(path, { headers:{ 'Content-Type':'application/json', ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && data.error === 'AUTH_REQUIRED' && !path.startsWith('/api/auth/')) { try { showAuthPanel('#authLogin'); } catch {} }
    const error = new Error(data.error || `Request failed (${response.status})`); error.data = data; error.status = response.status; throw error;
  }
  return data;
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3400);
}

async function refresh() {
  state = await api('/api/state');
  renderStatus();
  renderDashboard();
  renderProjects();
  renderContractors();
  renderSettings();
  await renderLaunch();
  await renderAdmin();
  if (currentProject) await openProject(currentProject, false);
}

function renderStatus() {
  const health = state.config.aiHealth || {};
  const labels = { live:`AI live · ${state.config.model}`, ready:`AI ready · ${state.config.model}`, 'billing-issue':'AI billing issue', error:'AI connection issue', disabled:'AI fallback mode' };
  $('#aiStatus').textContent = labels[health.status] || (state.config.aiEnabled ? `AI ready · ${state.config.model}` : 'AI fallback mode');
  $('#aiDot').classList.toggle('live', health.status === 'live');
  $('#aiDot').classList.toggle('warn-dot', ['billing-issue','error','ready'].includes(health.status));
  $('#sendStatus').textContent = state.config.integrations?.resend ? 'Email provider configured' : (state.config.outreachWebhookConfigured ? 'Outreach webhook configured' : 'Outreach stays local');
  const workspace = document.querySelector('.workspace-card strong'); if (workspace) workspace.textContent = state.settings?.organizationName || state.auth?.org?.name || 'BidMatch Workspace';
  if ($('#accountName')) $('#accountName').textContent = state.auth?.user?.name || state.auth?.user?.email || 'Local user';
  if ($('#accountRole')) $('#accountRole').textContent = (state.auth?.user?.role || 'viewer').toUpperCase();
}

function renderDashboard() {
  const active = state.projects.filter(project => project.status === 'active').length;
  const metrics = [
    ['Projects', state.counts.projects],
    ['Active bids', active],
    ['Bid documents', state.counts.documents],
    ['Invitations', state.counts.invitations],
    ['Bids received', state.counts.bids]
  ];
  $('#metricGrid').innerHTML = metrics.map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`).join('');
  $('#projectList').innerHTML = state.projects.length ? state.projects.slice().reverse().slice(0, 7).map(projectItem).join('') : `<div class="empty">Create a project and upload a bid set to begin.</div>`;
  bindProjectClicks($('#projectList'));
  const aiHealth = state.config.aiHealth || {};
  const aiLabel = ({live:'LIVE AI',ready:'READY / NOT TESTED','billing-issue':'BILLING ISSUE',error:'CONNECTION ISSUE',disabled:'LOCAL FALLBACK'})[aiHealth.status] || 'UNKNOWN';
  $('#healthPanel').innerHTML = `<div class="health-list">
    <div class="health-row"><span>Document intelligence</span><b class="${aiHealth.status === 'live' ? '' : 'warn'}">${aiLabel}</b></div>
    <div class="health-row"><span>Qualification engine</span><b>HARD GATES + FIT SCORE</b></div>
    <div class="health-row"><span>Contractor network</span><b>${state.counts.contractors} DIRECTORY FIRMS</b></div>
    <div class="health-row"><span>External email sending</span><b class="${state.config.integrations?.resend || state.config.outreachWebhookConfigured ? '' : 'warn'}">${state.config.integrations?.resend ? 'RESEND READY' : state.config.outreachWebhookConfigured ? 'WEBHOOK READY' : 'OFF'}</b></div>
    <div class="health-row"><span>Award / contract execution</span><b class="warn">HUMAN APPROVAL</b></div>
  </div>`;
}

function projectItem(project) {
  return `<div class="project-item" data-project-id="${project.id}"><div><strong>${esc(project.name)}</strong><small>${esc(project.location)} · ${esc(project.projectType || 'Unclassified')} · ${fmtMoney(project.estimatedValue)}</small></div><span class="status ${esc(project.status)}">${esc(project.workflowStage || project.status)}</span></div>`;
}

function renderProjects() {
  $('#projectsTable').innerHTML = state.projects.length ? state.projects.slice().reverse().map(projectItem).join('') : `<div class="empty">No projects in the pipeline.</div>`;
  bindProjectClicks($('#projectsTable'));
}

function bindProjectClicks(root) {
  $$('[data-project-id]', root).forEach(el => el.onclick = () => openProject(el.dataset.projectId));
}

function filteredContractors() {
  const query = ($('#contractorSearch')?.value || '').trim().toLowerCase();
  if (!query) return state.contractors;
  return state.contractors.filter(contractor => [
    contractor.name, contractor.city, contractor.homeState, contractor.prequalStatus,
    ...contractor.trades, ...contractor.markets, ...contractor.serviceStates, ...contractor.capabilities
  ].join(' ').toLowerCase().includes(query));
}

function renderContractors() {
  if (!state) return;
  const rows = filteredContractors();
  $('#contractorRows').innerHTML = rows.map(contractor => {
    const utilization = Math.round(Number(contractor.backlogUtilization || 0) * 100);
    const prequalClass = contractor.prequalStatus === 'Approved' ? 'good' : 'warn';
    return `<tr class="clickable" data-contractor-id="${contractor.id}">
      <td><strong>${esc(contractor.name)}</strong><br><span class="muted">${esc(contractor.city)}, ${esc(contractor.homeState || contractor.serviceStates?.[0] || '')} · ${contractor.employees} employees</span></td>
      <td><div class="chips">${contractor.trades.map(x => `<span class="chip">${esc(x)}</span>`).join('')}</div></td>
      <td><span class="chip ${prequalClass}">${esc(contractor.prequalStatus || 'Review')}</span><br><span class="muted">Quality ${contractor.qualityScore || '—'}/100</span></td>
      <td><strong>EMR ${Number(contractor.safety?.emr || 0).toFixed(2)}</strong><br><span class="muted">TRIR ${Number(contractor.safety?.trir || 0).toFixed(1)}</span></td>
      <td><strong>${utilization}% backlog</strong><br><span class="muted">${fmtMoney(contractor.currentBacklog)} active</span></td>
      <td>${fmtMoney(contractor.minPackage)}–${fmtMoney(contractor.maxPackage)}<br><span class="muted">Bond ${fmtMoney(contractor.bondCapacity)}</span></td>
      <td><strong>${fmtPct(contractor.responseRate)}</strong><br><span class="muted">~${contractor.avgResponseHours || '—'} hr response</span></td>
    </tr>`;
  }).join('') || `<tr><td colspan="7"><div class="empty">No contractors match that search.</div></td></tr>`;
  $$('[data-contractor-id]', $('#contractorRows')).forEach(el => el.onclick = () => showContractor(el.dataset.contractorId));
}

async function showContractor(id) {
  const contractor = state.contractors.find(x => x.id === id) || await api(`/api/contractors/${id}`);
  if (!contractor) return;
  const safety = contractor.safety || {};
  const workload = Math.round(Number(contractor.backlogUtilization || 0) * 100);
  $('#contractorProfile').innerHTML = `<div class="profile-wrap">
    <div class="profile-head"><div><p class="eyebrow">SUBCONTRACTOR PREQUALIFICATION PROFILE</p><h2>${esc(contractor.name)}</h2><p>${esc(contractor.description)}</p></div><button class="icon-btn" id="closeContractor">×</button></div>
    <div class="profile-metrics profile-metrics-six">
      <div><span>Prequal</span><strong>${esc(contractor.prequalStatus || 'Review')}</strong></div>
      <div><span>EMR</span><strong>${Number(safety.emr || 0).toFixed(2)}</strong></div>
      <div><span>Quality</span><strong>${contractor.qualityScore || '—'}/100</strong></div>
      <div><span>On-time</span><strong>${fmtPct(contractor.onTimeRate)}</strong></div>
      <div><span>Backlog</span><strong>${workload}%</strong></div>
      <div><span>Response</span><strong>${fmtPct(contractor.responseRate)}</strong></div>
    </div>
    <div class="profile-section"><h4>Trades & capabilities</h4><div class="chips">${[...contractor.trades, ...contractor.capabilities].map(x => `<span class="chip good">${esc(x)}</span>`).join('')}</div></div>
    <div class="profile-section"><h4>Capacity & workload</h4><div class="profile-grid"><div><span>Preferred package</span><strong>${fmtMoney(contractor.minPackage)}–${fmtMoney(contractor.maxPackage)}</strong></div><div><span>Bond capacity</span><strong>${fmtMoney(contractor.bondCapacity)}</strong></div><div><span>Annual volume</span><strong>${fmtMoney(contractor.avgAnnualVolume)}</strong></div><div><span>Current backlog</span><strong>${fmtMoney(contractor.currentBacklog)}</strong></div></div></div>
    <div class="profile-section"><h4>Safety & compliance</h4><div class="profile-grid"><div><span>EMR</span><strong>${Number(safety.emr || 0).toFixed(2)}</strong></div><div><span>TRIR</span><strong>${Number(safety.trir || 0).toFixed(1)}</strong></div><div><span>DART</span><strong>${Number(safety.dart || 0).toFixed(1)}</strong></div><div><span>Insurance</span><strong>${fmtMoney(contractor.insuranceLimit)}</strong></div></div><p class="muted">Service states: ${(contractor.serviceStates || []).join(', ')} · License states in demo record: ${(contractor.licenseStates || []).join(', ')} · Insurance expiry: ${fmtDate(contractor.insuranceExpiry)} · Bonding: ${esc(contractor.bondingStatus || 'Review')}</p></div>
    <div class="profile-section"><h4>Bid behavior</h4><p class="muted">Invited last 12 months: ${contractor.invitedLast12Months || 0} · Bids: ${contractor.bidsLast12Months || 0} · Awards: ${contractor.awardsLast12Months || 0} · Average response: ${contractor.avgResponseHours || '—'} hours</p></div>
    <div class="profile-section"><h4>Example project history</h4>${(contractor.pastProjects || []).map(project => `<div class="project-item"><div><strong>${esc(project.name)}</strong><small>${esc(project.type)}</small></div><span>${fmtMoney(project.value)}</span></div>`).join('')}</div>
    <div class="profile-section"><span class="warning">${contractor.demoData === false ? 'Imported contractor profile: verify licenses, insurance, bonding, safety, and prequalification before relying on this record.' : 'Demo contractor profile: identity and prequalification metrics are fictional and not independently verified.'}</span></div>
  </div>`;
  $('#closeContractor').onclick = () => $('#contractorDialog').close();
  $('#contractorDialog').showModal();
}

function showView(name) {
  $$('.view').forEach(view => view.classList.remove('active'));
  $$('.nav').forEach(nav => nav.classList.toggle('active', nav.dataset.view === name));
  if (name === 'projectDetail') {
    $('#projectDetailView').classList.add('active');
    $('#viewTitle').textContent = 'Project Workspace';
    return;
  }
  const headerActions = $('.topbar .header-actions'); if (headerActions) headerActions.classList.remove('hidden');
  $(`#${name}View`).classList.add('active');
  $('#viewTitle').textContent = { dashboard:'Client Command Center', projects:'Client Projects', contractors:'Contractor Directory', settings:'Workspace Settings', launch:'Launch & Team' }[name];
}

async function openProject(id, change = true) {
  currentProject = id;
  currentBundle = await api(`/api/projects/${id}`);
  if (change) showView('projectDetail');
  renderProjectDetail();
}

function renderProjectDetail() {
  const { project, documents, scopes, matches, invitations, bids, events, leveling, qa, workflow = {} } = currentBundle;
  const warnings = project.analysis?.warnings || [];
  const accepted = invitations.filter(inv => ['accepted','submitted'].includes(inv.status)).length;
  const coverage = scopes.length ? Math.round(scopes.filter(scope => matches.some(match => match.scopeId === scope.id && match.qualificationStatus === 'eligible')).length / scopes.length * 100) : 0;
  const stageNames = {intake:'Intake',scoping:'Scoping',bidding:'Bidding',leveling:'Leveling','award-ready':'Award ready',closed:'Closed'};
  $('#projectDetail').innerHTML = `<div class="detail-hero">
    <div class="detail-top"><div><p class="eyebrow">${esc(project.projectType || 'PROJECT')}</p><h2>${esc(project.name)}</h2><p>${esc(project.location)}</p><p class="detail-summary">${esc(project.analysis?.summary || project.description || 'Project intake created. Run automation to build the scope and contractor model.')}</p></div>
      <div class="detail-actions"><button class="btn primary" id="runAutomation">${scopes.length ? 'Re-analyze & match' : 'Run automation'}</button><button class="btn ghost" id="addScope">+ Scope</button><button class="btn ghost" id="addDocs">+ Documents</button><button class="btn ghost" id="addBid">+ Parse bid</button><button class="btn ghost" id="demoBids">Generate demo bids</button></div>
    </div>
    <div class="workflow-strip"><div class="workflow-stages">${(workflow.stages || ['intake','scoping','bidding','leveling','award-ready','closed']).map(stage => `<button class="workflow-stage ${workflow.stage === stage ? 'active' : ''}" data-stage="${stage}">${stageNames[stage] || stage}</button>`).join('')}</div>${workflow.nextActions?.length ? `<div class="next-actions"><strong>Next:</strong> ${workflow.nextActions.map(esc).join(' · ')}</div>` : ''}</div>
    <div class="detail-meta"><div><span>Estimated value</span><strong>${fmtMoney(project.analysis?.estimatedValue || project.estimatedValue)}</strong></div><div><span>Bid due</span><strong>${fmtDate(project.analysis?.bidDue || project.bidDue)}</strong></div><div><span>Documents</span><strong>${documents.length}</strong></div><div><span>Scopes</span><strong>${scopes.length}</strong></div><div><span>Qualified coverage</span><strong>${coverage}%</strong></div><div><span>Invitations</span><strong>${invitations.length}</strong></div><div><span>Accepted/submitted</span><strong>${accepted}</strong></div><div><span>Bids</span><strong>${bids.length}</strong></div></div>
    ${warnings.length ? `<div class="warnings">${warnings.map(warning => `<div class="warning">${esc(warning)}</div>`).join('')}</div>` : ''}
  </div>
  <div class="tabs">${[['overview','Overview'],['documents','Documents'],['scopes','Scopes & recommendations'],['outreach','Outreach'],['leveling','Bid leveling'],['qa','Project Q&A'],['activity','Activity']].map(([key,label]) => `<button class="tab ${currentTab === key ? 'active' : ''}" data-tab="${key}">${label}</button>`).join('')}</div>
  <div class="tab-panel ${currentTab === 'overview' ? 'active' : ''}">${renderOverview(project, documents, scopes, invitations, bids, workflow)}</div>
  <div class="tab-panel ${currentTab === 'documents' ? 'active' : ''}">${renderDocuments(documents)}</div>
  <div class="tab-panel ${currentTab === 'scopes' ? 'active' : ''}">${renderScopes(scopes, matches, invitations)}</div>
  <div class="tab-panel ${currentTab === 'outreach' ? 'active' : ''}">${renderOutreach(invitations)}</div>
  <div class="tab-panel ${currentTab === 'leveling' ? 'active' : ''}">${renderLeveling(leveling)}</div>
  <div class="tab-panel ${currentTab === 'qa' ? 'active' : ''}">${renderQA(qa, documents)}</div>
  <div class="tab-panel ${currentTab === 'activity' ? 'active' : ''}">${renderActivity(events)}</div>`;

  $$('.tab').forEach(button => button.onclick = () => { currentTab = button.dataset.tab; renderProjectDetail(); });
  $$('[data-stage]').forEach(button => button.onclick = () => updateProjectStage(button.dataset.stage));
  $('#runAutomation').onclick = runAutomation;
  $('#addScope').onclick = () => openScopeDialog();
  $('#addDocs').onclick = openAddDocs;
  $('#addBid').onclick = openBidDialog;
  $('#demoBids').onclick = generateDemoBids;
  $$('[data-contractor-profile]').forEach(el => el.onclick = event => { event.stopPropagation(); showContractor(el.dataset.contractorProfile); });
  $$('[data-invite-status]').forEach(el => el.onclick = () => updateInvite(el.dataset.inviteId, el.dataset.inviteStatus));
  $$('[data-edit-scope]').forEach(el => el.onclick = () => openScopeDialog(el.dataset.editScope));
  $$('[data-bid-list]').forEach(el => el.onclick = event => { event.stopPropagation(); updateBidList(el.dataset.scopeId, el.dataset.contractorId, el.dataset.bidList, el.dataset.qualification); });
  $$('[data-adjust-bid]').forEach(el => el.onclick = () => openAdjustmentDialog(el.dataset.adjustBid));
  const sendQueued = $('#sendQueuedInvites'); if (sendQueued) sendQueued.onclick = sendQueuedInvitations;
  const qf = $('#qaForm'); if (qf) qf.onsubmit = askQuestion;
}

async function updateProjectStage(stage) {
  try { currentBundle = await api(`/api/projects/${currentProject}/stage`, {method:'PATCH', body:JSON.stringify({stage})}); state = await api('/api/state'); renderProjectDetail(); renderProjects(); toast(`Workflow moved to ${stage}.`); }
  catch (error) { toast(error.message); }
}

function renderOverview(project, documents, scopes, invitations, bids = [], workflow = {}) {
  const facts = project.analysis?.facts || [];
  const submitted = invitations.filter(inv => inv.status === 'submitted').length;
  const response = invitations.length ? Math.round(invitations.filter(inv => ['accepted','declined','submitted'].includes(inv.status)).length / invitations.length * 100) : 0;
  return `<div class="summary-grid"><div class="card"><div class="card-head"><div><p class="eyebrow">PROJECT MODEL</p><h3>Extracted facts</h3></div></div>${facts.length ? `<div class="fact-list">${facts.map(fact => `<div class="fact">${esc(fact)}</div>`).join('')}</div>` : `<div class="empty">Run automation with project documents to extract building facts.</div>`}</div>
  <div class="card"><div class="card-head"><div><p class="eyebrow">PRECONSTRUCTION HEALTH</p><h3>Current coverage</h3></div></div><div class="health-list"><div class="health-row"><span>Documents loaded</span><b>${documents.length}</b></div><div class="health-row"><span>Editable bid packages</span><b>${scopes.length}</b></div><div class="health-row"><span>Contractor response</span><b class="${response < 40 ? 'warn' : ''}">${response}%</b></div><div class="health-row"><span>Bids submitted</span><b>${submitted}</b></div><div class="health-row"><span>Qualification reviews</span><b class="${workflow.conditionalCount ? 'warn' : ''}">${workflow.conditionalCount || 0}</b></div></div></div></div>`;
}

function renderDocuments(documents) {
  if (!documents.length) return `<div class="card"><div class="empty">No documents attached. Use “+ Documents” to add plans, specifications, addenda, or bid instructions.</div></div>`;
  return `<div class="card"><div class="card-head"><div><p class="eyebrow">BID SET</p><h3>${documents.length} attached document${documents.length === 1 ? '' : 's'}</h3></div><span class="muted">PDF understanding requires a working API balance; text files can also feed local fallback.</span></div><div class="doc-grid">${documents.map(doc => `<div class="doc-card"><strong>${esc(doc.name)}</strong><span>${esc(doc.mime || 'file')} · ${fmtBytes(doc.size)}</span><span>Added ${fmtDate(doc.createdAt)}</span></div>`).join('')}</div></div>`;
}

function renderScopes(scopes, matches, invitations) {
  if (!scopes.length) return `<div class="card"><div class="empty">Run automation or add a scope manually to start contractor recommendations.</div></div>`;
  const order = { eligible:0, conditional:1, ineligible:2 };
  return `<div class="scope-grid">${scopes.map(scope => {
    const ranked = matches.filter(match => match.scopeId === scope.id).sort((a,b) => (order[a.qualificationStatus] ?? 9) - (order[b.qualificationStatus] ?? 9) || b.score - a.score).slice(0, 8);
    const eligibleCount = matches.filter(m => m.scopeId === scope.id && m.qualificationStatus === 'eligible').length;
    const conditionalCount = matches.filter(m => m.scopeId === scope.id && m.qualificationStatus === 'conditional').length;
    const invited = new Map(invitations.filter(inv => inv.scopeId === scope.id).map(inv => [inv.contractorId, inv]));
    const q = scope.qualification || {};
    return `<div class="scope-card">
      <div class="scope-title"><div><span class="eyebrow">DIV ${esc(scope.division || '—')} · ${esc(scope.source || 'model')}</span><h4>${esc(scope.trade)}</h4></div><div class="scope-head-actions"><span class="score">${Math.round((scope.confidence || 0) * 100)}% confidence</span><button class="btn tiny" data-edit-scope="${scope.id}">Edit</button></div></div>
      <p>${esc(scope.summary)}</p>
      <div class="scope-meta"><div><span>Estimated package</span><strong>${fmtMoney(scope.estimatedPackage)}</strong></div><div><span>Qualified / conditional</span><strong>${eligibleCount} / ${conditionalCount}</strong></div><div><span>Bid list</span><strong>${invited.size}</strong></div></div>
      <div class="qualification-summary"><span>${q.requiresLicense ? 'License required' : 'License advisory'}</span><span>Insurance ${fmtMoney(q.insuranceRequirement || 0)}</span><span>${q.bondRequired ? 'Full bond capacity required' : 'Bond advisory'}</span><span>Hard cap ${(Number(q.hardCapacityMultiplier || 1.25)).toFixed(2)}×</span></div>
      ${scope.requirements?.length ? `<ul class="requirement-list">${scope.requirements.slice(0, 6).map(req => `<li>${esc(req)}</li>`).join('')}</ul>` : ''}
      <div class="recommendation-head"><span>Contractor recommendations</span><small>Qualification gates are separate from the fit score.</small></div>
      ${ranked.length ? ranked.map((match, index) => {
        const contractor = match.contractor || {}, invitation = invited.get(match.contractorId), status = match.qualificationStatus || (match.eligible ? 'eligible' : 'ineligible');
        const fitClass = match.score >= 86 ? 'strong' : match.score >= 77 ? 'good' : match.score >= 68 ? 'watch' : 'risk';
        const statusLabel = status === 'eligible' ? 'QUALIFIED' : status === 'conditional' ? 'CONDITIONAL' : 'INELIGIBLE';
        const issues = status === 'ineligible' ? (match.qualification?.failures || []) : (match.qualification?.warnings || match.risks || []);
        const disabled = status === 'ineligible' ? 'disabled' : '';
        const buttonText = invitation ? 'Remove' : status === 'conditional' ? 'Review & add' : status === 'ineligible' ? 'Cannot add' : 'Add to bid list';
        return `<div class="rank-row rank-row-v4 ${status}">
          <div class="rank-main clickable" data-contractor-profile="${match.contractorId}"><strong>${index + 1}. ${esc(contractor.name || '')}</strong><small>Fit ${match.score}% · EMR ${Number(contractor.safety?.emr || 0).toFixed(2)} · ${Math.round(Number(contractor.backlogUtilization || 0) * 100)}% backlog</small>${issues.length ? `<small class="${status === 'ineligible' ? 'hard-fail' : 'risk'}">${esc(issues[0])}</small>` : `<small>${esc((match.reasons || []).slice(0, 2).join(' '))}</small>`}</div>
          <div><span class="qualification-badge ${status}">${statusLabel}</span><span class="recommendation ${fitClass}">${esc(status === 'eligible' ? (match.recommendation || 'Review') : `Fit ${match.score}%`)}</span></div>
          <div class="reason"><div class="coverage-bar"><i style="width:${match.score}%"></i></div><small>Capacity ${match.components?.capacity || 0} · Safety ${match.components?.safety || 0} · Compliance ${match.components?.compliance || 0} · Workload ${match.components?.workload || 0}</small></div>
          <button class="btn tiny ${invitation ? 'ghost' : 'primary'}" ${disabled} data-bid-list="${invitation ? 'remove' : 'add'}" data-qualification="${status}" data-scope-id="${scope.id}" data-contractor-id="${match.contractorId}">${buttonText}</button>
        </div>`;
      }).join('') : `<div class="empty">No demo contractors perform this trade.</div>`}
    </div>`;
  }).join('')}</div>`;
}

function renderOutreach(invitations) {
  if (!invitations.length) return `<div class="card"><div class="empty">Invitations appear after matching or when you add a contractor to a bid list.</div></div>`;
  const queued = invitations.filter(inv => inv.status === 'queued').length;
  return `<div class="card"><div class="card-head"><div><p class="eyebrow">OUTREACH QUEUE</p><h3>${invitations.length} invitations</h3></div><button class="btn primary" id="sendQueuedInvites" ${queued ? '' : 'disabled'}>Send ${queued} queued</button></div><div class="table-wrap"><table><thead><tr><th>Contractor</th><th>Scope</th><th>Status</th><th>Delivery</th><th>Actions</th></tr></thead><tbody>${invitations.map(inv => `<tr><td><strong class="clickable" data-contractor-profile="${inv.contractorId}">${esc(inv.contractor?.name || '')}</strong><br><span class="muted">${esc(inv.contractor?.email || '')}</span></td><td>${esc(inv.scope?.trade || '')}</td><td><span class="status ${inv.status}">${esc(inv.status)}</span></td><td>${inv.sentExternally ? `External · ${inv.sentAt ? fmtDate(inv.sentAt) : 'sent'}` : inv.contractor?.email?.endsWith('.example') ? 'Demo email · never sent' : inv.manual ? 'Manual bid list · queued' : 'Automation queue'}</td><td><div class="chips"><button class="btn small" data-invite-id="${inv.id}" data-invite-status="accepted">Accept</button><button class="btn small" data-invite-id="${inv.id}" data-invite-status="declined">Decline</button></div></td></tr>`).join('')}</tbody></table></div></div>`;
}

function renderLeveling(leveling) {
  if (!leveling.length) return `<div class="card"><div class="empty">No bids yet. Parse a proposal or generate demo bids.</div></div>`;
  const head = `<div class="card compact-card"><div class="card-head"><div><p class="eyebrow">EXPORT</p><h3>Bid leveling report</h3></div><a class="btn ghost" href="/api/projects/${currentProject}/export">Download CSV</a></div></div>`;
  return head + leveling.map(group => `<div class="level-card">
    <div class="level-title"><div><strong>${esc(group.trade)}</strong><span>Package estimate ${fmtMoney(group.estimatedPackage)}</span></div><div class="level-kpis"><span><b>${group.summary.received}</b> bids</span><span><b>${fmtMoney(group.summary.lowLeveled)}</b> low leveled</span><span><b>${fmtMoney(group.summary.spread)}</b> spread</span><span><b>${Math.round((group.summary.spreadPct || 0) * 100)}%</b> spread %</span></div></div>
    <div class="ai-note"><strong>Leveling analysis:</strong> ${esc(group.narrative)} <span class="muted">Automatic exclusion allowances are prototype estimates; use Manual adjustment for estimator judgment.</span></div>
    <div class="table-wrap leveling-table"><table><thead><tr><th>Contractor</th><th>Base</th><th>Alternates</th><th>Exclusion allowance</th><th>Manual</th><th>Leveled</th><th>Vs low</th><th>Vs estimate</th><th>Exceptions</th><th></th></tr></thead><tbody>${group.bids.map((bid, index) => `<tr class="${index === 0 ? 'low-row' : ''}">
      <td><strong class="clickable" data-contractor-profile="${bid.contractorId}">${index === 0 ? '★ ' : ''}${esc(bid.contractorName)}</strong><br><span class="muted">${esc(bid.contractor?.prequalStatus || '')} · EMR ${Number(bid.contractor?.safety?.emr || 0).toFixed(2)}</span></td>
      <td>${fmtMoney(bid.amount)}</td>
      <td class="${bid.alternateNet ? 'delta' : ''}">${bid.alternateNet ? `${bid.alternateNet > 0 ? '+' : ''}${fmtMoney(bid.alternateNet)}` : '—'}</td>
      <td class="${bid.exclusionTotal ? 'delta' : ''}">${bid.exclusionTotal ? `+${fmtMoney(bid.exclusionTotal)}` : '—'}</td>
      <td class="${bid.manualAdjustment ? 'delta manual' : ''}">${bid.manualAdjustment ? `${bid.manualAdjustment > 0 ? '+' : ''}${fmtMoney(bid.manualAdjustment)}` : '—'}${bid.manualAdjustmentReason ? `<br><span class="muted">${esc(bid.manualAdjustmentReason)}</span>` : ''}</td>
      <td><strong class="leveled-number">${fmtMoney(bid.comparisonAmount)}</strong></td>
      <td>${bid.varianceToLow ? `+${fmtMoney(bid.varianceToLow)}<br><span class="muted">${fmtSignedPct(bid.varianceToLowPct)}</span>` : '<span class="chip good">LOW</span>'}</td>
      <td class="${Math.abs(bid.varianceToEstimatePct || 0) > .15 ? 'delta' : ''}">${fmtMoney(bid.varianceToEstimate)}<br><span class="muted">${fmtSignedPct(bid.varianceToEstimatePct)}</span></td>
      <td>${bid.issues?.length ? `<div class="chips">${bid.issues.map(issue => `<span class="chip ${bid.riskLevel === 'high' ? 'warn' : ''}">${esc(issue)}</span>`).join('')}</div>` : '<span class="chip good">No flags</span>'}${bid.parsed.exclusions?.length ? `<div class="exclusion-detail">${bid.parsed.exclusions.map(esc).join(' · ')}</div>` : ''}</td>
      <td><button class="btn tiny" data-adjust-bid="${bid.id}">Adjust</button></td>
    </tr>`).join('')}</tbody></table></div>
  </div>`).join('');
}

function renderQA(qa, documents) {
  const items = qa || [];
  return `<div class="qa-layout"><div class="qa-card"><p class="eyebrow">PROJECT DOCUMENT Q&A</p><h3>Ask the bid set</h3><p class="muted">With working API credits, questions can be answered against attached PDFs. Local mode can still answer structured project and edited-scope questions.</p><form class="qa-form" id="qaForm"><input id="qaQuestion" required placeholder="What flooring is specified? Is temporary power included in electrical?"/><button class="btn primary" type="submit">Ask</button></form><div class="qa-thread">${items.length ? items.map(item => `<div class="qa-item"><div class="q">${esc(item.question)}</div><div class="a">${esc(item.answer)}</div><div class="source">${esc(item.mode)} · ${esc((item.sources || []).join(', '))}</div></div>`).join('') : `<div class="empty">No questions asked yet.</div>`}</div></div><div class="qa-card"><p class="eyebrow">AVAILABLE SOURCES</p><h3>${documents.length} project documents</h3>${documents.length ? documents.map(doc => `<div class="doc-card"><strong>${esc(doc.name)}</strong><span>${fmtBytes(doc.size)}</span></div>`).join('') : `<div class="empty">Upload documents first.</div>`}</div></div>`;
}

function renderActivity(events) {
  return `<div class="card">${events.length ? events.map(event => `<div class="event"><time>${new Date(event.createdAt).toLocaleString()}</time><p>${esc(event.message)}</p></div>`).join('') : `<div class="empty">No activity yet.</div>`}</div>`;
}

async function runAutomation() {
  const button = $('#runAutomation');
  button.disabled = true; button.textContent = 'Analyzing…';
  try {
    currentBundle = await api(`/api/projects/${currentProject}/automation`, { method:'POST', body:'{}' });
    state = await api('/api/state');
    currentTab = 'scopes';
    renderDashboard(); renderProjects(); renderContractors(); renderProjectDetail();
    toast('Project analyzed and contractor recommendations rebuilt.');
  } catch (error) {
    toast(error.message); renderProjectDetail();
  }
}

async function updateInvite(id, status) {
  try {
    currentBundle = await api(`/api/projects/${currentProject}/invitations/${id}/status`, { method:'POST', body:JSON.stringify({ status }) });
    renderProjectDetail(); toast(`Invitation marked ${status}.`);
  } catch (error) { toast(error.message); }
}

async function updateBidList(scopeId, contractorId, action, qualification = 'eligible') {
  const send = async overrideConditional => api(`/api/projects/${currentProject}/scopes/${scopeId}/bid-list`, { method:'POST', body:JSON.stringify({ contractorId, action, overrideConditional }) });
  try {
    if (action === 'add' && qualification === 'conditional') {
      const match = currentBundle.matches.find(m => m.scopeId === scopeId && m.contractorId === contractorId);
      const details = match?.qualification?.warnings || [];
      if (!confirm(`This contractor is conditional:\n\n${details.join('\n') || 'Qualification review required.'}\n\nAdd to the bid list anyway?`)) return;
      currentBundle = await send(true);
    } else currentBundle = await send(false);
    state = await api('/api/state'); renderProjectDetail(); renderDashboard();
    toast(action === 'add' ? 'Contractor added to bid list.' : 'Contractor removed from bid list.');
  } catch (error) { toast(error.message === 'CONDITIONAL_REVIEW_REQUIRED' ? 'Qualification review is required before adding this contractor.' : error.message); }
}

async function generateDemoBids() {
  try {
    currentBundle = await api(`/api/projects/${currentProject}/bids/demo`, { method:'POST', body:'{}' });
    state = await api('/api/state');
    currentTab = 'leveling';
    renderProjectDetail(); renderDashboard();
    toast('Synthetic bids generated for testing.');
  } catch (error) { toast(error.message); }
}

async function askQuestion(event) {
  event.preventDefault();
  const input = $('#qaQuestion'); const question = input.value.trim(); if (!question) return;
  const button = event.submitter; button.disabled = true; button.textContent = 'Reading…';
  try {
    const result = await api(`/api/projects/${currentProject}/qa`, { method:'POST', body:JSON.stringify({ question }) });
    currentBundle = result; input.value = ''; renderProjectDetail();
    toast(result.latestAnswer?.mode === 'live-ai' ? 'AI answered from project sources.' : 'Answered from local structured data.');
  } catch (error) { toast(error.message); button.disabled = false; button.textContent = 'Ask'; }
}

function openScopeDialog(scopeId = '') {
  const scope = scopeId ? currentBundle.scopes.find(item => item.id === scopeId) : null;
  $('#scopeDialogTitle').textContent = scope ? `Edit ${scope.trade}` : 'Add bid package';
  $('#scopeId').value = scope?.id || '';
  $('#scopeTrade').value = scope?.trade || '';
  $('#scopeDivision').value = scope?.division || '';
  $('#scopeEstimate').value = scope?.estimatedPackage || '';
  $('#scopeConfidence').value = scope ? Math.round((scope.confidence || 0) * 100) : 100;
  $('#scopeSummary').value = scope?.summary || '';
  $('#scopeRequirements').value = (scope?.requirements || []).join('\n');
  const q = scope?.qualification || {};
  $('#scopeInsurance').value = q.insuranceRequirement ?? state.settings?.defaultInsuranceRequirement ?? 2000000;
  $('#scopeCapacityMultiplier').value = q.hardCapacityMultiplier ?? state.settings?.hardCapacityMultiplier ?? 1.25;
  $('#scopeRequiresLicense').checked = q.requiresLicense ?? true;
  $('#scopeBondRequired').checked = q.bondRequired ?? (Number(scope?.estimatedPackage || 0) >= Number(state.settings?.defaultBondingThreshold || 500000));
  $('#deleteScopeBtn').style.display = scope ? '' : 'none';
  $('#scopeDialog').showModal();
}

$('#scopeForm').onsubmit = async event => {
  event.preventDefault();
  const id = $('#scopeId').value;
  const payload = {
    trade: $('#scopeTrade').value.trim(),
    division: $('#scopeDivision').value.trim(),
    estimatedPackage: Number($('#scopeEstimate').value || 0),
    confidence: Number($('#scopeConfidence').value || 0) / 100,
    summary: $('#scopeSummary').value.trim(),
    requirements: $('#scopeRequirements').value.split(/\n+/).map(x => x.trim()).filter(Boolean),
    qualification: { requiresLicense:$('#scopeRequiresLicense').checked, insuranceRequirement:Number($('#scopeInsurance').value || 0), bondRequired:$('#scopeBondRequired').checked, hardCapacityMultiplier:Number($('#scopeCapacityMultiplier').value || 1.25) }
  };
  try {
    currentBundle = await api(id ? `/api/projects/${currentProject}/scopes/${id}` : `/api/projects/${currentProject}/scopes`, { method:id ? 'PATCH' : 'POST', body:JSON.stringify(payload) });
    state = await api('/api/state');
    $('#scopeDialog').close(); currentTab = 'scopes'; renderProjectDetail(); renderDashboard();
    toast(id ? 'Scope updated and recommendations rescored.' : 'Scope added and recommendations scored.');
  } catch (error) { toast(error.message); }
};

$('#deleteScopeBtn').onclick = async () => {
  const id = $('#scopeId').value; if (!id) return;
  const scope = currentBundle.scopes.find(item => item.id === id);
  if (!confirm(`Delete the ${scope?.trade || ''} scope?`)) return;
  try {
    currentBundle = await api(`/api/projects/${currentProject}/scopes/${id}`, { method:'DELETE' });
    state = await api('/api/state'); $('#scopeDialog').close(); renderProjectDetail(); renderDashboard(); toast('Scope removed.');
  } catch (error) { toast(error.message); }
};

function findLeveledBid(bidId) {
  for (const group of currentBundle.leveling || []) {
    const found = group.bids.find(bid => bid.id === bidId); if (found) return { group, bid:found };
  }
  return null;
}

function openAdjustmentDialog(bidId) {
  const found = findLeveledBid(bidId); if (!found) return;
  const { group, bid } = found;
  $('#adjustBidId').value = bid.id;
  $('#adjustAmount').value = bid.manualAdjustment || '';
  $('#adjustReason').value = bid.manualAdjustmentReason || '';
  $('#adjustSummary').innerHTML = `<div><span>Scope</span><strong>${esc(group.trade)}</strong></div><div><span>Contractor</span><strong>${esc(bid.contractorName)}</strong></div><div><span>Base bid</span><strong>${fmtMoney(bid.amount)}</strong></div><div><span>Auto adjustments</span><strong>${fmtMoney((bid.alternateNet || 0) + (bid.exclusionTotal || 0))}</strong></div>`;
  $('#adjustBidDialog').showModal();
}

$('#adjustBidForm').onsubmit = async event => {
  event.preventDefault();
  const bidId = $('#adjustBidId').value;
  try {
    currentBundle = await api(`/api/projects/${currentProject}/bids/${bidId}/adjustment`, { method:'PATCH', body:JSON.stringify({ amount:Number($('#adjustAmount').value || 0), reason:$('#adjustReason').value.trim() }) });
    $('#adjustBidDialog').close(); currentTab = 'leveling'; renderProjectDetail(); toast('Manual leveling adjustment applied.');
  } catch (error) { toast(error.message); }
};

function openBidDialog() {
  const scopes = currentBundle.scopes;
  if (!scopes.length) { toast('Add or generate a scope first.'); return; }
  $('#bidScope').innerHTML = scopes.map(scope => `<option value="${scope.id}">${esc(scope.trade)}</option>`).join('');
  fillContractorOptions(); $('#bidScope').onchange = fillContractorOptions; $('#bidDialog').showModal();
}

function fillContractorOptions() {
  const scopeId = $('#bidScope').value;
  const ids = new Set(currentBundle.invitations.filter(inv => inv.scopeId === scopeId).map(inv => inv.contractorId));
  const contractors = state.contractors.filter(contractor => ids.has(contractor.id));
  $('#bidContractor').innerHTML = (contractors.length ? contractors : state.contractors).map(contractor => `<option value="${contractor.id}">${esc(contractor.name)}</option>`).join('');
}

$('#bidForm').onsubmit = async event => {
  event.preventDefault();
  try {
    currentBundle = await api(`/api/projects/${currentProject}/bids/parse`, { method:'POST', body:JSON.stringify({ scopeId:$('#bidScope').value, contractorId:$('#bidContractor').value, proposalText:$('#proposalText').value }) });
    $('#bidDialog').close(); $('#proposalText').value = ''; state = await api('/api/state'); currentTab = 'leveling'; renderProjectDetail(); renderDashboard(); toast('Proposal parsed and leveled.');
  } catch (error) { toast(error.message); }
};

function openProjectDialog() { newProjectFiles = []; renderSelectedFiles('project'); $('#projectDialog').showModal(); }
function openAddDocs() { addDocumentFiles = []; renderSelectedFiles('add'); $('#addDocsDialog').showModal(); }

function setupDropzone(zoneId, inputId, mode) {
  const zone = $(zoneId), input = $(inputId);
  const set = files => { if (mode === 'project') newProjectFiles = mergeFiles(newProjectFiles, files); else addDocumentFiles = mergeFiles(addDocumentFiles, files); renderSelectedFiles(mode); };
  input.onchange = () => set([...input.files]);
  ['dragenter','dragover'].forEach(type => zone.addEventListener(type, event => { event.preventDefault(); zone.classList.add('drag'); }));
  ['dragleave','drop'].forEach(type => zone.addEventListener(type, event => { event.preventDefault(); zone.classList.remove('drag'); }));
  zone.addEventListener('drop', event => set([...event.dataTransfer.files]));
}

function mergeFiles(current, incoming) {
  const map = new Map(current.map(file => [`${file.name}-${file.size}`, file]));
  for (const file of incoming) {
    if (file.size > 12 * 1024 * 1024) { toast(`${file.name} is larger than 12 MB.`); continue; }
    map.set(`${file.name}-${file.size}`, file);
  }
  return [...map.values()].slice(0, 8);
}

function renderSelectedFiles(mode) {
  const files = mode === 'project' ? newProjectFiles : addDocumentFiles;
  const el = $(mode === 'project' ? '#projectFileList' : '#addDocsList');
  el.innerHTML = files.map(file => `<div class="file-pill"><strong>${esc(file.name)}</strong><span>${fmtBytes(file.size)}</span></div>`).join('');
}

async function serializeFiles(files) {
  const out = [];
  for (const file of files) out.push({ name:file.name, mime:file.type || guessMime(file.name), data:await toBase64(file) });
  return out;
}
function guessMime(name) { const ext = name.split('.').pop().toLowerCase(); return ext === 'pdf' ? 'application/pdf' : ext === 'csv' ? 'text/csv' : 'text/plain'; }
function toBase64(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = reject; reader.readAsDataURL(file); }); }

$('#projectForm').onsubmit = async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true; button.textContent = 'Creating…';
  try {
    const form = new FormData(event.target), files = await serializeFiles(newProjectFiles);
    const payload = { name:form.get('name'), location:form.get('location'), projectType:form.get('projectType'), estimatedValue:Number(form.get('estimatedValue') || 0), bidDue:form.get('bidDue'), description:form.get('description'), files };
    const created = await api('/api/projects', { method:'POST', body:JSON.stringify(payload) });
    event.target.reset(); newProjectFiles = []; $('#projectDialog').close(); await refresh(); await openProject(created.project.id); toast(`Project created with ${files.length} document${files.length === 1 ? '' : 's'}.`);
  } catch (error) { toast(error.message); } finally { button.disabled = false; button.textContent = 'Create project'; }
};

$('#addDocsForm').onsubmit = async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true; button.textContent = 'Uploading…';
  try {
    const files = await serializeFiles(addDocumentFiles); if (!files.length) throw new Error('Select at least one document.');
    currentBundle = await api(`/api/projects/${currentProject}/documents`, { method:'POST', body:JSON.stringify({ files }) });
    $('#addDocsDialog').close(); addDocumentFiles = []; state = await api('/api/state'); currentTab = 'documents'; renderProjectDetail(); renderDashboard(); toast('Documents added. Re-run automation to include them.');
  } catch (error) { toast(error.message); } finally { button.disabled = false; button.textContent = 'Upload documents'; }
};


async function sendQueuedInvitations() {
  const button = $('#sendQueuedInvites'); if (button) { button.disabled = true; button.textContent = 'Sending…'; }
  try {
    const result = await api(`/api/projects/${currentProject}/outreach/send`, {method:'POST', body:'{}'});
    currentBundle = result.bundle; state = await api('/api/state'); renderProjectDetail(); renderDashboard();
    const sent = (result.results || []).filter(x => x.ok).length, skipped = (result.results || []).filter(x => x.skipped).length;
    toast(`${sent} invitation${sent===1?'':'s'} sent${skipped ? ` · ${skipped} demo/missing emails skipped` : ''}.`);
  } catch (error) { toast(error.message); if (button) { button.disabled = false; button.textContent = 'Send queued'; } }
}

async function renderLaunch() {
  if (!state || !$('#launchReadiness')) return;
  const launch = state.config.launch || {};
  const rows = [
    ['Accounts & roles', launch.auth, launch.auth === 'configured'],
    ['Database', launch.database, String(launch.database).includes('live') || String(launch.database).includes('ready')],
    ['Document storage', launch.storage, String(launch.storage).includes('live') || String(launch.storage).includes('ready')],
    ['Email delivery', launch.email, String(launch.email).includes('live') || String(launch.email).includes('ready')],
    ['Subscription billing', launch.billing, String(launch.billing).includes('live') || String(launch.billing).includes('ready')],
    ['AI document intelligence', launch.ai, launch.ai === 'live'],
    ['Backup/export tooling', launch.backup, true]
  ];
  $('#launchReadiness').innerHTML = `<div class="health-list">${rows.map(([label,value,ok]) => `<div class="health-row"><span>${esc(label)}</span><b class="${ok?'':'warn'}">${esc(String(value||'not configured').toUpperCase())}</b></div>`).join('')}</div>`;
  $('#deploymentPanel').innerHTML = `<div class="health-list"><div class="health-row"><span>Supabase Postgres / Storage</span><b class="${state.config.integrations?.supabase?'':'warn'}">${state.config.integrations?.supabase?'CONFIGURED':'LOCAL MODE'}</b></div><div class="health-row"><span>Resend email</span><b class="${state.config.integrations?.resend?'':'warn'}">${state.config.integrations?.resend?'CONFIGURED':'NOT CONNECTED'}</b></div><div class="health-row"><span>Stripe subscriptions</span><b class="${state.config.integrations?.stripe?'':'warn'}">${state.config.integrations?.stripe?'CONFIGURED':'NOT CONNECTED'}</b></div><div class="health-row"><span>Environment</span><b>V6.1 CLIENT PORTAL</b></div></div>`;
  $('#billingPanel').innerHTML = `<div class="health-list"><div class="health-row"><span>Subscription status</span><b class="${['active','trialing','checkout-complete'].includes(state.billing?.status)?'':'warn'}">${esc(String(state.billing?.status||'not configured').toUpperCase())}</b></div></div>${state.config.integrations?.stripe ? `<button class="btn primary launch-action" id="billingCheckoutBtn">Open subscription checkout</button>` : `<p class="muted">Add Stripe keys and a recurring price ID in .env to enable checkout.</p>`}`;
  if ($('#billingCheckoutBtn')) $('#billingCheckoutBtn').onclick = async () => { try { const x=await api('/api/billing/checkout',{method:'POST',body:'{}'}); if(x.url) window.location.href=x.url; } catch(error){toast(error.message);} };
  try {
    const team = await api('/api/team');
    $('#teamPanel').innerHTML = team.members.length ? team.members.map(m => `<div class="team-row"><div><strong>${esc(m.name||m.email)}</strong><span>${esc(m.email)}</span></div><span class="chip ${m.role==='owner'?'good':''}">${esc(m.role)}</span></div>`).join('') : `<div class="empty">No team members found.</div>`;
  } catch (error) { $('#teamPanel').innerHTML = `<div class="empty">${esc(error.message)}</div>`; }
}


function showAuthPanel(name) {
  $('#authGate').classList.remove('hidden');
  ['#authBootstrap','#authLogin','#authInvite','#authRegister'].forEach(id => $(id).classList.add('hidden'));
  $(name).classList.remove('hidden');
}
function hideAuthGate() { $('#authGate').classList.add('hidden'); }
function authError(message='') { const el=$('#authError'); el.textContent=message; el.classList.toggle('hidden',!message); }

async function initializeApp() {
  const inviteToken = new URLSearchParams(location.search).get('invite');
  if (inviteToken) {
    try { const info=await api(`/api/auth/invite?token=${encodeURIComponent(inviteToken)}`); $('#inviteDetails').textContent=`${info.email} · ${info.role} · ${info.org?.name||'BidMatch workspace'}`; showAuthPanel('#authInvite'); }
    catch(error){ authError(error.message); showAuthPanel('#authLogin'); }
    return;
  }
  const status = await api('/api/auth/status');
  if (status.requiresBootstrap) { showAuthPanel('#authBootstrap'); return; }
  if (status.loginRequired && !status.authenticated) { $('#showRegisterBtn').classList.toggle('hidden',!status.allowSelfSignup); showAuthPanel('#authLogin'); return; }
  hideAuthGate(); await refresh();
}

function renderSettings() {
  if (!state || !$('#settingsForm')) return;
  const settings = state.settings || {};
  $('#settingOrgName').value = settings.organizationName || '';
  $('#settingInsurance').value = settings.defaultInsuranceRequirement || 0;
  $('#settingBondThreshold').value = settings.defaultBondingThreshold || 0;
  $('#settingCapacityMultiplier').value = settings.hardCapacityMultiplier || 1.25;
  $('#settingTopMatches').value = settings.topMatchesPerScope || 5;
  const h = state.config.aiHealth || {};
  $('#settingsHealth').innerHTML = `<div class="health-list"><div class="health-row"><span>AI configuration</span><b>${state.config.aiEnabled ? 'KEY CONFIGURED' : 'NO KEY'}</b></div><div class="health-row"><span>Last AI state</span><b class="${h.status === 'live' ? '' : 'warn'}">${esc((h.status || 'disabled').toUpperCase())}</b></div><div class="health-row"><span>Last success</span><b>${h.lastSuccess ? fmtDate(h.lastSuccess) : '—'}</b></div><div class="health-row"><span>Last error</span><b class="warn">${h.lastError ? esc(h.lastError).slice(0,120) : '—'}</b></div><div class="health-row"><span>External outreach</span><b class="${state.config.integrations?.resend || state.config.outreachWebhookConfigured ? '' : 'warn'}">${state.config.integrations?.resend ? 'RESEND READY' : state.config.outreachWebhookConfigured ? 'WEBHOOK READY' : 'LOCAL ONLY'}</b></div></div>`;
}

$('#settingsForm').onsubmit = async event => {
  event.preventDefault();
  try {
    await api('/api/settings', {method:'PATCH', body:JSON.stringify({organizationName:$('#settingOrgName').value.trim(),defaultInsuranceRequirement:Number($('#settingInsurance').value||0),defaultBondingThreshold:Number($('#settingBondThreshold').value||0),hardCapacityMultiplier:Number($('#settingCapacityMultiplier').value||1.25),topMatchesPerScope:Number($('#settingTopMatches').value||5)})});
    await refresh(); toast('Workspace settings saved. New scopes use these defaults.');
  } catch (error) { toast(error.message); }
};

$$('[data-close-project]').forEach(el => el.onclick = () => $('#projectDialog').close());
$$('[data-close-docs]').forEach(el => el.onclick = () => $('#addDocsDialog').close());
$$('[data-close-bid]').forEach(el => el.onclick = () => $('#bidDialog').close());
$$('[data-close-scope]').forEach(el => el.onclick = () => $('#scopeDialog').close());
$$('[data-close-adjust]').forEach(el => el.onclick = () => $('#adjustBidDialog').close());
$$('[data-close-import]').forEach(el => el.onclick = () => $('#importContractorsDialog').close());
$$('[data-close-team]').forEach(el => el.onclick = () => $('#inviteTeamDialog').close());
$('#newProjectBtn').onclick = openProjectDialog;
$('#heroNewProject').onclick = openProjectDialog;
$$('[data-open-project]').forEach(el => el.onclick = openProjectDialog);
$('#backToProjects').onclick = () => { currentProject = null; currentBundle = null; showView('projects'); };
$('#resetBtn').onclick = async () => { if (!confirm('Reset this workspace\'s V5 project data, imported contractors, and local documents?')) return; try { await api('/api/reset', { method:'POST', body:'{}' }); currentProject = null; currentBundle = null; currentTab = 'overview'; showView('dashboard'); await refresh(); toast('Workspace demo data reset.'); } catch(error){toast(error.message);} };
$$('.nav').forEach(nav => nav.onclick = () => showView(nav.dataset.view));
$('#contractorSearch').addEventListener('input', renderContractors);
$('#importContractorsBtn').onclick = () => $('#importContractorsDialog').showModal();
$('#inviteTeamBtn').onclick = () => { $('#teamInviteResult').textContent=''; $('#inviteTeamDialog').showModal(); };
$('#backupBtn').onclick = async () => { try { const r=await api('/api/backup',{method:'POST',body:'{}'}); toast(`Backup created: ${r.file}`); } catch(error){toast(error.message);} };
$('#logoutBtn').onclick = async () => { try { await api('/api/auth/logout',{method:'POST',body:'{}'}); state=null; currentProject=null; showAuthPanel('#authLogin'); } catch(error){toast(error.message);} };
$('#importContractorsForm').onsubmit = async event => { event.preventDefault(); try { const result=await api('/api/contractors/import',{method:'POST',body:JSON.stringify({csv:$('#contractorCsv').value})}); $('#importContractorsDialog').close(); $('#contractorCsv').value=''; await refresh(); toast(`${result.created} contractor${result.created===1?'':'s'} imported.`); } catch(error){toast(error.message);} };
$('#inviteTeamForm').onsubmit = async event => { event.preventDefault(); try { const result=await api('/api/team/invite',{method:'POST',body:JSON.stringify({email:$('#teamEmail').value,role:$('#teamRole').value})}); $('#teamInviteResult').innerHTML=`Invite ${result.delivered?'emailed':'created locally'}: <code>${esc(result.inviteUrl)}</code>`; await renderLaunch(); toast(result.delivered?'Invite email sent.':'Invite link created.'); } catch(error){toast(error.message);} };
$('#bootstrapForm').onsubmit = async event => { event.preventDefault(); authError(''); try { await api('/api/auth/bootstrap',{method:'POST',body:JSON.stringify({orgName:$('#bootstrapOrg').value,name:$('#bootstrapName').value,email:$('#bootstrapEmail').value,password:$('#bootstrapPassword').value})}); hideAuthGate(); await refresh(); } catch(error){authError(error.message);} };
$('#loginForm').onsubmit = async event => { event.preventDefault(); authError(''); try { await api('/api/auth/login',{method:'POST',body:JSON.stringify({email:$('#loginEmail').value,password:$('#loginPassword').value})}); hideAuthGate(); await refresh(); } catch(error){authError(error.message);} };
$('#showRegisterBtn').onclick = () => { authError(''); showAuthPanel('#authRegister'); };
$('#backToLoginBtn').onclick = () => { authError(''); showAuthPanel('#authLogin'); };
$('#registerForm').onsubmit = async event => { event.preventDefault(); authError(''); try { await api('/api/auth/register-workspace',{method:'POST',body:JSON.stringify({orgName:$('#registerOrg').value,name:$('#registerName').value,email:$('#registerEmail').value,password:$('#registerPassword').value})}); hideAuthGate(); await refresh(); } catch(error){authError(error.message);} };
$('#acceptInviteForm').onsubmit = async event => { event.preventDefault(); authError(''); const token=new URLSearchParams(location.search).get('invite')||''; try { await api('/api/auth/accept-invite',{method:'POST',body:JSON.stringify({token,name:$('#inviteName').value,password:$('#invitePassword').value})}); history.replaceState({},'',location.pathname); hideAuthGate(); await refresh(); } catch(error){authError(error.message);} };
setupDropzone('#projectDropzone', '#projectFiles', 'project');
setupDropzone('#addDocsDropzone', '#addDocsFiles', 'add');
initializeApp().catch(error => { authError(error.message); showAuthPanel('#authLogin'); });
