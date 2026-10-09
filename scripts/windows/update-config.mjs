import fs from 'node:fs';
import crypto from 'node:crypto';

const mode = process.env.BIDMATCH_CONFIG_MODE || '';
const envPath = '.env';
let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : (fs.existsSync('.env.example') ? fs.readFileSync('.env.example', 'utf8') : '');

function setEnv(key, value) {
  const safe = String(value ?? '').replace(/[\r\n]/g, '');
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(text)) text = text.replace(re, `${key}=${safe}`);
  else text += `${text.endsWith('\n') || !text ? '' : '\n'}${key}=${safe}\n`;
}

if (mode === 'admin') {
  const email = String(process.env.BIDMATCH_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.BIDMATCH_ADMIN_PASSWORD || '');
  if (!email.includes('@')) throw new Error('A valid admin email is required.');
  if (password.length < 10) throw new Error('Admin password must be at least 10 characters.');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  setEnv('PLATFORM_ADMIN_EMAIL', email);
  setEnv('PLATFORM_ADMIN_PASSWORD_HASH', `${salt}:${hash}`);
  setEnv('PLATFORM_ADMIN_SESSION_SECRET', crypto.randomBytes(32).toString('hex'));
} else if (mode === 'ai') {
  const key = String(process.env.BIDMATCH_OPENAI_KEY || '').trim();
  if (!key) throw new Error('No API key was provided.');
  setEnv('OPENAI_API_KEY', key);
  if (!/^OPENAI_MODEL=/m.test(text)) setEnv('OPENAI_MODEL', 'gpt-5.6');
  if (!/^OPENAI_EMBEDDING_MODEL=/m.test(text)) setEnv('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-small');
} else if (mode === 'supabase') {
  const url=String(process.env.BIDMATCH_SUPABASE_URL||'').trim();
  const key=String(process.env.BIDMATCH_SUPABASE_KEY||'').trim();
  if(!/^https?:\/\//i.test(url)) throw new Error('A valid Supabase project URL is required.');
  if(!key) throw new Error('A Supabase secret key is required.');
  setEnv('SUPABASE_URL',url);
  setEnv('SUPABASE_SECRET_KEY',key);
  setEnv('SUPABASE_STORAGE_BUCKET',String(process.env.BIDMATCH_SUPABASE_BUCKET||'bidmatch-documents').trim()||'bidmatch-documents');
  setEnv('DATA_BACKEND','local');
} else if (mode === 'production') {
  setEnv('APP_ENV','production');
  setEnv('REQUIRE_LOGIN','true');
  const mapping = {
    APP_URL:'BIDMATCH_APP_URL',
    TRUSTED_ORIGINS:'BIDMATCH_TRUSTED_ORIGINS',
    ALLOW_SELF_SIGNUP:'BIDMATCH_ALLOW_SELF_SIGNUP',
    DATA_BACKEND:'BIDMATCH_DATA_BACKEND',
    MAX_FILE_MB:'BIDMATCH_MAX_FILE_MB',
    MAX_BODY_MB:'BIDMATCH_MAX_BODY_MB',
    MAX_PROJECT_FILES:'BIDMATCH_MAX_PROJECT_FILES',
    SUPABASE_URL:'BIDMATCH_SUPABASE_URL',
    SUPABASE_SECRET_KEY:'BIDMATCH_SUPABASE_KEY',
    SUPABASE_STORAGE_BUCKET:'BIDMATCH_SUPABASE_BUCKET',
    RESEND_API_KEY:'BIDMATCH_RESEND_KEY',
    EMAIL_FROM:'BIDMATCH_EMAIL_FROM',
    STRIPE_SECRET_KEY:'BIDMATCH_STRIPE_KEY',
    STRIPE_PRICE_ID:'BIDMATCH_STRIPE_PRICE_ID',
    STRIPE_WEBHOOK_SECRET:'BIDMATCH_STRIPE_WEBHOOK_SECRET'
  };
  for (const [envKey, sourceKey] of Object.entries(mapping)) {
    const value = String(process.env[sourceKey] || '').trim();
    if (value) setEnv(envKey, value);
  }
} else {
  throw new Error('Unknown configuration mode.');
}

fs.writeFileSync(envPath, text);
