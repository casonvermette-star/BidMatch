const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const token=decodeURIComponent(location.pathname.split('/').filter(Boolean)[1]||'');
let invitation=null;

async function api(path,options={}){
  const res=await fetch(path,{headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
  const text=await res.text();let data={};try{data=text?JSON.parse(text):{};}catch{data={error:text||res.statusText};}
  if(!res.ok)throw new Error(data.error||'Request failed.');return data;
}
function fmtDate(v){if(!v)return 'TBD';const d=new Date(v.length===10?`${v}T12:00:00`:v);return Number.isNaN(d.getTime())?v:d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});}
function lines(v){return String(v||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);}
function fileBase64(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]||'');r.onerror=()=>reject(new Error('Could not read proposal file.'));r.readAsDataURL(file);});}
function setStatus(status){const label=String(status||'queued').replace('-', ' ');$('#portalStatus').textContent=label.toUpperCase();$('#portalStatus').className=`chip ${['accepted','submitted'].includes(status)?'good':status==='declined'?'warn':''}`;if(status==='submitted'){ $('#submissionChip').textContent='Submitted';$('#submissionChip').className='chip good';}}
function render(data){
  invitation=data;$('#portalProjectName').textContent=data.project.name;$('#portalLocation').textContent=`${data.project.location} · ${data.project.projectType||'Construction project'}`;$('#portalTrade').textContent=data.scope.trade;$('#portalDue').textContent=fmtDate(data.project.bidDue);$('#portalContractor').textContent=data.contractor.name;$('#portalSummary').textContent=data.project.summary||'';$('#portalScopeSummary').textContent=data.scope.summary||'';
  $('#portalRequirements').innerHTML=(data.scope.requirements||[]).map(x=>`<li>${esc(x)}</li>`).join('')||'<li>Review the project documents for full scope requirements.</li>';
  $('#portalDocuments').innerHTML=(data.documents||[]).length?(data.documents||[]).map(d=>`<a class="bid-document-row" href="/api/public/invitations/${encodeURIComponent(token)}/documents/${encodeURIComponent(d.id)}"><div><strong>${esc(d.name)}</strong><span>${esc(d.mime||'Document')}</span></div><span>Download</span></a>`).join(''):'<div class="empty">No project documents are attached to this invitation yet.</div>';
  setStatus(data.invitation.status);if(data.invitation.status==='declined')$('#bidSubmitForm').classList.add('bid-form-disabled');else $('#bidSubmitForm').classList.remove('bid-form-disabled');
  $('#portalContent').classList.remove('hidden');
}
async function load(){try{if(!token)throw new Error('Invitation link is missing.');render(await api(`/api/public/invitations/${encodeURIComponent(token)}`));}catch(e){$('#portalError').textContent=e.message;$('#portalError').classList.remove('hidden');}}
async function status(next){try{render(await api(`/api/public/invitations/${encodeURIComponent(token)}/status`,{method:'POST',body:JSON.stringify({status:next})}));}catch(e){alert(e.message);}}
$('#acceptInvite').onclick=()=>status('accepted');
$('#declineInvite').onclick=()=>{if(confirm('Decline this bid invitation?'))status('declined');};
$('#bidSubmitForm').onsubmit=async event=>{
  event.preventDefault();if(invitation?.invitation?.status==='declined'){alert('Accept the invitation before submitting a bid.');return;}
  const button=event.submitter;button.disabled=true;button.textContent='Submitting…';
  try{
    const file=$('#bidFile').files?.[0]||null;if(file&&file.size>50*1024*1024)throw new Error('Proposal attachment must be 50 MB or smaller.');
    const body={amount:Number($('#bidAmount').value),schedule:$('#bidSchedule').value,bondIncluded:$('#bidBond').value,taxIncluded:$('#bidTax').value,inclusions:lines($('#bidInclusions').value),exclusions:lines($('#bidExclusions').value),alternates:lines($('#bidAlternates').value),proposalText:$('#bidProposalText').value,notes:[]};
    if(file)body.file={name:file.name,mime:file.type||'application/octet-stream',data:await fileBase64(file)};
    const result=await api(`/api/public/invitations/${encodeURIComponent(token)}/submit`,{method:'POST',body:JSON.stringify(body)});$('#bidSubmitResult').innerHTML=`<div class="success-panel"><strong>Bid submitted.</strong><p>Your proposal has been delivered to the GC workspace.</p></div>`;$('#bidSubmitResult').classList.remove('hidden');setStatus(result.status);event.target.reset();
  }catch(e){$('#bidSubmitResult').innerHTML=`<div class="warning">${esc(e.message)}</div>`;$('#bidSubmitResult').classList.remove('hidden');}
  finally{button.disabled=false;button.textContent='Submit bid';}
};
load();
