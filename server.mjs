import http from 'node:http';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { createAuthStore, roleAtLeast } from './lib/auth.mjs';
import { createPlatformAdminAuth } from './lib/admin-auth.mjs';
import { integrationConfig, sendEmail, createCheckoutSession, supabaseHealth, loadCloudState, saveCloudState, loadCloudAuthState, saveCloudAuthState, uploadSupabaseObject, downloadSupabaseObject, createBackupManager } from './lib/integrations.mjs';

const ROOT = process.cwd();
const DATA_DIR = join(ROOT, 'data');
const UPLOAD_DIR = join(DATA_DIR, 'uploads');
const DB_FILE = join(DATA_DIR, 'db.json');
const AUTH_FILE = join(DATA_DIR, 'auth.json');
const PUBLIC_DIR = join(ROOT, 'public');

loadDotEnv(join(ROOT, '.env'));

const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6';
const OPENAI_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const AUTO_SEND_INVITES = String(process.env.AUTO_SEND_INVITES || 'false').toLowerCase() === 'true';
const OUTREACH_WEBHOOK_URL = process.env.OUTREACH_WEBHOOK_URL || '';
const TOP_MATCHES_PER_SCOPE = clamp(Number(process.env.TOP_MATCHES_PER_SCOPE || 5), 1, 10);
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_PROJECT_FILES = 8;
const REQUIRE_LOGIN = String(process.env.REQUIRE_LOGIN ?? 'true').toLowerCase() !== 'false';
const ALLOW_SELF_SIGNUP = String(process.env.ALLOW_SELF_SIGNUP || 'false').toLowerCase() === 'true';
const PLATFORM_ADMIN_EMAIL = process.env.PLATFORM_ADMIN_EMAIL || '';
const PLATFORM_ADMIN_PASSWORD_HASH = process.env.PLATFORM_ADMIN_PASSWORD_HASH || '';
const PLATFORM_ADMIN_SESSION_SECRET = process.env.PLATFORM_ADMIN_SESSION_SECRET || '';
const APP_ENV = process.env.APP_ENV || 'development';
const HOST = process.env.HOST || (APP_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const INTEGRATIONS = integrationConfig(process.env);
const CLOUD_AUTH_STATE = INTEGRATIONS.supabase.configured ? await loadCloudAuthState(INTEGRATIONS.supabase).catch(()=>null) : null;
const AUTH = await createAuthStore(AUTH_FILE,{secureCookies:APP_ENV==='production',loginRequired:REQUIRE_LOGIN,initialData:CLOUD_AUTH_STATE,onSave:INTEGRATIONS.supabase.configured?(payload)=>saveCloudAuthState(INTEGRATIONS.supabase,payload):null});
const ADMIN_AUTH = createPlatformAdminAuth({email:PLATFORM_ADMIN_EMAIL,passwordHash:PLATFORM_ADMIN_PASSWORD_HASH,sessionSecret:PLATFORM_ADMIN_SESSION_SECRET,secureCookies:APP_ENV==='production'});
const BACKUPS = createBackupManager({rootDir:ROOT,dataFile:DB_FILE,authFile:AUTH_FILE});
const RATE_LIMIT = new Map();
const JOB_INTERVAL_MS = Math.max(15000, Number(process.env.JOB_INTERVAL_MS || 60000));

const PROJECT_STAGES = ['intake','scoping','bidding','leveling','award-ready','closed'];
let aiHealth = { configured: !!OPENAI_API_KEY, status: OPENAI_API_KEY ? 'ready' : 'disabled', lastSuccess: null, lastFailure: null, lastError: '' };

function defaultSettings(){
  return {
    organizationName:'Demo General Contractor',
    defaultInsuranceRequirement:2000000,
    defaultBondingThreshold:500000,
    hardCapacityMultiplier:1.25,
    topMatchesPerScope:TOP_MATCHES_PER_SCOPE,
    autoInviteEligibleOnly:true
  };
}

function ensureV5(data){
  const legacy={...defaultSettings(),...(data.settings||{})};
  data.version=5;
  data.orgSettings=data.orgSettings||{};
  data.billing=data.billing||{};
  data.jobs=data.jobs||[];
  data.projects=(data.projects||[]).map(p=>({...p,workflowStage:p.workflowStage||((p.status==='draft')?'intake':'scoping'),orgId:p.orgId||null}));
  data.contractors=(data.contractors||[]).map(c=>({...c,orgId:c.orgId||null}));
  data.scopes=(data.scopes||[]).map(scope=>withQualificationDefaults(scope,legacy));
  data.settings=legacy;
  return data;
}

function settingsForOrg(orgId){
  const key=orgId||'local-demo-org';
  db.orgSettings=db.orgSettings||{};
  if(!db.orgSettings[key]) db.orgSettings[key]={...defaultSettings(),...(db.settings||{})};
  return db.orgSettings[key];
}
function projectForOrg(id,orgId){return db.projects.find(p=>p.id===id && (p.orgId===orgId || (!p.orgId && orgId==='local-demo-org')));}
function visibleContractors(orgId){return db.contractors.filter(c=>!c.orgId||c.orgId===orgId);}
function orgProjectIds(orgId){return new Set(db.projects.filter(p=>p.orgId===orgId || (!p.orgId&&orgId==='local-demo-org')).map(p=>p.id));}
function claimUnscopedData(orgId){for(const p of db.projects)if(!p.orgId)p.orgId=orgId; if(db.settings&&!db.orgSettings?.[orgId]){db.orgSettings=db.orgSettings||{};db.orgSettings[orgId]={...defaultSettings(),...db.settings};}}

function withQualificationDefaults(scope,settings=null){
  const est=Number(scope.estimatedPackage||0);
  return {...scope,qualification:{
    requiresLicense: scope.qualification?.requiresLicense ?? true,
    insuranceRequirement: Number(scope.qualification?.insuranceRequirement ?? settings?.defaultInsuranceRequirement ?? 2000000),
    bondRequired: scope.qualification?.bondRequired ?? (est >= Number(settings?.defaultBondingThreshold ?? 500000)),
    hardCapacityMultiplier: Number(scope.qualification?.hardCapacityMultiplier ?? settings?.hardCapacityMultiplier ?? 1.25)
  }};
}

const TRADE_CATALOG = [
  { name: 'Concrete', division: '03', pct: 0.07, keywords: ['concrete','cast-in-place','foundation','slab','footing','rebar'] },
  { name: 'Masonry', division: '04', pct: 0.025, keywords: ['masonry','brick','cmu','block wall'] },
  { name: 'Structural Steel', division: '05', pct: 0.055, keywords: ['structural steel','steel framing','miscellaneous metals','steel erection'] },
  { name: 'Carpentry', division: '06', pct: 0.04, keywords: ['carpentry','millwork','casework','wood framing'] },
  { name: 'Waterproofing', division: '07', pct: 0.015, keywords: ['waterproofing','dampproofing','membrane'] },
  { name: 'Roofing', division: '07', pct: 0.022, keywords: ['roofing','tpo','epdm','shingle','roof'] },
  { name: 'Doors & Hardware', division: '08', pct: 0.018, keywords: ['doors','frames','hardware','storefront'] },
  { name: 'Drywall', division: '09', pct: 0.045, keywords: ['drywall','gypsum','metal framing','acoustical ceiling'] },
  { name: 'Painting', division: '09', pct: 0.016, keywords: ['painting','coating','paint'] },
  { name: 'Flooring', division: '09', pct: 0.027, keywords: ['flooring','lvt','carpet','tile','resilient flooring'] },
  { name: 'Fire Protection', division: '21', pct: 0.018, keywords: ['fire protection','sprinkler','fire suppression'] },
  { name: 'Plumbing', division: '22', pct: 0.05, keywords: ['plumbing','sanitary','domestic water','fixtures'] },
  { name: 'HVAC', division: '23', pct: 0.075, keywords: ['hvac','mechanical','air handling','ductwork','vrf','rtu'] },
  { name: 'Electrical', division: '26', pct: 0.075, keywords: ['electrical','power distribution','lighting','switchgear','generator'] },
  { name: 'Low Voltage', division: '27', pct: 0.016, keywords: ['low voltage','data cabling','telecom','communications','access control'] },
  { name: 'Fire Alarm', division: '28', pct: 0.012, keywords: ['fire alarm','detection','alarm system'] },
  { name: 'Sitework', division: '31', pct: 0.045, keywords: ['sitework','earthwork','excavation','grading','utilities'] },
  { name: 'Paving', division: '32', pct: 0.025, keywords: ['paving','asphalt','concrete paving','parking lot'] },
  { name: 'Landscaping', division: '32', pct: 0.012, keywords: ['landscaping','irrigation','planting'] }
];

const STATE_NAMES = {
  alabama:'AL',alaska:'AK',arizona:'AZ',arkansas:'AR',california:'CA',colorado:'CO',connecticut:'CT',delaware:'DE',florida:'FL',georgia:'GA',hawaii:'HI',idaho:'ID',illinois:'IL',indiana:'IN',iowa:'IA',kansas:'KS',kentucky:'KY',louisiana:'LA',maine:'ME',maryland:'MD',massachusetts:'MA',michigan:'MI',minnesota:'MN',mississippi:'MS',missouri:'MO',montana:'MT',nebraska:'NE',nevada:'NV','new hampshire':'NH','new jersey':'NJ','new mexico':'NM','new york':'NY','north carolina':'NC','north dakota':'ND',ohio:'OH',oklahoma:'OK',oregon:'OR',pennsylvania:'PA','rhode island':'RI','south carolina':'SC','south dakota':'SD',tennessee:'TN',texas:'TX',utah:'UT',vermont:'VT',virginia:'VA',washington:'WA','west virginia':'WV',wisconsin:'WI',wyoming:'WY'
};

await mkdir(DATA_DIR, { recursive: true });
await mkdir(UPLOAD_DIR, { recursive: true });
let integrationHealth={supabase:INTEGRATIONS.supabase.configured?'ready':'disabled',supabaseError:'',email:INTEGRATIONS.resend.configured?'ready':'disabled',billing:INTEGRATIONS.stripe.configured?'ready':'disabled'};
let db = await loadDatabase();
if(INTEGRATIONS.supabase.configured){
  try{const cloud=await loadCloudState(INTEGRATIONS.supabase);if(cloud){db=ensureV5(cloud);await writeFile(DB_FILE,JSON.stringify(db,null,2));integrationHealth.supabase='live';}else{const h=await supabaseHealth(INTEGRATIONS.supabase);integrationHealth.supabase=h.ok?'ready':'error';integrationHealth.supabaseError=h.error||'';}}catch(error){integrationHealth.supabase='error';integrationHealth.supabaseError=error.message;}
}

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function loadDatabase() {
  if (!existsSync(DB_FILE)) return resetDatabase(false);
  try {
    let parsed = JSON.parse(await readFile(DB_FILE, 'utf8'));
    if (parsed.version === 1 || parsed.version === 2) parsed = await migrateToV3(parsed);
    if (parsed.version === 3 || parsed.version === 4 || parsed.version === 5) return ensureV5(parsed);
    return resetDatabase(false);
  } catch {
    return resetDatabase(false);
  }
}

async function migrateToV3(old) {
  const fresh = seedDatabase();
  fresh.projects = (old.projects || []).map(p => ({ ...p, state: p.state || inferState(p.location), analysis: p.analysis || null }));
  const seededByName = new Map(fresh.contractors.map(c => [c.name, c]));
  const seededContractors = fresh.contractors.slice();
  const migratedContractors = (old.contractors || []).map((c, i) => {
    const seed = seededByName.get(c.name) || seededContractors[i % seededContractors.length];
    return enrichContractor({ ...seed, ...c, minPackage: c.minPackage ?? c.minProject ?? seed.minPackage, maxPackage: c.maxPackage ?? c.maxProject ?? seed.maxPackage, licenseStates: c.licenseStates || c.serviceStates || seed.licenseStates, capabilities: c.capabilities || seed.capabilities, pastProjects: c.pastProjects || seed.pastProjects }, i, c.createdAt || new Date().toISOString());
  });
  const migratedNames = new Set(migratedContractors.map(c => c.name));
  fresh.contractors = [...migratedContractors, ...seededContractors.filter(c => !migratedNames.has(c.name))];
  fresh.scopes = (old.scopes || []).map(s => ({ ...s, requirements: s.requirements || [], keywords: s.keywords || [], confidence: s.confidence ?? .65, estimatedPackage: s.estimatedPackage || 0, source: s.source || 'migrated' }));
  fresh.matches = (old.matches || []).map(m => ({ ...m, score: m.score ?? m.total ?? 0, risks: m.risks || [], recommendation: m.recommendation || recommendationLabel(m.score ?? m.total ?? 0) }));
  fresh.invitations = old.invitations || [];
  fresh.bids = (old.bids || []).map(b => ({ ...b, manualAdjustment: Number(b.manualAdjustment || 0), manualAdjustmentReason: b.manualAdjustmentReason || '' }));
  fresh.qa = old.qa || [];
  fresh.events = old.events || [];
  fresh.documents = old.documents || [];
  if (old.version === 1) {
    for (const project of fresh.projects) {
      if (project.fileData && project.fileName) {
        try {
          const id = randomUUID(), ext = extname(project.fileName).slice(0, 10), diskName = `${id}${ext}`, buffer = Buffer.from(project.fileData, 'base64');
          await writeFile(join(UPLOAD_DIR, diskName), buffer);
          fresh.documents.push({ id, projectId: project.id, name: project.fileName, mime: project.fileMime || 'application/octet-stream', size: buffer.length, diskName, createdAt: project.createdAt || new Date().toISOString() });
        } catch {}
      }
      delete project.fileData; delete project.fileName; delete project.fileMime;
    }
  }
  ensureV5(fresh);
  await writeFile(DB_FILE, JSON.stringify(fresh, null, 2));
  return fresh;
}

async function resetDatabase(deleteUploads = true) {
  if (deleteUploads) {
    await rm(UPLOAD_DIR, { recursive: true, force: true });
    await mkdir(UPLOAD_DIR, { recursive: true });
  }
  const seeded = seedDatabase();
  await writeFile(DB_FILE, JSON.stringify(seeded, null, 2));
  return seeded;
}

function seedDatabase() {
  const now = new Date().toISOString();
  const rows = [
    ['Midwest Spark Electric',['Electrical','Fire Alarm'],['MO','KS'],['Multifamily','Commercial'],150000,3500000,.86,'Kansas City',38,5500000,3000000,['MO','KS'],['LEED coordination','Design-assist']],
    ['Heartland Mechanical',['HVAC'],['MO','KS','NE'],['Multifamily','Commercial','Healthcare'],250000,5000000,.78,'Kansas City',54,7000000,4000000,['MO','KS','NE'],['BIM coordination','Commissioning support']],
    ['River City Plumbing',['Plumbing'],['MO','KS'],['Multifamily','Commercial'],120000,3000000,.83,'Independence',31,4000000,2500000,['MO','KS'],['Medical gas coordination']],
    ['Summit Concrete Group',['Concrete'],['MO','KS','IA'],['Multifamily','Commercial','Industrial'],200000,6000000,.74,'Columbia',72,8000000,5000000,['MO','KS','IA'],['Post-tension slabs','Tilt-up']],
    ['Prairie Steel Erectors',['Structural Steel'],['MO','KS','NE','IA'],['Commercial','Industrial','Multifamily'],300000,7000000,.69,'Kansas City',61,9000000,6000000,['MO','KS','NE','IA'],['AISC certified']],
    ['KC Interior Systems',['Drywall'],['MO','KS'],['Multifamily','Commercial'],90000,2400000,.91,'Kansas City',44,3500000,1800000,['MO','KS'],['Acoustical ceilings','Cold-formed framing']],
    ['Blue Ridge Coatings',['Painting'],['MO','KS'],['Multifamily','Commercial'],50000,1400000,.80,'Columbia',27,2500000,1200000,['MO','KS'],['High-performance coatings']],
    ['Gateway Flooring Works',['Flooring'],['MO','IL','KS'],['Multifamily','Commercial','Hospitality'],70000,2000000,.76,'St. Louis',35,3000000,1500000,['MO','KS','IL'],['Moisture mitigation','Carpet tile']],
    ['Plains Roofing Systems',['Roofing','Waterproofing'],['MO','KS','NE'],['Commercial','Multifamily','Industrial'],100000,2600000,.88,'Kansas City',42,4500000,2200000,['MO','KS','NE'],['TPO','EPDM','Fluid-applied waterproofing']],
    ['Metro Fire Systems',['Fire Protection'],['MO','KS'],['Multifamily','Commercial','Healthcare'],80000,1800000,.84,'Kansas City',29,3000000,1800000,['MO','KS'],['NFPA coordination']],
    ['SignalWorks Low Voltage',['Low Voltage','Fire Alarm'],['MO','KS'],['Multifamily','Commercial'],40000,1300000,.90,'Overland Park',26,2500000,1200000,['MO','KS'],['Structured cabling','Access control']],
    ['Ozark Site & Civil',['Sitework','Paving'],['MO','AR','KS'],['Commercial','Multifamily','Industrial'],200000,4500000,.71,'Springfield',63,6500000,4000000,['MO','AR','KS'],['Utility installation','Mass grading']],
    ['Greenline Landscape',['Landscaping'],['MO','KS'],['Multifamily','Commercial'],30000,900000,.73,'Columbia',18,1500000,700000,['MO','KS'],['Irrigation','Native planting']],
    ['Crossroads Masonry',['Masonry'],['MO','KS','IA'],['Commercial','Multifamily'],80000,2100000,.77,'Kansas City',36,3000000,1600000,['MO','KS','IA'],['Architectural masonry']],
    ['Central Millwork & Carpentry',['Carpentry'],['MO','KS'],['Multifamily','Commercial','Hospitality'],75000,1700000,.82,'Columbia',32,2500000,1300000,['MO','KS'],['Casework','Finish carpentry']],
    ['Access Door & Hardware',['Doors & Hardware'],['MO','KS'],['Commercial','Multifamily','Healthcare'],60000,1500000,.79,'Kansas City',24,2300000,1000000,['MO','KS'],['Division 08 coordination']],
    ['Capital Electric Partners',['Electrical','Low Voltage'],['MO','KS','IA','NE'],['Commercial','Healthcare','Industrial'],400000,8500000,.67,'Kansas City',96,12000000,7500000,['MO','KS','IA','NE'],['Medium voltage','Generator systems','BIM coordination']],
    ['Northstar MEP',['HVAC','Plumbing'],['MO','KS','IL'],['Multifamily','Commercial','Healthcare'],400000,7500000,.72,'St. Louis',104,10000000,7000000,['MO','KS','IL'],['Design-build','BIM coordination']],
    ['Foundation One',['Concrete'],['MO','KS'],['Multifamily','Commercial'],80000,2600000,.87,'Kansas City',34,3800000,2000000,['MO','KS'],['Foundations','Slabs-on-grade']],
    ['Interior Finish Alliance',['Drywall','Painting','Flooring'],['MO','KS'],['Multifamily','Commercial'],120000,3800000,.75,'Kansas City',68,5500000,3200000,['MO','KS'],['Turnkey interiors','Schedule acceleration']]
  ];
  const base = rows.map((x,i)=>enrichContractor({
    id:`ctr-${i+1}`, name:x[0], trades:x[1], serviceStates:x[2], markets:x[3], minPackage:x[4], maxPackage:x[5], responseRate:x[6], city:x[7], employees:x[8], insuranceLimit:x[9], bondCapacity:x[10], licenseStates:x[11], capabilities:x[12],
    qualified:true, email:`estimating@${slug(x[0])}.example`, yearsInBusiness:8+(i%22),
    description:`${x[0]} is a fictional demo subcontractor specializing in ${x[1].join(', ')} across ${x[2].join(', ')}.`,
    pastProjects:[
      { name:`${x[3][0]} Project ${String.fromCharCode(65+(i%6))}`, type:x[3][0], value:Math.round(x[5]*.75) },
      { name:`Regional ${x[1][0]} Package`, type:x[3][Math.min(1,x[3].length-1)], value:Math.round(x[5]*.55) }
    ], createdAt:now
  }, i, now));

  const cityProfiles = [
    {city:'Kansas City',state:'MO',service:['MO','KS'],markets:['Multifamily','Commercial']},
    {city:'Overland Park',state:'KS',service:['KS','MO'],markets:['Commercial','Multifamily','Healthcare']},
    {city:'Columbia',state:'MO',service:['MO','KS'],markets:['Multifamily','Commercial']},
    {city:'St. Louis',state:'MO',service:['MO','IL'],markets:['Commercial','Multifamily','Healthcare']},
    {city:'Springfield',state:'MO',service:['MO','AR','KS'],markets:['Commercial','Industrial','Multifamily']},
    {city:'Omaha',state:'NE',service:['NE','IA','KS'],markets:['Commercial','Industrial','Multifamily']},
    {city:'Des Moines',state:'IA',service:['IA','NE','MO'],markets:['Commercial','Multifamily']},
    {city:'Wichita',state:'KS',service:['KS','OK','MO'],markets:['Industrial','Commercial','Multifamily']},
    {city:'Topeka',state:'KS',service:['KS','MO','NE'],markets:['Commercial','Multifamily']},
    {city:'Joplin',state:'MO',service:['MO','KS','OK','AR'],markets:['Commercial','Industrial']}
  ];
  const prefixes=['Atlas','Cedar','Crown','Frontier','Granite','Heritage','Ironwood','Lakeside','Meridian','Pioneer','Redwood','Union'];
  const suffixByTrade={
    Concrete:'Concrete',Masonry:'Masonry','Structural Steel':'Steelworks',Carpentry:'Carpentry',Waterproofing:'Envelope',Roofing:'Roofing','Doors & Hardware':'Openings',Drywall:'Interiors',Painting:'Coatings',Flooring:'Flooring','Fire Protection':'Fire Protection',Plumbing:'Plumbing',HVAC:'Mechanical',Electrical:'Electric','Low Voltage':'Technology','Fire Alarm':'Life Safety',Sitework:'Civil',Paving:'Paving',Landscaping:'Landscape'
  };
  const extra=[];
  let index=base.length;
  TRADE_CATALOG.forEach((trade,tidx)=>{
    for(let n=0;n<2;n++){
      const cp=cityProfiles[(tidx*2+n)%cityProfiles.length];
      const max=450000 + ((tidx*690000+n*430000)%6200000);
      const min=Math.max(25000,Math.round(max*(.08+(n*.025))/5000)*5000);
      const name=`${prefixes[(tidx+n*3)%prefixes.length]} ${suffixByTrade[trade.name]||trade.name}`;
      const adjacent=trade.name==='Electrical'?['Low Voltage','Fire Alarm']:trade.name==='HVAC'?['Plumbing']:trade.name==='Roofing'?['Waterproofing']:trade.name==='Drywall'?['Painting']:trade.name==='Sitework'?['Paving']:[];
      const markets=[...new Set([...cp.markets,(tidx%4===0?'Healthcare':tidx%4===1?'Industrial':'Commercial')])];
      const c={
        id:`ctr-${index+1}`,name,trades:[trade.name,...adjacent].slice(0,2),serviceStates:cp.service,markets,minPackage:min,maxPackage:max,responseRate:.66+(((tidx+n*2)%9)*.035),city:cp.city,homeState:cp.state,employees:16+((tidx*11+n*17)%105),insuranceLimit:2000000+((tidx+n)%4)*2000000,bondCapacity:Math.round(max*(1.25+((tidx+n)%4)*.35)/100000)*100000,licenseStates:cp.service.slice(0,2),capabilities:[`${trade.name} estimating`,tidx%2?'BIM coordination':'Schedule coordination'],qualified:true,email:`estimating@${slug(name)}.example`,yearsInBusiness:5+((tidx*3+n*5)%31),description:`${name} is a fictional regional ${trade.name.toLowerCase()} subcontractor used for BidMatch matching and prequalification testing.`,
        pastProjects:[{name:`${markets[0]} ${trade.name} Package`,type:markets[0],value:Math.round(max*.62)},{name:`Regional ${trade.name} Upgrade`,type:markets[1]||markets[0],value:Math.round(max*.43)}],createdAt:now
      };
      extra.push(enrichContractor(c,index,now)); index++;
    }
  });
  return { version:6, settings:defaultSettings(), orgSettings:{}, billing:{}, jobs:[], projects:[], documents:[], contractors:[...base,...extra], scopes:[], matches:[], invitations:[], bids:[], qa:[], events:[] };
}

function enrichContractor(c,i,now){
  const max=Math.max(100000,Number(c.maxPackage||1000000));
  const annual=Math.round(max*(2.8+((i%7)*.42))/100000)*100000;
  const backlog=Math.round(annual*(.22+((i%6)*.075))/100000)*100000;
  const emr=Number((.72+((i%9)*.045)).toFixed(2));
  const trir=Number((.7+((i%8)*.31)).toFixed(1));
  const dart=Number((.3+((i%7)*.19)).toFixed(1));
  const quality=78+((i*7)%19);
  const onTime=82+((i*5)%15);
  const prequal=(emr>1.03||quality<82)?'Conditional':'Approved';
  const homeState=c.homeState||({Kansas:'KS',Missouri:'MO',Nebraska:'NE',Iowa:'IA',Illinois:'IL'}[c.city]||c.serviceStates?.[0]||'MO');
  return {
    ...c, homeState, demoData:true, prequalStatus:c.prequalStatus||prequal,
    safety:{emr:c.safety?.emr??emr,trir:c.safety?.trir??trir,dart:c.safety?.dart??dart,incidents3yr:c.safety?.incidents3yr??(i%4)},
    avgAnnualVolume:c.avgAnnualVolume||annual,currentBacklog:c.currentBacklog||backlog,
    backlogUtilization:c.backlogUtilization??Number((backlog/annual).toFixed(2)),
    onTimeRate:c.onTimeRate??onTime/100,qualityScore:c.qualityScore??quality,
    relationshipScore:c.relationshipScore??Number(((i%6)/5).toFixed(2)),
    avgResponseHours:c.avgResponseHours||8+((i*13)%66),
    invitedLast12Months:c.invitedLast12Months??(3+(i%15)),bidsLast12Months:c.bidsLast12Months??(2+(i%10)),awardsLast12Months:c.awardsLast12Months??(i%5),
    insuranceExpiry:c.insuranceExpiry||futureDate(65+((i*19)%280)),bondingStatus:c.bondingStatus||((i%8===0)?'Review':'Verified demo'),
    certifications:c.certifications||[(i%5===0?'OSHA 30 program':'Safety orientation'),...(i%6===0?['Minority / supplier credential demo']:[])],
    lastVerified:c.lastVerified||now
  };
}
function futureDate(days){const d=new Date();d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function recommendationLabel(score){return score>=86?'Strong fit':score>=77?'Recommended':score>=68?'Consider':'Watch';}

async function persist(){ await writeFile(DB_FILE, JSON.stringify(db, null, 2)); if(INTEGRATIONS.supabase.configured){const result=await saveCloudState(INTEGRATIONS.supabase,db).catch(error=>({ok:false,error:error.message}));integrationHealth.supabase=result.ok?'live':'error';integrationHealth.supabaseError=result.ok?'':result.error||'';} }
function clamp(n,min,max){ return Math.max(min,Math.min(max,Number(n)||0)); }
function slug(v){ return String(v).toLowerCase().replace(/[^a-z0-9]+/g,'').slice(0,32); }
function titleCase(v){ return String(v||'').replace(/\b\w/g,c=>c.toUpperCase()); }
function money(v){ return Number(v||0); }
function json(res,status,body){ const data=JSON.stringify(body); writeHeaders(res,status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(data),'Cache-Control':'no-store'}); res.end(data); }
function text(res,status,body,contentType='text/plain; charset=utf-8'){ writeHeaders(res,status,{'Content-Type':contentType,'Content-Length':Buffer.byteLength(body)}); res.end(body); }

async function readJson(req){
  const chunks=[]; let size=0;
  for await (const chunk of req){ size+=chunk.length; if(size>MAX_BODY_BYTES) throw new Error('Request is too large.'); chunks.push(chunk); }
  if(!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function routeMatch(pathname,pattern){
  const p=pathname.split('/').filter(Boolean), t=pattern.split('/').filter(Boolean); if(p.length!==t.length) return null;
  const params={};
  for(let i=0;i<t.length;i++){ if(t[i].startsWith(':')) params[t[i].slice(1)]=decodeURIComponent(p[i]); else if(t[i]!==p[i]) return null; }
  return params;
}

function inferState(location=''){
  const raw=String(location).trim(); const code=raw.match(/(?:,|\s)\s*([A-Z]{2})(?:\s|$)/); if(code) return code[1];
  const lower=raw.toLowerCase(); for(const [name,abbr] of Object.entries(STATE_NAMES)) if(lower.includes(name)) return abbr; return '';
}

function normalizeProjectType(value=''){
  const v=String(value).toLowerCase();
  if(v.includes('multi')||v.includes('apartment')||v.includes('residential')) return 'Multifamily';
  if(v.includes('health')||v.includes('hospital')||v.includes('medical')) return 'Healthcare';
  if(v.includes('industrial')||v.includes('warehouse')||v.includes('manufact')) return 'Industrial';
  if(v.includes('hotel')||v.includes('hospitality')) return 'Hospitality';
  return value?titleCase(value):'Commercial';
}

function addEvent(type,projectId,message,meta={}){
  db.events.unshift({id:randomUUID(),type,projectId,message,meta,createdAt:new Date().toISOString()});
  db.events=db.events.slice(0,800);
}

function tradeMeta(name){ return TRADE_CATALOG.find(t=>t.name.toLowerCase()===String(name).toLowerCase()) || {name,division:'—',pct:.025,keywords:[String(name).toLowerCase()]}; }
function estimatePackage(project,trade){
  const total=money(project.analysis?.estimatedValue||project.estimatedValue); if(!total) return 0;
  const pct=tradeMeta(trade).pct; return Math.round(total*pct/1000)*1000;
}

async function readDocumentBuffer(doc){
  if(doc.storageProvider==='supabase'&&doc.storagePath) return downloadSupabaseObject(INTEGRATIONS.supabase,doc.storagePath);
  return readFile(join(UPLOAD_DIR,doc.diskName));
}

async function storeDocuments(projectId,files=[]){
  const current=db.documents.filter(d=>d.projectId===projectId).length;
  if(current+files.length>MAX_PROJECT_FILES) throw new Error(`A project can have up to ${MAX_PROJECT_FILES} files.`);
  const created=[]; const project=db.projects.find(p=>p.id===projectId);
  for(const file of files){
    if(!file?.name||!file?.data) continue;
    const buffer=Buffer.from(file.data,'base64');
    if(buffer.length>MAX_FILE_BYTES) throw new Error(`${file.name} is larger than 12 MB.`);
    const id=randomUUID(); const safeExt=extname(file.name).slice(0,10); const diskName=`${id}${safeExt}`; const mime=file.mime||'application/octet-stream';
    let storageProvider='local', storagePath='';
    if(INTEGRATIONS.supabase.configured){
      const cloudPath=`${project?.orgId||'unclaimed'}/${projectId}/${id}-${String(file.name).replace(/[^a-zA-Z0-9._-]+/g,'-').slice(-100)}`;
      const upload=await uploadSupabaseObject(INTEGRATIONS.supabase,{path:cloudPath,buffer,mime}).catch(error=>({ok:false,error:error.message}));
      if(upload.ok){storageProvider='supabase';storagePath=cloudPath;integrationHealth.supabase='live';}
      else{integrationHealth.supabase='error';integrationHealth.supabaseError=upload.error||'Storage upload failed.';await writeFile(join(UPLOAD_DIR,diskName),buffer);}
    }else await writeFile(join(UPLOAD_DIR,diskName),buffer);
    const doc={id,projectId,name:file.name,mime,size:buffer.length,diskName:storageProvider==='local'?diskName:'',storageProvider,storagePath,createdAt:new Date().toISOString()};
    db.documents.push(doc); created.push(doc);
  }
  return created;
}

async function documentText(projectId){
  const docs=db.documents.filter(d=>d.projectId===projectId); const parts=[];
  for(const d of docs){
    if(d.mime.startsWith('text/')||['.txt','.md','.csv'].includes(extname(d.name).toLowerCase())){
      try{ parts.push(`--- ${d.name} ---\n${(await readDocumentBuffer(d)).toString('utf8').slice(0,100000)}`); }catch{}
    }
  }
  return parts.join('\n\n');
}

function heuristicAnalyze(project,extraText=''){
  const corpus=`${project.name} ${project.description||''} ${project.projectType||''} ${extraText}`.toLowerCase();
  const found=TRADE_CATALOG.filter(t=>t.keywords.some(k=>corpus.includes(k)));
  const defaults=['Concrete','Roofing','Drywall','Flooring','Plumbing','HVAC','Electrical'];
  const chosen=found.length?found:TRADE_CATALOG.filter(t=>defaults.includes(t.name));
  const genericRequirements={
    Concrete:['Foundations/slabs as indicated','Coordinate embeds and penetrations'], Roofing:['Roofing system and flashings as indicated'], Drywall:['Gypsum assemblies and framing as indicated'], Flooring:['Floor finishes and transitions as indicated'], Plumbing:['Plumbing systems and fixtures as indicated'], HVAC:['Mechanical equipment, ductwork and controls as indicated'], Electrical:['Power distribution and lighting as indicated'], 'Fire Protection':['Sprinkler/fire protection scope as indicated'], 'Low Voltage':['Communications/low-voltage scope as indicated']
  };
  return {
    projectType:normalizeProjectType(project.projectType||project.description),
    summary:project.description||`${project.name} construction project in ${project.location}.`,
    estimatedValue:money(project.estimatedValue), bidDue:project.bidDue||'',
    facts:[],
    scopes:chosen.map(t=>({trade:t.name,division:t.division,summary:`${t.name} package identified from project intake.`,requirements:genericRequirements[t.name]||[`${t.name} work as indicated`],keywords:t.keywords.slice(0,4),confidence:found.includes(t)?0.82:0.55})),
    warnings:[OPENAI_API_KEY?'Local fallback used for this run.':'AI key is not configured; local extraction was used. PDF contents require live AI in this prototype.']
  };
}

const projectSchema={
  type:'object',properties:{
    projectType:{type:'string'},summary:{type:'string'},estimatedValue:{type:'number'},bidDue:{type:'string'},
    facts:{type:'array',items:{type:'string'}},
    scopes:{type:'array',items:{type:'object',properties:{trade:{type:'string'},division:{type:'string'},summary:{type:'string'},requirements:{type:'array',items:{type:'string'}},keywords:{type:'array',items:{type:'string'}},confidence:{type:'number'}},required:['trade','division','summary','requirements','keywords','confidence'],additionalProperties:false}},
    warnings:{type:'array',items:{type:'string'}}
  },required:['projectType','summary','estimatedValue','bidDue','facts','scopes','warnings'],additionalProperties:false
};

async function openAIDocumentItems(projectId){
  const docs=db.documents.filter(d=>d.projectId===projectId).slice(0,4); const items=[];
  for(const d of docs){
    try{
      const b=await readDocumentBuffer(d);
      items.push({type:'input_file',filename:d.name,file_data:`data:${d.mime};base64,${b.toString('base64')}`});
    }catch{}
  }
  return items;
}

async function analyzeProject(project){
  const localText=await documentText(project.id);
  if(!OPENAI_API_KEY){aiHealth={...aiHealth,status:'disabled'};return heuristicAnalyze(project,localText);}
  try{
    const content=[{type:'input_text',text:`Analyze this construction project for preconstruction bidding. Extract only facts and scopes supported by the user-entered intake or attached documents. Requirements should describe actual trade scope, not claim licenses/insurance are verified. Project name: ${project.name}. Location: ${project.location}. User type: ${project.projectType||''}. Estimated value: ${project.estimatedValue||0}. Bid due: ${project.bidDue||''}. Description: ${project.description||''}.`}];
    content.push(...await openAIDocumentItems(project.id));
    const body={model:OPENAI_MODEL,instructions:'You are a construction preconstruction extraction engine. Use CSI divisions when clear. Do not invent specifications. Return only the supplied JSON schema.',input:[{role:'user',content}],text:{format:{type:'json_schema',name:'project_analysis',strict:true,schema:projectSchema}}};
    const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!r.ok) throw new Error(`OpenAI returned ${r.status}: ${(await r.text()).slice(0,280)}`);
    const parsed=JSON.parse(extractOutputText(await r.json())); aiHealth={...aiHealth,status:'live',lastSuccess:new Date().toISOString(),lastError:''}; return parsed;
  }catch(err){
    aiHealth={...aiHealth,status:String(err.message).includes('429')?'billing-issue':'error',lastFailure:new Date().toISOString(),lastError:err.message}; const fallback=heuristicAnalyze(project,localText); fallback.warnings.push(`Live AI failed; fallback used: ${err.message}`); return fallback;
  }
}

function extractOutputText(result){
  if(typeof result.output_text==='string'&&result.output_text) return result.output_text;
  for(const item of result.output||[]) for(const part of item.content||[]) if(part.type==='output_text'&&typeof part.text==='string') return part.text;
  throw new Error('No model output text returned.');
}

async function embeddingSimilarity(query,contractors){
  if(!OPENAI_API_KEY||!contractors.length) return new Map();
  try{
    const inputs=[query,...contractors.map(c=>`${c.name}. Trades ${c.trades.join(', ')}. Markets ${c.markets.join(', ')}. Capabilities ${c.capabilities.join(', ')}. ${c.description}`)];
    const r=await fetch('https://api.openai.com/v1/embeddings',{method:'POST',headers:{Authorization:`Bearer ${OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:OPENAI_EMBEDDING_MODEL,input:inputs,encoding_format:'float'})});
    if(!r.ok) return new Map(); const result=await r.json(); const vectors=result.data.map(x=>x.embedding), q=vectors[0], map=new Map();
    for(let i=1;i<vectors.length;i++) map.set(contractors[i-1].id,cosine(q,vectors[i])); return map;
  }catch{return new Map();}
}
function cosine(a,b){let dot=0,aa=0,bb=0;for(let i=0;i<Math.min(a.length,b.length);i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}return aa&&bb?dot/(Math.sqrt(aa)*Math.sqrt(bb)):0;}

function qualificationFor(scope){
  const est=Number(scope.estimatedPackage||0);
  const q=scope.qualification||{};
  return {
    requiresLicense:q.requiresLicense??true,
    insuranceRequirement:Number(q.insuranceRequirement??settingsForOrg(db.projects.find(p=>p.id===scope.projectId)?.orgId).defaultInsuranceRequirement??2000000),
    bondRequired:q.bondRequired??(est>=Number(settingsForOrg(db.projects.find(p=>p.id===scope.projectId)?.orgId).defaultBondingThreshold||500000)),
    hardCapacityMultiplier:Number(q.hardCapacityMultiplier??settingsForOrg(db.projects.find(p=>p.id===scope.projectId)?.orgId).hardCapacityMultiplier??1.25)
  };
}

function evaluateQualification(project,scope,contractor){
  const failures=[],warnings=[],passes=[];
  const state=project.state||inferState(project.location), est=Number(scope.estimatedPackage||estimatePackage(project,scope.trade)||0), q=qualificationFor(scope);
  if(!contractor.trades.some(t=>t.toLowerCase()===scope.trade.toLowerCase())) failures.push('Trade mismatch.'); else passes.push('Trade');
  if(contractor.prequalStatus==='Blocked') failures.push('Prequalification record is blocked.');
  else if(contractor.prequalStatus==='Conditional') warnings.push('Contractor prequalification is conditional.'); else passes.push('Prequalification');
  if(state&&!contractor.serviceStates.includes(state)) failures.push(`Outside listed service states for ${state}.`); else if(state) passes.push('Service area');
  if(q.requiresLicense&&state&&!contractor.licenseStates.includes(state)) failures.push(`Required ${state} license is not listed.`); else if(q.requiresLicense&&state) passes.push('License');
  if(Number(contractor.insuranceLimit||0)<q.insuranceRequirement) failures.push(`Insurance limit ${formatMoney(contractor.insuranceLimit)} is below required ${formatMoney(q.insuranceRequirement)}.`); else passes.push('Insurance');
  if(q.bondRequired&&est&&Number(contractor.bondCapacity||0)<est) failures.push(`Bond capacity ${formatMoney(contractor.bondCapacity)} is below the ${formatMoney(est)} package.`); else if(q.bondRequired) passes.push('Bond capacity');
  if(est&&contractor.maxPackage&&est>Number(contractor.maxPackage)*q.hardCapacityMultiplier) failures.push(`Package exceeds hard capacity limit (${q.hardCapacityMultiplier.toFixed(2)}× preferred maximum).`);
  else if(est&&contractor.maxPackage&&est>Number(contractor.maxPackage)) warnings.push('Package exceeds preferred package maximum.'); else if(est) passes.push('Package capacity');
  const util=Number(contractor.backlogUtilization??0); if(util>.85) warnings.push(`Backlog utilization is ${Math.round(util*100)}%.`);
  if(contractor.bondingStatus&&String(contractor.bondingStatus).toLowerCase().includes('review')&&q.bondRequired) warnings.push('Bonding status requires review.');
  const expiry=contractor.insuranceExpiry?new Date(contractor.insuranceExpiry):null; if(expiry&&!Number.isNaN(expiry.getTime())){const days=(expiry-Date.now())/86400000;if(days<0)failures.push('Insurance record is expired.');else if(days<45)warnings.push('Insurance record expires within 45 days.');}
  const status=failures.length?'ineligible':warnings.length?'conditional':'eligible';
  return {status,failures,warnings,passes,requirements:q};
}

function scoreContractor(project,scope,contractor,semantic=null){
  const reasons=[],risks=[],components={trade:0,geography:0,market:0,capacity:0,experience:0,response:0,safety:0,quality:0,compliance:0,workload:0,relationship:0,semantic:0};
  const qualification=evaluateQualification(project,scope,contractor);
  components.trade=20;
  const state=project.state||inferState(project.location); components.geography=state&&contractor.serviceStates.includes(state)?12:0;
  const type=normalizeProjectType(project.analysis?.projectType||project.projectType);
  components.market=contractor.markets.some(m=>m.toLowerCase()===type.toLowerCase())?8:3;
  if(components.market===8) reasons.push(`${type} project history.`); else risks.push(`Limited ${type.toLowerCase()} history in demo record.`);
  const packageEstimate=scope.estimatedPackage||estimatePackage(project,scope.trade);
  if(!packageEstimate) components.capacity=7;
  else if(packageEstimate>=contractor.minPackage*.75&&packageEstimate<=contractor.maxPackage){components.capacity=13;reasons.push('Package is inside preferred demo size range.');}
  else if(packageEstimate>=contractor.minPackage*.5&&packageEstimate<=contractor.maxPackage*1.2){components.capacity=9;risks.push('Package is near the edge of listed package capacity.');}
  else if(packageEstimate<=contractor.maxPackage*1.5){components.capacity=4;risks.push('Package exceeds preferred demo package capacity.');}
  else {components.capacity=1;risks.push('Package materially exceeds demo package capacity.');}
  const relevant=(contractor.pastProjects||[]).filter(p=>p.type===type).length; components.experience=Math.min(7,3+relevant*2);
  if(relevant) reasons.push(`${relevant} relevant example project${relevant===1?'':'s'} in profile.`);
  components.response=Math.round(clamp(contractor.responseRate,0,1)*6);
  const emr=Number(contractor.safety?.emr||1),trir=Number(contractor.safety?.trir||3); components.safety=emr<=.9?8:emr<=1?7:emr<=1.1?5:2;
  if(emr>1) risks.push(`Demo EMR is ${emr.toFixed(2)}.`); else reasons.push(`Demo EMR ${emr.toFixed(2)}.`); if(trir>3.2) risks.push(`TRIR ${trir.toFixed(1)} warrants review.`);
  components.quality=Math.round(clamp((Number(contractor.qualityScore||80)-70)/30,0,1)*6);
  components.compliance=qualification.status==='eligible'?10:qualification.status==='conditional'?7:2;
  const util=Number(contractor.backlogUtilization??.5); components.workload=util<=.45?5:util<=.65?4:util<=.8?2:0;
  if(util>.75) risks.push(`Backlog utilization is ${Math.round(util*100)}%.`); else reasons.push(`Backlog utilization ${Math.round(util*100)}%.`);
  components.relationship=Math.round(clamp(contractor.relationshipScore,0,1)*2); if(typeof semantic==='number') components.semantic=Math.round(clamp((semantic-.5)/.4,0,1)*3);
  risks.push(...qualification.warnings,...qualification.failures);
  const score=Math.round(clamp(Object.values(components).reduce((a,b)=>a+b,0),0,100));
  const recommendation=qualification.status==='ineligible'?'Ineligible':qualification.status==='conditional'?'Conditional':recommendationLabel(score);
  return {eligible:qualification.status!=='ineligible',qualificationStatus:qualification.status,qualification,score,components,reasons,risks,recommendation};
}

async function createInvitations(project,scopes,matches){
  const created=[];
  for(const scope of scopes){
    const ranked=matches.filter(m=>m.scopeId===scope.id&&m.qualificationStatus==='eligible').sort((a,b)=>b.score-a.score).slice(0,Number(settingsForOrg(project.orgId).topMatchesPerScope||TOP_MATCHES_PER_SCOPE));
    for(const match of ranked){
      if(db.invitations.some(i=>i.projectId===project.id&&i.scopeId===scope.id&&i.contractorId===match.contractorId)) continue;
      const c=db.contractors.find(x=>x.id===match.contractorId); const invitation={id:randomUUID(),projectId:project.id,scopeId:scope.id,contractorId:c.id,status:'queued',sentExternally:false,createdAt:new Date().toISOString(),message:`Invitation to bid: ${project.name} — ${scope.trade}. Bid due ${project.analysis?.bidDue||project.bidDue||'TBD'}.`};
      db.invitations.push(invitation); created.push(invitation);
      if(AUTO_SEND_INVITES&&(INTEGRATIONS.resend.configured||OUTREACH_WEBHOOK_URL)) await sendInvitationNow(invitation);
    }
  }
  return created;
}

async function scoreScopeMatches(project,scope){
  db.matches=db.matches.filter(m=>m.scopeId!==scope.id);
  const candidates=visibleContractors(project.orgId).filter(c=>c.trades.some(t=>t.toLowerCase()===scope.trade.toLowerCase()));
  const analysis=project.analysis||{};
  const sem=await embeddingSimilarity(`${project.name}. ${analysis.summary||project.description||''}. Scope ${scope.trade}. ${scope.summary}. ${(scope.requirements||[]).join('; ')}`,candidates);
  const rows=[];
  for(const c of candidates){const scored=scoreContractor(project,scope,c,sem.get(c.id));rows.push({id:randomUUID(),projectId:project.id,scopeId:scope.id,contractorId:c.id,...scored,createdAt:new Date().toISOString()});}
  db.matches.push(...rows); return rows;
}

async function runAutomation(project){
  addEvent('automation_started',project.id,'Project analysis and matching started.');
  const analysis=await analyzeProject(project); project.analysis=analysis; project.projectType=analysis.projectType||project.projectType; project.state=inferState(project.location); project.status='active'; project.workflowStage='scoping';
  const existingScopes=db.scopes.filter(x=>x.projectId===project.id);
  const existingByTrade=new Map(existingScopes.map(s=>[s.trade.toLowerCase(),s]));
  db.scopes=db.scopes.filter(x=>x.projectId!==project.id); db.matches=db.matches.filter(x=>x.projectId!==project.id);
  const generated=(analysis.scopes||[]).map(s=>{
    const trade=canonicalTrade(s.trade), prior=existingByTrade.get(trade.toLowerCase());
    const manuallyEdited=prior && String(prior.source||'').startsWith('manual');
    return {id:prior?.id||randomUUID(),projectId:project.id,trade,division:manuallyEdited?prior.division:(s.division||tradeMeta(s.trade).division),summary:manuallyEdited?prior.summary:(s.summary||''),requirements:manuallyEdited?prior.requirements:(s.requirements||[]),keywords:s.keywords||prior?.keywords||[],confidence:manuallyEdited?prior.confidence:clamp(s.confidence||.7,0,1),estimatedPackage:prior?.manualEstimate?prior.estimatedPackage:estimatePackage(project,s.trade),manualEstimate:prior?.manualEstimate||false,qualification:prior?.qualification||null,source:manuallyEdited?prior.source:'automation',createdAt:prior?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
  });
  const generatedTrades=new Set(generated.map(s=>s.trade.toLowerCase()));
  const manualExtras=existingScopes.filter(s=>String(s.source||'').startsWith('manual')&&!generatedTrades.has(s.trade.toLowerCase())).map(s=>({...s,updatedAt:new Date().toISOString()}));
  const scopes=[...generated,...manualExtras].map(scope=>withQualificationDefaults(scope,settingsForOrg(project.orgId)));
  db.scopes.push(...scopes);
  const all=[]; for(const scope of scopes) all.push(...await scoreScopeMatches(project,scope));
  const created=await createInvitations(project,scopes,all); if(created.length) project.workflowStage='bidding'; addEvent('automation_completed',project.id,`Extracted ${scopes.length} scopes, scored ${all.length} candidates, and queued ${created.length} new invitations.`);
  await persist(); return getProjectBundle(project.id);
}

async function updateScope(project,scope,body){
  const oldTrade=scope.trade;
  if(body.trade!==undefined){const trade=canonicalTrade(String(body.trade).trim());if(!trade)throw new Error('Trade is required.');scope.trade=trade;}
  if(body.division!==undefined)scope.division=String(body.division||tradeMeta(scope.trade).division).trim();
  if(body.summary!==undefined)scope.summary=String(body.summary||'').trim();
  if(body.requirements!==undefined)scope.requirements=Array.isArray(body.requirements)?body.requirements.map(String).map(x=>x.trim()).filter(Boolean):[];
  if(body.confidence!==undefined)scope.confidence=clamp(Number(body.confidence),0,1);
  if(body.estimatedPackage!==undefined){scope.estimatedPackage=Math.max(0,Number(body.estimatedPackage)||0);scope.manualEstimate=true;}
  scope.qualification={...qualificationFor(scope),...(body.qualification||{})}; scope.qualification.requiresLicense=Boolean(scope.qualification.requiresLicense); scope.qualification.bondRequired=Boolean(scope.qualification.bondRequired); scope.qualification.insuranceRequirement=Math.max(0,Number(scope.qualification.insuranceRequirement)||0); scope.qualification.hardCapacityMultiplier=Math.max(1,Number(scope.qualification.hardCapacityMultiplier)||1.25);
  scope.updatedAt=new Date().toISOString(); scope.source='manual-edit';
  if(oldTrade!==scope.trade){
    const bidCount=db.bids.filter(b=>b.scopeId===scope.id).length;
    if(!bidCount) db.invitations=db.invitations.filter(i=>i.scopeId!==scope.id);
  }
  await scoreScopeMatches(project,scope);
  addEvent('scope_updated',project.id,`${scope.trade} scope edited and contractor recommendations rescored.`);
}

function canonicalTrade(name=''){
  const lower=String(name).toLowerCase(); const exact=TRADE_CATALOG.find(t=>t.name.toLowerCase()===lower); if(exact) return exact.name;
  const fuzzy=TRADE_CATALOG.find(t=>t.keywords.some(k=>lower.includes(k)||k.includes(lower))); return fuzzy?.name||titleCase(name);
}

function getProjectBundle(projectId){
  const project=db.projects.find(p=>p.id===projectId); if(!project) return null;
  const docs=db.documents.filter(d=>d.projectId===projectId).map(({diskName,...d})=>d);
  const scopes=db.scopes.filter(s=>s.projectId===projectId);
  const matches=db.matches.filter(m=>m.projectId===projectId).map(m=>({...m,contractor:db.contractors.find(c=>c.id===m.contractorId)}));
  const invitations=db.invitations.filter(i=>i.projectId===projectId).map(i=>({...i,contractor:db.contractors.find(c=>c.id===i.contractorId),scope:scopes.find(s=>s.id===i.scopeId)}));
  const bids=db.bids.filter(b=>b.projectId===projectId).map(b=>({...b,contractor:db.contractors.find(c=>c.id===b.contractorId),scope:scopes.find(s=>s.id===b.scopeId)}));
  const qa=db.qa.filter(q=>q.projectId===projectId).slice(0,30); const events=db.events.filter(e=>e.projectId===projectId).slice(0,80);
  return {project,documents:docs,scopes,matches,invitations,bids,qa,events,leveling:levelBids(projectId),workflow:workflowSummary(projectId)};
}

function workflowSummary(projectId){
  const project=db.projects.find(p=>p.id===projectId),scopes=db.scopes.filter(s=>s.projectId===projectId),invitations=db.invitations.filter(i=>i.projectId===projectId),bids=db.bids.filter(b=>b.projectId===projectId);
  const scopesWithBid=new Set(bids.map(b=>b.scopeId)).size, responseCount=invitations.filter(i=>['accepted','declined','submitted'].includes(i.status)).length;
  const actions=[];
  if(!scopes.length) actions.push('Run project analysis or add bid packages.');
  else if(!invitations.length) actions.push('Review contractor recommendations and build bid lists.');
  else if(!bids.length) actions.push('Collect subcontractor responses and proposals.');
  else { if(scopesWithBid<scopes.length) actions.push(`${scopes.length-scopesWithBid} scope${scopes.length-scopesWithBid===1?'':'s'} still have no submitted bid.`); actions.push('Review leveling exceptions and resolve exclusions.'); }
  const conditional=db.matches.filter(m=>m.projectId===projectId&&m.qualificationStatus==='conditional').length, ineligible=db.matches.filter(m=>m.projectId===projectId&&m.qualificationStatus==='ineligible').length;
  if(conditional) actions.push(`${conditional} contractor match${conditional===1?'':'es'} require qualification review.`);
  return {stage:project?.workflowStage||'intake',stages:PROJECT_STAGES,scopeCount:scopes.length,invitationCount:invitations.length,bidCount:bids.length,responseRate:invitations.length?Math.round(responseCount/invitations.length*100):0,coverage:scopes.length?Math.round(scopesWithBid/scopes.length*100):0,conditionalCount:conditional,ineligibleCount:ineligible,nextActions:actions.slice(0,4)};
}

const bidSchema={type:'object',properties:{amount:{type:'number'},alternates:{type:'array',items:{type:'object',properties:{label:{type:'string'},amount:{type:'number'},kind:{type:'string',enum:['add','deduct','info']}},required:['label','amount','kind'],additionalProperties:false}},inclusions:{type:'array',items:{type:'string'}},exclusions:{type:'array',items:{type:'string'}},bondIncluded:{type:'string'},taxIncluded:{type:'string'},schedule:{type:'string'},notes:{type:'array',items:{type:'string'}}},required:['amount','alternates','inclusions','exclusions','bondIncluded','taxIncluded','schedule','notes'],additionalProperties:false};

async function parseBidProposal(value){
  const raw=String(value||'').trim(); if(!OPENAI_API_KEY) return heuristicBidParse(raw);
  try{
    const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:OPENAI_MODEL,instructions:'Extract a subcontractor bid proposal. Do not infer inclusions that are not stated. Unknown fields should be empty or unknown.',input:raw,text:{format:{type:'json_schema',name:'bid_parse',strict:true,schema:bidSchema}}})});
    if(!r.ok) throw new Error(`OpenAI ${r.status}`); return JSON.parse(extractOutputText(await r.json()));
  }catch{return heuristicBidParse(raw);}
}

function heuristicBidParse(raw=''){
  const amountMatch=raw.match(/(?:base\s*bid|bid|total|proposal)[^$\d]{0,20}\$?([\d,]+(?:\.\d{1,2})?)/i)||raw.match(/\$([\d,]+(?:\.\d{1,2})?)/);
  const amount=amountMatch?Number(amountMatch[1].replace(/,/g,'')):0;
  const section=(label)=>{const m=raw.match(new RegExp(`${label}\\s*:?\\s*([^\\n]+(?:\\n(?![A-Za-z ]+\\s*:)[^\\n]+)*)`,'i'));return m?m[1].split(/[,;\n•]+/).map(s=>s.trim()).filter(Boolean):[];};
  const alt=[]; for(const m of raw.matchAll(/(?:alternate|alt)\s*[^:$\n]*:?\s*([+-]?)\$?([\d,]+)/gi)) alt.push({label:m[0].slice(0,60),amount:Number(m[2].replace(/,/g,'')),kind:m[1]==='-'?'deduct':'add'});
  return {amount,alternates:alt,inclusions:section('inclusions?'),exclusions:section('exclusions?'),bondIncluded:/bond\s+(included|yes)/i.test(raw)?'yes':/bond\s+(excluded|no)/i.test(raw)?'no':'unknown',taxIncluded:/tax\s+(included|yes)/i.test(raw)?'yes':/tax\s+(excluded|no)/i.test(raw)?'no':'unknown',schedule:(raw.match(/(?:schedule|duration)\s*:?\s*([^\n]+)/i)||[])[1]||'',notes:[]};
}

function estimateExclusionAdjustment(scope,exclusion){
  const base=scope.estimatedPackage||0; const e=String(exclusion).toLowerCase(); let pct=.025;
  if(e.includes('fire alarm')) pct=.06; else if(e.includes('low voltage')||e.includes('data')) pct=.05; else if(e.includes('temporary power')) pct=.025; else if(e.includes('permit')) pct=.012; else if(e.includes('demo')) pct=.035; else if(e.includes('controls')) pct=.05;
  return Math.round(base*pct/1000)*1000;
}

function levelBids(projectId){
  const scopes=db.scopes.filter(s=>s.projectId===projectId), bids=db.bids.filter(b=>b.projectId===projectId), groups=[];
  for(const scope of scopes){
    const rows=bids.filter(b=>b.scopeId===scope.id).map(b=>{
      const adds=(b.parsed.alternates||[]).filter(a=>a.kind==='add').reduce((s,a)=>s+money(a.amount),0);
      const deducts=(b.parsed.alternates||[]).filter(a=>a.kind==='deduct').reduce((s,a)=>s+money(a.amount),0);
      const alternateNet=adds-deducts;
      const exclusionAdjustments=(b.parsed.exclusions||[]).map(label=>({label,amount:estimateExclusionAdjustment(scope,label)}));
      const exclusionTotal=exclusionAdjustments.reduce((s,x)=>s+x.amount,0);
      const manualAdjustment=money(b.manualAdjustment);
      const amount=money(b.parsed.amount), comparisonAmount=amount+alternateNet+exclusionTotal+manualAdjustment;
      const contractor=db.contractors.find(c=>c.id===b.contractorId);
      const issues=[];
      if(b.parsed.exclusions?.length)issues.push(`${b.parsed.exclusions.length} exclusion${b.parsed.exclusions.length===1?'':'s'}`);
      if(String(b.parsed.bondIncluded).toLowerCase()!=='yes')issues.push('bond unconfirmed');
      if(String(b.parsed.taxIncluded).toLowerCase()==='unknown')issues.push('tax unconfirmed');
      return {...b,contractorName:contractor?.name||'Unknown',contractor,amount,alternateNet,exclusionTotal,comparisonAmount,adjustment:alternateNet+exclusionTotal+manualAdjustment,manualAdjustment,manualAdjustmentReason:b.manualAdjustmentReason||'',exclusionAdjustments,issues};
    }).sort((a,b)=>a.comparisonAmount-b.comparisonAmount);
    if(rows.length){
      const low=rows[0],baseLow=[...rows].sort((a,b)=>a.amount-b.amount)[0],high=rows.at(-1);
      const avg=rows.reduce((s,r)=>s+r.comparisonAmount,0)/rows.length;
      const sorted=rows.map(r=>r.comparisonAmount).sort((a,b)=>a-b); const median=sorted.length%2?sorted[(sorted.length-1)/2]:(sorted[sorted.length/2-1]+sorted[sorted.length/2])/2;
      for(const row of rows){row.varianceToLow=row.comparisonAmount-low.comparisonAmount;row.varianceToLowPct=low.comparisonAmount?row.varianceToLow/low.comparisonAmount:0;row.varianceToEstimate=scope.estimatedPackage?row.comparisonAmount-scope.estimatedPackage:0;row.varianceToEstimatePct=scope.estimatedPackage?row.varianceToEstimate/scope.estimatedPackage:0;row.riskLevel=row.issues.length>=2?'high':row.issues.length?'medium':'low';}
      const spread=high.comparisonAmount-low.comparisonAmount, invited=db.invitations.filter(i=>i.scopeId===scope.id).length;
      let narrative=`${low.contractorName} has the lowest current leveled comparison at ${formatMoney(low.comparisonAmount)}.`;
      if(baseLow.id!==low.id)narrative+=` ${baseLow.contractorName} is the lowest base bid, but leveling adjustments change the order.`;
      if(low.issues.length)narrative+=` The apparent low bidder still has ${low.issues.join(' and ')} to resolve.`;
      if(rows.length>1)narrative+=` The current spread is ${formatMoney(spread)} (${low.comparisonAmount?Math.round(spread/low.comparisonAmount*100):0}%).`;
      groups.push({scopeId:scope.id,trade:scope.trade,estimatedPackage:scope.estimatedPackage,bids:rows,narrative,summary:{received:rows.length,invited,average:avg,median,lowBase:baseLow.amount,lowLeveled:low.comparisonAmount,spread,spreadPct:low.comparisonAmount?spread/low.comparisonAmount:0}});
    }
  }
  return groups;
}
function formatMoney(n){return Number(n||0).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});}

async function answerQuestion(project,question){
  const docs=db.documents.filter(d=>d.projectId===project.id); const scopeText=db.scopes.filter(s=>s.projectId===project.id).map(s=>`${s.trade}: ${s.summary}; ${s.requirements.join('; ')}`).join('\n');
  if(OPENAI_API_KEY&&docs.length){
    try{
      const content=[{type:'input_text',text:`Question: ${question}\nProject intake: ${project.name}, ${project.location}, ${project.description||''}. Known extracted scopes:\n${scopeText}\nAnswer only from the project intake and attached files. If the answer is not supported, say it is not found. End with a short Sources line listing filenames used.`},...(await openAIDocumentItems(project.id))];
      const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:OPENAI_MODEL,instructions:'You answer construction document questions conservatively. Do not invent values or specifications.',input:[{role:'user',content}]})});
      if(!r.ok) throw new Error(`OpenAI ${r.status}`); return {answer:extractOutputText(await r.json()),sources:docs.map(d=>d.name),mode:'live-ai'};
    }catch{}
  }
  const q=question.toLowerCase(); let answer='I could not find that in the structured project intake. Add a live AI key to ask questions directly against PDFs.'; const sources=['Project intake'];
  if(q.includes('bid')&&q.includes('due')) answer=`The bid due date is ${project.analysis?.bidDue||project.bidDue||'not set'}.`;
  else if(q.includes('value')||q.includes('budget')) answer=`The project estimated value is ${formatMoney(project.analysis?.estimatedValue||project.estimatedValue)}.`;
  else if(q.includes('location')||q.includes('where')) answer=`The project location is ${project.location}.`;
  else {const hit=db.scopes.find(s=>s.projectId===project.id&&q.includes(s.trade.toLowerCase())); if(hit) answer=`${hit.trade}: ${hit.summary} Requirements currently captured: ${hit.requirements.join('; ')||'none listed'}.`;}
  return {answer,sources,mode:'local'};
}


const SECURITY_HEADERS={
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'same-origin',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
};
function writeHeaders(res,status,headers={}){res.writeHead(status,{...SECURITY_HEADERS,...headers});}
function rateLimit(req,key,limit=30,windowMs=60000){
  const ip=String(req.socket.remoteAddress||'local'),now=Date.now(),bucket=`${ip}:${key}`,row=RATE_LIMIT.get(bucket)||{count:0,reset:now+windowMs};
  if(now>row.reset){row.count=0;row.reset=now+windowMs;} row.count++; RATE_LIMIT.set(bucket,row); return row.count<=limit;
}
async function readRaw(req,max=MAX_BODY_BYTES){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>max)throw new Error('Request is too large.');chunks.push(chunk);}return Buffer.concat(chunks);}
function orgScopedCounts(orgId){
  const ids=orgProjectIds(orgId), projects=db.projects.filter(p=>ids.has(p.id));
  return {projects:projects.length,contractors:visibleContractors(orgId).length,bids:db.bids.filter(x=>ids.has(x.projectId)).length,documents:db.documents.filter(x=>ids.has(x.projectId)).length,invitations:db.invitations.filter(x=>ids.has(x.projectId)).length};
}
function billingForOrg(orgId){db.billing=db.billing||{};return db.billing[orgId]||{status:'not-configured',plan:'none',updatedAt:null};}
function projectExportCsv(projectId){
  const project=db.projects.find(p=>p.id===projectId), groups=levelBids(projectId); const rows=[['Project','Scope','Contractor','Base Bid','Alternates','Exclusion Allowance','Manual Adjustment','Leveled Bid','Vs Low','Exceptions']];
  for(const group of groups) for(const bid of group.bids) rows.push([project?.name||'',group.trade,bid.contractorName,bid.amount,bid.alternateNet,bid.exclusionTotal,bid.manualAdjustment,bid.comparisonAmount,bid.varianceToLow,(bid.issues||[]).join('; ')]);
  const q=v=>`"${String(v??'').replace(/"/g,'""')}"`;return rows.map(r=>r.map(q).join(',')).join('\n');
}
function parseCsv(text){
  const rows=[];let row=[],field='',quoted=false;const src=String(text||'');for(let i=0;i<src.length;i++){const c=src[i];if(c==='"'){if(quoted&&src[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(field);field='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&src[i+1]==='\n')i++;row.push(field);if(row.some(x=>x.trim()))rows.push(row);row=[];field='';}else field+=c;}row.push(field);if(row.some(x=>x.trim()))rows.push(row);if(!rows.length)return[];const headers=rows[0].map(h=>h.trim());return rows.slice(1).map(values=>Object.fromEntries(headers.map((h,i)=>[h,String(values[i]||'').trim()])));
}
function splitList(v){return String(v||'').split(/[;|]/).map(x=>x.trim()).filter(Boolean);}
function stableNumber(value=''){let n=0;for(const ch of String(value))n=(n*31+ch.charCodeAt(0))>>>0;return n;}
function importContractorRows(orgId,rows){
  const created=[];let i=db.contractors.length;for(const r of rows){if(!r.name)continue;const trades=splitList(r.trades||r.trade);if(!trades.length)continue;const service=splitList(r.serviceStates||r.states||r.service_states);const licenses=splitList(r.licenseStates||r.license_states)||service;const c=enrichContractor({id:randomUUID(),orgId,name:r.name,email:r.email||'',trades,serviceStates:service,licenseStates:licenses.length?licenses:service,markets:splitList(r.markets)||['Commercial'],capabilities:splitList(r.capabilities),city:r.city||'',homeState:r.homeState||r.state||service[0]||'',minPackage:Number(r.minPackage||r.min_package||0),maxPackage:Number(r.maxPackage||r.max_package||1000000),insuranceLimit:Number(r.insuranceLimit||r.insurance_limit||2000000),bondCapacity:Number(r.bondCapacity||r.bond_capacity||1000000),responseRate:Number(r.responseRate||r.response_rate||.75),employees:Number(r.employees||20),qualified:true,prequalStatus:r.prequalStatus||r.prequal_status||'Approved',description:r.description||`${r.name} imported contractor profile.`,pastProjects:[],createdAt:new Date().toISOString()},i++,new Date().toISOString());db.contractors.push(c);created.push(c);}return created;
}
async function sendInvitationNow(inv){
  const project=db.projects.find(p=>p.id===inv.projectId),scope=db.scopes.find(s=>s.id===inv.scopeId),contractor=db.contractors.find(c=>c.id===inv.contractorId);if(!project||!scope||!contractor)return {ok:false,error:'Invitation data is incomplete.'};
  if(!contractor.email||contractor.email.endsWith('.example'))return {ok:false,skipped:true,error:'Demo or missing contractor email; no real message sent.'};
  const subject=`Invitation to bid: ${project.name} — ${scope.trade}`;const html=`<p>${contractor.name},</p><p>You are invited to bid the <strong>${scope.trade}</strong> package for <strong>${project.name}</strong> in ${project.location}.</p><p>Bid due: <strong>${project.analysis?.bidDue||project.bidDue||'TBD'}</strong></p><p>Log in to your normal bid workflow or contact the estimator for project documents and clarifications.</p>`;
  let result=await sendEmail(INTEGRATIONS.resend,{to:contractor.email,subject,html,text:`${contractor.name}, you are invited to bid ${scope.trade} for ${project.name}. Bid due ${project.analysis?.bidDue||project.bidDue||'TBD'}.`,idempotencyKey:`invite-${inv.id}`});
  if(!result.ok&&OUTREACH_WEBHOOK_URL){try{const r=await fetch(OUTREACH_WEBHOOK_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'bid_invitation',project,scope,contractor,invitation:inv})});if(r.ok)result={ok:true,id:`webhook:${inv.id}`};}catch{}}
  if(result.ok){inv.status='sent';inv.sentExternally=true;inv.sentAt=new Date().toISOString();inv.externalMessageId=result.id||null;queueFollowups(inv,project.orgId);integrationHealth.email='live';}else if(!result.skipped){integrationHealth.email='error';}
  return result;
}
function queueFollowups(inv,orgId){
  db.jobs=db.jobs||[];for(const days of [3,7]){if(db.jobs.some(j=>j.type==='invite_followup'&&j.payload?.invitationId===inv.id&&j.payload?.days===days))continue;db.jobs.push({id:randomUUID(),orgId,type:'invite_followup',status:'queued',runAt:new Date(Date.now()+days*86400000).toISOString(),payload:{invitationId:inv.id,days},createdAt:new Date().toISOString()});}
}
async function processDueJobs(){
  const now=Date.now();let changed=false;for(const job of (db.jobs||[]).filter(j=>j.status==='queued'&&new Date(j.runAt).getTime()<=now).slice(0,20)){job.status='running';changed=true;try{if(job.type==='invite_followup'){const inv=db.invitations.find(i=>i.id===job.payload.invitationId);if(!inv||['accepted','declined','submitted'].includes(inv.status)){job.status='cancelled';continue;}const project=db.projects.find(p=>p.id===inv.projectId),scope=db.scopes.find(s=>s.id===inv.scopeId),contractor=db.contractors.find(c=>c.id===inv.contractorId);if(!project||!scope||!contractor||!contractor.email||contractor.email.endsWith('.example')){job.status='skipped';continue;}const subject=`Reminder: ${project.name} — ${scope.trade} bid due ${project.analysis?.bidDue||project.bidDue||'TBD'}`;const result=await sendEmail(INTEGRATIONS.resend,{to:contractor.email,subject,html:`<p>Reminder: the ${scope.trade} bid for ${project.name} is due ${project.analysis?.bidDue||project.bidDue||'TBD'}.</p>`,text:`Reminder: ${scope.trade} bid for ${project.name} is due ${project.analysis?.bidDue||project.bidDue||'TBD'}.`,idempotencyKey:`followup-${job.id}`});job.status=result.ok?'completed':'failed';job.error=result.error||'';}else job.status='skipped';}catch(error){job.status='failed';job.error=error.message;}job.completedAt=new Date().toISOString();}
  if(changed)await persist();
}
function verifyStripeWebhook(raw,signature,secret){
  if(!secret||!signature)return false;const parts=Object.fromEntries(String(signature).split(',').map(x=>x.split('=',2)));if(!parts.t||!parts.v1)return false;const expected=createHmac('sha256',secret).update(`${parts.t}.${raw.toString('utf8')}`).digest('hex');const a=Buffer.from(expected),b=Buffer.from(parts.v1);return a.length===b.length&&timingSafeEqual(a,b);
}
function applyStripeEvent(event){
  const obj=event.data?.object||{},orgId=obj.metadata?.org_id||obj.client_reference_id;if(!orgId)return false;db.billing=db.billing||{};const current=db.billing[orgId]||{};let status=current.status||'unknown';if(event.type==='checkout.session.completed')status='checkout-complete';else if(event.type==='customer.subscription.created'||event.type==='customer.subscription.updated')status=obj.status||'active';else if(event.type==='customer.subscription.deleted')status='canceled';db.billing[orgId]={...current,status,customerId:obj.customer||current.customerId||null,subscriptionId:obj.subscription||obj.id||current.subscriptionId||null,updatedAt:new Date().toISOString()};return true;
}

async function serveStatic(pathname,res){
  const target=pathname==='/'?'/index.html':pathname; const safe=normalize(target).replace(/^(\.\.(\/|\\|$))+/, ''); const file=join(PUBLIC_DIR,safe);
  if(!file.startsWith(PUBLIC_DIR)) return text(res,403,'Forbidden');
  try{const b=await readFile(file); const ext=extname(file); const ct={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json'}[ext]||'application/octet-stream';writeHeaders(res,200,{'Content-Type':ct,'Cache-Control':'no-cache'});res.end(b);}catch{text(res,404,'Not found');}
}

async function resetOrgData(orgId){
  const ids=orgProjectIds(orgId); const docs=db.documents.filter(d=>ids.has(d.projectId));
  for(const d of docs){if(d.storageProvider!=='supabase'&&d.diskName)await rm(join(UPLOAD_DIR,d.diskName),{force:true}).catch(()=>{});}
  db.projects=db.projects.filter(p=>!ids.has(p.id));db.documents=db.documents.filter(x=>!ids.has(x.projectId));db.scopes=db.scopes.filter(x=>!ids.has(x.projectId));db.matches=db.matches.filter(x=>!ids.has(x.projectId));db.invitations=db.invitations.filter(x=>!ids.has(x.projectId));db.bids=db.bids.filter(x=>!ids.has(x.projectId));db.qa=db.qa.filter(x=>!ids.has(x.projectId));db.events=db.events.filter(x=>!ids.has(x.projectId));db.jobs=(db.jobs||[]).filter(x=>x.orgId!==orgId);db.contractors=db.contractors.filter(c=>!c.orgId||c.orgId!==orgId);db.orgSettings[orgId]={...defaultSettings()};await persist();
}


function platformAdminSummary(){
  const auth=AUTH.raw();
  const orgs=(auth.organizations||[]).map(org=>{
    const projectIds=new Set(db.projects.filter(p=>p.orgId===org.id).map(p=>p.id));
    const events=db.events.filter(e=>projectIds.has(e.projectId));
    const lastEvent=events.slice().sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0))[0];
    return {
      id:org.id,name:org.name,createdAt:org.createdAt,
      users:(auth.users||[]).filter(u=>u.orgId===org.id&&u.active!==false).length,
      projects:projectIds.size,
      documents:db.documents.filter(x=>projectIds.has(x.projectId)).length,
      bids:db.bids.filter(x=>projectIds.has(x.projectId)).length,
      invitations:db.invitations.filter(x=>projectIds.has(x.projectId)).length,
      customContractors:db.contractors.filter(c=>c.orgId===org.id).length,
      billing:billingForOrg(org.id),
      lastActivity:lastEvent?.createdAt||org.createdAt||null
    };
  });
  const orgNameById=new Map((auth.organizations||[]).map(o=>[o.id,o.name]));
  const users=(auth.users||[]).map(u=>({id:u.id,orgId:u.orgId,organization:orgNameById.get(u.orgId)||'Unknown',name:u.name,email:u.email,role:u.role,active:u.active!==false,createdAt:u.createdAt,lastLoginAt:u.lastLoginAt||null}));
  const projectMap=new Map(db.projects.map(p=>[p.id,p]));
  const recentActivity=db.events.slice().sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0)).slice(0,40).map(e=>{const project=projectMap.get(e.projectId);return {...e,projectName:project?.name||'System',orgId:project?.orgId||null,organization:orgNameById.get(project?.orgId)||'—'};});
  return {
    metrics:{organizations:orgs.length,users:users.length,projects:db.projects.length,documents:db.documents.length,invitations:db.invitations.length,bids:db.bids.length},
    organizations:orgs.sort((a,b)=>new Date(b.lastActivity||0)-new Date(a.lastActivity||0)),
    users:users.sort((a,b)=>new Date(b.lastLoginAt||b.createdAt||0)-new Date(a.lastLoginAt||a.createdAt||0)),
    recentActivity,
    system:{
      version:'6.1.2',
      ai:aiHealth.status,
      supabase:INTEGRATIONS.supabase.configured?integrationHealth.supabase:'local',
      email:INTEGRATIONS.resend.configured?integrationHealth.email:'disabled',
      billing:INTEGRATIONS.stripe.configured?integrationHealth.billing:'disabled',
      directoryContractors:db.contractors.filter(c=>!c.orgId).length,
      queuedJobs:(db.jobs||[]).filter(j=>j.status==='queued').length
    }
  };
}

const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,`http://${req.headers.host||'localhost'}`), pathname=url.pathname;

    if(pathname==='/api/health'&&req.method==='GET') return json(res,200,{ok:true,version:'6.1.2',app:'BidMatch AI',time:new Date().toISOString()});

    if(pathname==='/api/admin/auth/status'&&req.method==='GET') return json(res,200,ADMIN_AUTH.status(req));
    if(pathname==='/api/admin/auth/login'&&req.method==='POST'){
      if(!rateLimit(req,'admin-login',6,60000))return json(res,429,{error:'Too many admin login attempts. Try again shortly.'});
      const body=await readJson(req);try{return json(res,200,{ok:true,admin:ADMIN_AUTH.login(body,res)});}catch(error){return json(res,401,{error:error.message});}
    }
    if(pathname==='/api/admin/auth/logout'&&req.method==='POST'){ADMIN_AUTH.logout(res);return json(res,200,{ok:true});}
    if(pathname==='/api/admin/summary'&&req.method==='GET'){
      if(!ADMIN_AUTH.require(req))return json(res,401,{error:'ADMIN_AUTH_REQUIRED'});
      return json(res,200,platformAdminSummary());
    }

    if(pathname==='/api/stripe/webhook'&&req.method==='POST'){
      const raw=await readRaw(req);if(!INTEGRATIONS.stripe.webhookSecret)return json(res,503,{error:'Stripe webhook secret is not configured.'});if(!verifyStripeWebhook(raw,req.headers['stripe-signature'],INTEGRATIONS.stripe.webhookSecret))return json(res,400,{error:'Invalid webhook signature.'});const event=JSON.parse(raw.toString('utf8'));if(applyStripeEvent(event))await persist();return json(res,200,{received:true});
    }

    if(pathname==='/api/auth/status'&&req.method==='GET') return json(res,200,{...(await AUTH.status(req)),allowSelfSignup:ALLOW_SELF_SIGNUP});
    if(pathname==='/api/auth/bootstrap'&&req.method==='POST'){
      if(!rateLimit(req,'bootstrap',8,60000))return json(res,429,{error:'Too many attempts. Try again shortly.'});const body=await readJson(req);const result=await AUTH.bootstrap(body,res);claimUnscopedData(result.org.id);const settings=settingsForOrg(result.org.id);settings.organizationName=result.org.name;await persist();return json(res,201,result);
    }
    if(pathname==='/api/auth/register-workspace'&&req.method==='POST'){
      if(!ALLOW_SELF_SIGNUP)return json(res,403,{error:'Self-service workspace signup is disabled.'});if(!rateLimit(req,'register-workspace',5,60000))return json(res,429,{error:'Too many signup attempts. Try again shortly.'});const body=await readJson(req);const result=await AUTH.registerWorkspace(body,res);const settings=settingsForOrg(result.org.id);settings.organizationName=result.org.name;await persist();return json(res,201,result);
    }
    if(pathname==='/api/auth/login'&&req.method==='POST'){
      if(!rateLimit(req,'login',10,60000))return json(res,429,{error:'Too many login attempts. Try again shortly.'});const body=await readJson(req);return json(res,200,await AUTH.login(body,res));
    }
    if(pathname==='/api/auth/logout'&&req.method==='POST'){await AUTH.logout(req,res);return json(res,200,{ok:true});}
    if(pathname==='/api/auth/invite'&&req.method==='GET'){const token=url.searchParams.get('token')||'';const invite=AUTH.inspectInvite(token);return invite?json(res,200,invite):json(res,404,{error:'Invite not found or expired.'});}
    if(pathname==='/api/auth/accept-invite'&&req.method==='POST'){if(!rateLimit(req,'accept-invite',10,60000))return json(res,429,{error:'Too many attempts.'});const body=await readJson(req);return json(res,200,await AUTH.acceptInvite(body,res));}

    if(pathname==='/admin'||pathname==='/admin/') return serveStatic('/admin.html',res);
    if(pathname==='/admin.js') return serveStatic('/admin.js',res);
    if(!pathname.startsWith('/api/')) return serveStatic(pathname,res);

    const ctx=await AUTH.context(req);if(!ctx.authenticated)return json(res,401,{error:'AUTH_REQUIRED'});
    const orgId=ctx.org.id, user=ctx.user, settings=settingsForOrg(orgId);
    const need=role=>{if(!roleAtLeast(user,role)){json(res,403,{error:`${role} permission required.`});return false;}return true;};
    const findProject=id=>projectForOrg(id,orgId);

    if(pathname==='/api/state'&&req.method==='GET'){
      const ids=orgProjectIds(orgId);const projects=db.projects.filter(p=>ids.has(p.id));const contractors=visibleContractors(orgId);
      const launch={auth:REQUIRE_LOGIN?'configured':'local bypass',database:INTEGRATIONS.supabase.configured?integrationHealth.supabase:'local JSON',storage:INTEGRATIONS.supabase.configured?integrationHealth.supabase:'local disk',email:INTEGRATIONS.resend.configured?integrationHealth.email:'not configured',billing:INTEGRATIONS.stripe.configured?integrationHealth.billing:'not configured',ai:aiHealth.status,backup:'available'};
      return json(res,200,{version:'6.1.2',auth:{user,org:ctx.org,loginRequired:REQUIRE_LOGIN},config:{aiEnabled:!!OPENAI_API_KEY,model:OPENAI_MODEL,aiHealth,autoSendInvites:AUTO_SEND_INVITES,outreachWebhookConfigured:!!OUTREACH_WEBHOOK_URL,integrations:{supabase:INTEGRATIONS.supabase.configured,resend:INTEGRATIONS.resend.configured,stripe:INTEGRATIONS.stripe.configured},integrationHealth,launch},billing:billingForOrg(orgId),settings,counts:orgScopedCounts(orgId),projects,contractors});
    }


    if(pathname==='/api/team'&&req.method==='GET') return json(res,200,{members:AUTH.listTeam(orgId)});
    if(pathname==='/api/team/invite'&&req.method==='POST'){
      if(!need('admin'))return;const body=await readJson(req);const invite=await AUTH.createInvite({orgId,email:body.email,role:body.role,createdBy:user.id});const base=`${req.headers['x-forwarded-proto']||'http'}://${req.headers.host||'localhost:'+PORT}`;const inviteUrl=`${base}/?invite=${invite.token}`;let delivered=false;if(INTEGRATIONS.resend.configured&&!invite.email.endsWith('.example')){const email=await sendEmail(INTEGRATIONS.resend,{to:invite.email,subject:`You're invited to ${ctx.org.name} on BidMatch AI`,html:`<p>${user.name} invited you to join <strong>${ctx.org.name}</strong> as ${invite.role}.</p><p><a href="${inviteUrl}">Accept invitation</a></p>`,text:`Join ${ctx.org.name}: ${inviteUrl}`,idempotencyKey:`team-invite-${invite.id}`});delivered=email.ok;}return json(res,201,{invite:{email:invite.email,role:invite.role,expiresAt:invite.expiresAt},inviteUrl,delivered});
    }
    let team=routeMatch(pathname,'/api/team/:userId/role');
    if(team&&req.method==='PATCH'){if(!need('admin'))return;const body=await readJson(req);return json(res,200,{user:await AUTH.updateRole({orgId,userId:team.userId,role:body.role,actorId:user.id})});}

    if(pathname==='/api/settings'&&req.method==='PATCH'){
      if(!need('admin'))return;const body=await readJson(req);const next={...settings,...body,defaultInsuranceRequirement:Math.max(0,Number(body.defaultInsuranceRequirement??settings.defaultInsuranceRequirement)),defaultBondingThreshold:Math.max(0,Number(body.defaultBondingThreshold??settings.defaultBondingThreshold)),hardCapacityMultiplier:Math.max(1,Number(body.hardCapacityMultiplier??settings.hardCapacityMultiplier)),topMatchesPerScope:clamp(Number(body.topMatchesPerScope??settings.topMatchesPerScope),1,10)};db.orgSettings[orgId]=next;await persist();return json(res,200,{settings:next});
    }

    if(pathname==='/api/contractors/import'&&req.method==='POST'){
      if(!need('admin'))return;const body=await readJson(req);const rows=parseCsv(body.csv||'');if(!rows.length)return json(res,400,{error:'CSV contains no contractor rows.'});const created=importContractorRows(orgId,rows);await persist();return json(res,201,{created:created.length,contractors:visibleContractors(orgId)});
    }
    if(pathname==='/api/contractors/template.csv'&&req.method==='GET'){
      const body='name,email,trades,serviceStates,markets,minPackage,maxPackage,insuranceLimit,bondCapacity,licenseStates,city,employees,prequalStatus\nExample Electric,estimating@example.com,Electrical;Fire Alarm,MO;KS,Multifamily;Commercial,100000,3000000,5000000,2500000,MO;KS,Kansas City,40,Approved\n';writeHeaders(res,200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="bidmatch-contractor-template.csv"'});return res.end(body);
    }

    if(pathname==='/api/backup'&&req.method==='POST'){if(!need('admin'))return;const path=await BACKUPS.create(`org-${orgId.slice(0,8)}`);return json(res,200,{ok:true,file:path.split('/').pop()});}

    if(pathname==='/api/billing/checkout'&&req.method==='POST'){
      if(!need('owner'))return;const session=await createCheckoutSession(INTEGRATIONS.stripe,{customerEmail:user.email,orgId,userId:user.id});integrationHealth.billing='live';return json(res,200,{url:session.url,id:session.id});
    }

    if(pathname==='/api/projects'&&req.method==='POST'){
      if(!need('estimator'))return;const body=await readJson(req);if(!body.name||!body.location)return json(res,400,{error:'Project name and location are required.'});const project={id:randomUUID(),orgId,name:String(body.name).trim(),location:String(body.location).trim(),state:inferState(body.location),projectType:body.projectType||'Commercial',estimatedValue:money(body.estimatedValue),bidDue:body.bidDue||'',description:body.description||'',status:'draft',workflowStage:'intake',analysis:null,createdAt:new Date().toISOString(),createdBy:user.id};db.projects.push(project);const files=Array.isArray(body.files)?body.files:[];await storeDocuments(project.id,files);addEvent('project_created',project.id,`Project created with ${files.length} document${files.length===1?'':'s'}.`,{actorUserId:user.id});await persist();return json(res,201,getProjectBundle(project.id));
    }

    let p=routeMatch(pathname,'/api/projects/:id');
    if(p&&req.method==='GET'){const project=findProject(p.id);if(!project)return json(res,404,{error:'Project not found.'});return json(res,200,getProjectBundle(project.id));}
    p=routeMatch(pathname,'/api/projects/:id/stage');
    if(p&&req.method==='PATCH'){if(!need('estimator'))return;const project=findProject(p.id);if(!project)return json(res,404,{error:'Project not found.'});const body=await readJson(req);if(!PROJECT_STAGES.includes(body.stage))return json(res,400,{error:'Invalid workflow stage.'});project.workflowStage=body.stage;addEvent('stage_changed',project.id,`Workflow stage changed to ${body.stage}.`,{actorUserId:user.id});await persist();return json(res,200,getProjectBundle(project.id));}
    p=routeMatch(pathname,'/api/projects/:id/documents');
    if(p&&req.method==='POST'){if(!need('estimator'))return;const project=findProject(p.id);if(!project)return json(res,404,{error:'Project not found.'});const body=await readJson(req);const created=await storeDocuments(project.id,body.files||[]);addEvent('documents_added',project.id,`Added ${created.length} document${created.length===1?'':'s'}.`,{actorUserId:user.id});await persist();return json(res,200,getProjectBundle(project.id));}
    p=routeMatch(pathname,'/api/projects/:id/automation');
    if(p&&req.method==='POST'){if(!need('estimator'))return;const project=findProject(p.id);if(!project)return json(res,404,{error:'Project not found.'});return json(res,200,await runAutomation(project));}
    p=routeMatch(pathname,'/api/projects/:id/qa');
    if(p&&req.method==='POST'){const project=findProject(p.id);if(!project)return json(res,404,{error:'Project not found.'});const body=await readJson(req);if(!body.question)return json(res,400,{error:'Question is required.'});const ans=await answerQuestion(project,String(body.question));const row={id:randomUUID(),projectId:project.id,userId:user.id,question:String(body.question),...ans,createdAt:new Date().toISOString()};db.qa.unshift(row);addEvent('qa',project.id,`Project Q&A: ${String(body.question).slice(0,80)}`,{actorUserId:user.id});await persist();return json(res,200,{...getProjectBundle(project.id),latestAnswer:row});}
    p=routeMatch(pathname,'/api/projects/:projectId/scopes');
    if(p&&req.method==='POST'){
      if(!need('estimator'))return;const project=findProject(p.projectId);if(!project)return json(res,404,{error:'Project not found.'});const body=await readJson(req);const trade=canonicalTrade(body.trade||'');if(!trade)return json(res,400,{error:'Trade is required.'});const scope={id:randomUUID(),projectId:project.id,trade,division:String(body.division||tradeMeta(trade).division),summary:String(body.summary||`${trade} package manually added.`),requirements:Array.isArray(body.requirements)?body.requirements.map(String).map(x=>x.trim()).filter(Boolean):[],keywords:[],confidence:clamp(Number(body.confidence??1),0,1),estimatedPackage:Math.max(0,Number(body.estimatedPackage)||estimatePackage(project,trade)),manualEstimate:body.estimatedPackage!==undefined,qualification:body.qualification||null,source:'manual',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};Object.assign(scope,withQualificationDefaults(scope,settingsForOrg(project.orgId)));db.scopes.push(scope);await scoreScopeMatches(project,scope);addEvent('scope_added',project.id,`${scope.trade} scope manually added.`,{actorUserId:user.id});await persist();return json(res,201,getProjectBundle(project.id));
    }
    p=routeMatch(pathname,'/api/projects/:projectId/scopes/:scopeId');
    if(p&&req.method==='PATCH'){if(!need('estimator'))return;const project=findProject(p.projectId),scope=db.scopes.find(x=>x.id===p.scopeId&&x.projectId===p.projectId);if(!project||!scope)return json(res,404,{error:'Project or scope not found.'});const body=await readJson(req);await updateScope(project,scope,body);await persist();return json(res,200,getProjectBundle(project.id));}
    if(p&&req.method==='DELETE'){if(!need('estimator'))return;const project=findProject(p.projectId);if(!project)return json(res,404,{error:'Project not found.'});const scope=db.scopes.find(x=>x.id===p.scopeId&&x.projectId===p.projectId);if(!scope)return json(res,404,{error:'Scope not found.'});if(db.bids.some(b=>b.scopeId===scope.id))return json(res,409,{error:'Delete the bids for this scope before deleting the scope.'});db.scopes=db.scopes.filter(x=>x.id!==scope.id);db.matches=db.matches.filter(x=>x.scopeId!==scope.id);db.invitations=db.invitations.filter(x=>x.scopeId!==scope.id);addEvent('scope_deleted',p.projectId,`${scope.trade} scope removed.`,{actorUserId:user.id});await persist();return json(res,200,getProjectBundle(p.projectId));}
    p=routeMatch(pathname,'/api/projects/:projectId/scopes/:scopeId/bid-list');
    if(p&&req.method==='POST'){
      if(!need('estimator'))return;const project=findProject(p.projectId);const body=await readJson(req),scope=db.scopes.find(x=>x.id===p.scopeId&&x.projectId===p.projectId),contractor=visibleContractors(orgId).find(x=>x.id===body.contractorId);if(!project||!scope||!contractor)return json(res,400,{error:'Project, scope, or contractor not found.'});const match=db.matches.find(m=>m.projectId===p.projectId&&m.scopeId===scope.id&&m.contractorId===contractor.id);if(body.action!=='remove'&&match?.qualificationStatus==='ineligible')return json(res,409,{error:'This contractor fails a hard qualification requirement and cannot be added to the bid list.'});if(body.action!=='remove'&&match?.qualificationStatus==='conditional'&&!body.overrideConditional)return json(res,409,{error:'CONDITIONAL_REVIEW_REQUIRED',details:match.qualification?.warnings||[]});if(body.action==='remove'){if(db.bids.some(b=>b.projectId===p.projectId&&b.scopeId===scope.id&&b.contractorId===contractor.id))return json(res,409,{error:'A submitted bid exists for this contractor.'});db.invitations=db.invitations.filter(i=>!(i.projectId===p.projectId&&i.scopeId===scope.id&&i.contractorId===contractor.id));addEvent('bid_list_removed',p.projectId,`${contractor.name} removed from the ${scope.trade} bid list.`,{actorUserId:user.id});}else{if(!db.invitations.some(i=>i.projectId===p.projectId&&i.scopeId===scope.id&&i.contractorId===contractor.id))db.invitations.push({id:randomUUID(),projectId:p.projectId,scopeId:scope.id,contractorId:contractor.id,status:'queued',sentExternally:false,manual:true,createdAt:new Date().toISOString(),message:`Invitation to bid: ${project.name} — ${scope.trade}. Bid due ${project.analysis?.bidDue||project.bidDue||'TBD'}.`});project.workflowStage='bidding';addEvent('bid_list_added',p.projectId,`${contractor.name} added to the ${scope.trade} bid list.`,{actorUserId:user.id});}await persist();return json(res,200,getProjectBundle(p.projectId));
    }
    p=routeMatch(pathname,'/api/projects/:projectId/outreach/send');
    if(p&&req.method==='POST'){if(!need('estimator'))return;const project=findProject(p.projectId);if(!project)return json(res,404,{error:'Project not found.'});const pending=db.invitations.filter(i=>i.projectId===project.id&&i.status==='queued');const results=[];for(const inv of pending)results.push({invitationId:inv.id,...await sendInvitationNow(inv)});addEvent('outreach_send',project.id,`Processed ${pending.length} queued invitations for external outreach.`,{actorUserId:user.id});await persist();return json(res,200,{bundle:getProjectBundle(project.id),results});}
    p=routeMatch(pathname,'/api/projects/:projectId/export');
    if(p&&req.method==='GET'){const project=findProject(p.projectId);if(!project)return json(res,404,{error:'Project not found.'});const csv=projectExportCsv(project.id);writeHeaders(res,200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${slug(project.name)||'project'}-bid-leveling.csv"`});return res.end(csv);}
    p=routeMatch(pathname,'/api/projects/:projectId/bids/:bidId/adjustment');
    if(p&&req.method==='PATCH'){if(!need('estimator'))return;const project=findProject(p.projectId);if(!project)return json(res,404,{error:'Project not found.'});const bid=db.bids.find(b=>b.id===p.bidId&&b.projectId===p.projectId);if(!bid)return json(res,404,{error:'Bid not found.'});const body=await readJson(req);bid.manualAdjustment=Number(body.amount)||0;bid.manualAdjustmentReason=String(body.reason||'').trim();bid.updatedAt=new Date().toISOString();addEvent('leveling_adjustment',p.projectId,`Manual leveling adjustment updated for bid ${bid.id.slice(0,8)}.`,{actorUserId:user.id});await persist();return json(res,200,getProjectBundle(p.projectId));}
    p=routeMatch(pathname,'/api/projects/:projectId/invitations/:invitationId/status');
    if(p&&req.method==='POST'){if(!need('estimator'))return;const project=findProject(p.projectId);if(!project)return json(res,404,{error:'Project not found.'});const body=await readJson(req);const inv=db.invitations.find(i=>i.id===p.invitationId&&i.projectId===p.projectId);if(!inv)return json(res,404,{error:'Invitation not found.'});if(!['queued','sent','accepted','declined','submitted'].includes(body.status))return json(res,400,{error:'Invalid status.'});inv.status=body.status;inv.updatedAt=new Date().toISOString();addEvent('invitation_status',p.projectId,`Invitation marked ${body.status}.`,{actorUserId:user.id});await persist();return json(res,200,getProjectBundle(p.projectId));}
    p=routeMatch(pathname,'/api/projects/:projectId/bids/parse');
    if(p&&req.method==='POST'){if(!need('estimator'))return;const project=findProject(p.projectId),body=await readJson(req),scope=db.scopes.find(x=>x.id===body.scopeId&&x.projectId===p.projectId),contractor=visibleContractors(orgId).find(x=>x.id===body.contractorId);if(!project||!scope||!contractor)return json(res,400,{error:'Project, scope, or contractor was not found.'});const parsed=await parseBidProposal(body.proposalText);let bid=db.bids.find(b=>b.projectId===p.projectId&&b.scopeId===scope.id&&b.contractorId===contractor.id);if(bid){bid.parsed=parsed;bid.raw=body.proposalText;bid.updatedAt=new Date().toISOString();}else{bid={id:randomUUID(),projectId:p.projectId,scopeId:scope.id,contractorId:contractor.id,parsed,raw:body.proposalText,createdAt:new Date().toISOString()};db.bids.push(bid);}const inv=db.invitations.find(i=>i.projectId===p.projectId&&i.scopeId===scope.id&&i.contractorId===contractor.id);if(inv)inv.status='submitted';project.workflowStage='leveling';addEvent('bid_received',p.projectId,`Bid parsed from ${contractor.name} for ${scope.trade}.`,{actorUserId:user.id});await persist();return json(res,200,getProjectBundle(p.projectId));}
    p=routeMatch(pathname,'/api/projects/:projectId/bids/demo');
    if(p&&req.method==='POST'){if(!need('estimator'))return;const project=findProject(p.projectId);if(!project)return json(res,404,{error:'Project not found.'});const invitations=db.invitations.filter(i=>i.projectId===p.projectId);for(const inv of invitations){if(db.bids.some(b=>b.projectId===p.projectId&&b.scopeId===inv.scopeId&&b.contractorId===inv.contractorId))continue;const scope=db.scopes.find(s=>s.id===inv.scopeId),c=visibleContractors(orgId).find(x=>x.id===inv.contractorId);if(!scope||!c)continue;const match=db.matches.find(m=>m.projectId===p.projectId&&m.scopeId===scope.id&&m.contractorId===c.id);const est=scope.estimatedPackage||estimatePackage(project,scope.trade)||250000,seed=stableNumber(c.id),factor=.88+((100-(match?.score||75))/100)*.2+((seed%5)*.025),amount=Math.round(est*factor/1000)*1000,exclusions=(seed%4===0)?['Temporary power']:((seed%5===0&&scope.trade==='Electrical')?['Fire alarm']:[]);db.bids.push({id:randomUUID(),projectId:p.projectId,scopeId:scope.id,contractorId:c.id,parsed:{amount,alternates:[],inclusions:[`${scope.trade} scope per bid documents`],exclusions,bondIncluded:'yes',taxIncluded:'yes',schedule:'Per project schedule',notes:['Synthetic demo bid']},raw:'Synthetic demo bid',createdAt:new Date().toISOString()});inv.status='submitted';}project.workflowStage='leveling';addEvent('demo_bids',p.projectId,'Generated synthetic demo bids for queued invitations.',{actorUserId:user.id});await persist();return json(res,200,getProjectBundle(p.projectId));}
    p=routeMatch(pathname,'/api/contractors/:id');
    if(p&&req.method==='GET'){const c=visibleContractors(orgId).find(x=>x.id===p.id);return c?json(res,200,c):json(res,404,{error:'Contractor not found.'});}
    if(pathname==='/api/reset'&&req.method==='POST'){if(!need('admin'))return;await resetOrgData(orgId);return json(res,200,{ok:true});}
    return json(res,404,{error:'API route not found.'});
  }catch(err){console.error(err);if(!res.headersSent)json(res,500,{error:err.message||'Unexpected server error.'});else res.end();}
});

setInterval(()=>processDueJobs().catch(error=>console.error('Job worker:',error.message)),JOB_INTERVAL_MS).unref();
server.listen(PORT,HOST,()=>{
  console.log(`BidMatch AI V6.1.2 running on ${HOST}:${PORT}`);
  console.log(`Local URL: http://localhost:${PORT}`);
  console.log(`Authentication: ${REQUIRE_LOGIN?'required':'local bypass'}`);
  console.log(`AI: ${OPENAI_API_KEY?`configured (${OPENAI_MODEL})`:'fallback mode'}`);
  console.log(`Cloud database/storage: ${INTEGRATIONS.supabase.configured?'configured':'local'}`);
  console.log(`Email: ${INTEGRATIONS.resend.configured?'configured':'disabled'} · Billing: ${INTEGRATIONS.stripe.configured?'configured':'disabled'}`);
});
