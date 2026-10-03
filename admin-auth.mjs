import { scryptSync, timingSafeEqual, createHmac } from 'node:crypto';

function normalizeEmail(v=''){ return String(v).trim().toLowerCase(); }
function parseCookies(req){
  const out={};
  for(const part of String(req.headers.cookie||'').split(';')){
    const i=part.indexOf('=');
    if(i>0) out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim());
  }
  return out;
}
function verifyPassword(password, stored=''){
  const [salt,hex]=String(stored).split(':');
  if(!salt||!hex) return false;
  const actual=scryptSync(String(password),salt,64);
  const expected=Buffer.from(hex,'hex');
  return actual.length===expected.length && timingSafeEqual(actual,expected);
}
function b64url(value){ return Buffer.from(value).toString('base64url'); }
function sign(value, secret){ return createHmac('sha256',secret).update(value).digest('base64url'); }

export function createPlatformAdminAuth({email,passwordHash,sessionSecret,secureCookies=false}={}){
  const configured=!!(email&&passwordHash&&sessionSecret);
  const normalizedEmail=normalizeEmail(email);
  const cookieName='bm_admin_session';
  const ttlSeconds=8*60*60;

  function makeToken(){
    const payload=b64url(JSON.stringify({email:normalizedEmail,exp:Date.now()+ttlSeconds*1000}));
    return `${payload}.${sign(payload,sessionSecret)}`;
  }
  function readToken(token=''){
    if(!configured||!token.includes('.')) return null;
    const [payload,sig]=token.split('.',2);
    const expected=sign(payload,sessionSecret);
    const a=Buffer.from(expected), b=Buffer.from(sig||'');
    if(a.length!==b.length || !timingSafeEqual(a,b)) return null;
    try{
      const parsed=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
      if(parsed.email!==normalizedEmail || Number(parsed.exp||0)<Date.now()) return null;
      return parsed;
    }catch{return null;}
  }
  function setCookie(res, token){
    res.setHeader('Set-Cookie',`${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ttlSeconds}${secureCookies?'; Secure':''}`);
  }
  function clearCookie(res){
    res.setHeader('Set-Cookie',`${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureCookies?'; Secure':''}`);
  }
  function status(req){
    if(!configured) return {configured:false,authenticated:false,email:''};
    const session=readToken(parseCookies(req)[cookieName]);
    return {configured:true,authenticated:!!session,email:session?normalizedEmail:''};
  }
  function login({email:inputEmail,password},res){
    if(!configured) throw new Error('Platform admin login is not configured.');
    if(normalizeEmail(inputEmail)!==normalizedEmail || !verifyPassword(password,passwordHash)) throw new Error('Invalid admin email or password.');
    setCookie(res,makeToken());
    return {email:normalizedEmail};
  }
  function logout(res){ clearCookie(res); }
  function require(req){ return status(req).authenticated; }
  return {configured,status,login,logout,require,email:normalizedEmail};
}
