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
} else {
  throw new Error('Unknown configuration mode.');
}

fs.writeFileSync(envPath, text);
