'use strict';
const crypto = require('crypto');
const PLATFORMS = ['facebook', 'instagram', 'linkedin', 'youtube', 'x'];
const NAMES = {facebook:'Facebook', instagram:'Instagram', linkedin:'LinkedIn', youtube:'YouTube', x:'X'};
function key() {
  const raw = process.env.SOCIAL_TOKEN_KEY || '';
  if (!/^[a-f0-9]{64}$/i.test(raw)) throw new Error('One-time account connection setup is needed on the server.');
  return Buffer.from(raw, 'hex');
}
function encrypt(data) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(data)),cipher.final()]);
  return [iv,encrypted,cipher.getAuthTag()].map(b=>b.toString('base64')).join('.');
}
function decrypt(text) {
  const [iv, data, tag] = text.split('.').map(x=>Buffer.from(x, 'base64'));
  const cipher = crypto.createDecipheriv('aes-256-gcm', key(), iv); cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(data),cipher.final()]).toString());
}
function hash(x) { return crypto.createHash('sha256').update(x).digest('hex'); }
function baseUrl() { return (process.env.SOCIAL_BASE_URL || 'https://keralamarinesupply.in').replace(/\/$/,''); }
function provider(p) { return p === 'facebook' || p === 'instagram' ? 'meta' : p; }
function configured(p) {
  const prefix = {meta:'META',linkedin:'LINKEDIN',youtube:'GOOGLE',x:'X'}[provider(p)];
  return !!prefix && /^[a-f0-9]{64}$/i.test(process.env.SOCIAL_TOKEN_KEY||'') && !!process.env[prefix+'_CLIENT_ID'] && !!process.env[prefix+'_CLIENT_SECRET'];
}
function validId(id) { return typeof id==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id); }
function validateDraft(input) {
  const message=String(input.message||'').trim();
  if(message.length>5000) throw new Error('Keep the message under 5,000 characters.');
  const title=String(input.title||'').trim().slice(0,100);
  if(!message && !input.media) throw new Error('Add a message, image or video first.');
  return {message,title,media:input.media||null};
}
function eligible(platform,draft) {
  if(platform==='youtube' && (!draft.media || draft.media.kind!=='video')) return 'YouTube needs a video.';
  if(platform==='instagram' && !draft.media) return 'Instagram needs an image or video.';
  if(platform==='instagram' && draft.message.length>2200) return 'Instagram needs a message under 2,200 characters.';
  if(platform==='linkedin' && draft.message.length>3000) return 'LinkedIn needs a message under 3,000 characters.';
  // Use a conservative limit, with URLs counted as 23 characters. No silent truncation.
  if(platform==='x' && Array.from(draft.message.replace(/https?:\/\/\S+/g,'x'.repeat(23))).reduce((n,c)=>n+(c.codePointAt(0)>0x10ff?2:1),0)>280) return 'Shorten the message for X (280 characters, with some characters counting twice).';
  return null;
}
class PlatformError extends Error {
  constructor(message, uncertain=false){ super(message);this.uncertain=uncertain; }
}
// Never send raw provider errors or signed URLs/tokens to the browser or logs.
async function request(url, options={}, mutate=false) {
  let response;
  try { response=await fetch(url,{...options,redirect:options.redirect||'error',signal:AbortSignal.timeout(120000)}); }
  catch { throw new PlatformError('Connection interrupted. Check the platform before trying again.',mutate); }
  if(!response.ok){
    const reconnect=response.status===401||response.status===403;
    throw new PlatformError(reconnect?'Reconnect this account and check its publishing permissions.':response.status===429?'The platform is busy or its limit was reached. Try later.':'The platform could not accept this post. Check its media requirements and account setup.',mutate&&response.status>=500);
  }
  return response;
}
async function json(url,options={},mutate=false){const r=await request(url,options,mutate);const text=await r.text();try{return text?JSON.parse(text):{};}catch{throw new PlatformError('The platform returned an unreadable response.',mutate);} }
const postJson=(url,body,headers={},mutate=false)=>json(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)},mutate);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
module.exports={PLATFORMS,NAMES,key,encrypt,decrypt,hash,baseUrl,provider,configured,validId,validateDraft,eligible,PlatformError,request,json,postJson,sleep};
