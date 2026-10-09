import fs from 'node:fs';
const mode=String(process.argv[2]||'').toLowerCase();if(!['local','supabase'].includes(mode))throw new Error('Usage: node scripts/set-data-backend.mjs local|supabase');
const path='.env';let text=fs.existsSync(path)?fs.readFileSync(path,'utf8'):fs.readFileSync('.env.example','utf8');const re=/^DATA_BACKEND=.*$/m;text=re.test(text)?text.replace(re,`DATA_BACKEND=${mode}`):`${text.trimEnd()}\nDATA_BACKEND=${mode}\n`;fs.writeFileSync(path,text);console.log(`DATA_BACKEND=${mode}`);
