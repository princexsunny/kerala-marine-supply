'use strict';
const crypto=require('crypto');
const {admin,init}=require('../firebase');
const session=require('../session');
const {encrypt,decrypt,hash,baseUrl,configured,provider,json,postJson}=require('./core');
const GRAPH='https://graph.facebook.com/'+(process.env.META_GRAPH_VERSION||'v26.0');
const LI_HEADERS={'LinkedIn-Version':process.env.LINKEDIN_API_VERSION||'202610','X-Restli-Protocol-Version':'2.0.0'};
function db(){init();return admin.firestore();}
function config(p){
  const prefix={meta:'META',linkedin:'LINKEDIN',youtube:'GOOGLE',x:'X'}[p];
  return {id:process.env[prefix+'_CLIENT_ID'],secret:process.env[prefix+'_CLIENT_SECRET'],redirect:baseUrl()+'/api/social/callback/'+p};
}
function binding(req){return hash(session.parseCookies(req)[session.COOKIE_NAME]||'');}
async function begin(p,req){
  if(!configured(p)) throw new Error('One-time setup is needed before this account can connect.');
  const c=config(p),state=crypto.randomBytes(32).toString('hex'),verifier=crypto.randomBytes(32).toString('base64url');
  await db().collection('socialOAuthStates').doc(hash(state)).set({provider:p,binding:binding(req),expires:Date.now()+600000,secret:encrypt({verifier})});
  const auth={meta:'https://www.facebook.com/'+(process.env.META_GRAPH_VERSION||'v26.0')+'/dialog/oauth',linkedin:'https://www.linkedin.com/oauth/v2/authorization',youtube:'https://accounts.google.com/o/oauth2/v2/auth',x:'https://x.com/i/oauth2/authorize'};
  const scopes={meta:'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish',linkedin:'rw_organization_admin w_organization_social',youtube:'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',x:'tweet.read tweet.write users.read offline.access media.write'};
  const url=new URL(auth[p]);
  for(const [k,v] of Object.entries({client_id:c.id,redirect_uri:c.redirect,response_type:'code',state,scope:scopes[p]}))url.searchParams.set(k,v);
  if(p==='x'){url.searchParams.set('code_challenge',crypto.createHash('sha256').update(verifier).digest('base64url'));url.searchParams.set('code_challenge_method','S256');}
  if(p==='youtube'){url.searchParams.set('access_type','offline');url.searchParams.set('prompt','consent');}
  return url.href;
}
async function formToken(p,fields){
  const c=config(p),endpoint={linkedin:'https://www.linkedin.com/oauth/v2/accessToken',youtube:'https://oauth2.googleapis.com/token',x:'https://api.x.com/2/oauth2/token'}[p];
  const headers={'Content-Type':'application/x-www-form-urlencoded'};
  if(p==='x')headers.Authorization='Basic '+Buffer.from(c.id+':'+c.secret).toString('base64');
  else Object.assign(fields,{client_id:c.id,client_secret:c.secret});
  return json(endpoint,{method:'POST',headers,body:new URLSearchParams(fields)});
}
async function complete(p,req){
  if(!configured(p)||typeof req.query.state!=='string'||typeof req.query.code!=='string') throw new Error('Connection was cancelled or expired. Please try again.');
  const ref=db().collection('socialOAuthStates').doc(hash(req.query.state));
  const state=await db().runTransaction(async tx=>{const snap=await tx.get(ref);const s=snap.data();if(!s||s.provider!==p||s.binding!==binding(req)||s.expires<Date.now())throw new Error('Connection expired. Please try again.');tx.delete(ref);return s;});
  const c=config(p);let token;
  if(p==='meta'){
    const query=new URLSearchParams({client_id:c.id,client_secret:c.secret,redirect_uri:c.redirect,code:req.query.code});
    const short=await json(GRAPH+'/oauth/access_token?'+query);
    token=await json(GRAPH+'/oauth/access_token?'+new URLSearchParams({grant_type:'fb_exchange_token',client_id:c.id,client_secret:c.secret,fb_exchange_token:short.access_token}));
  }else token=await formToken(p,{grant_type:'authorization_code',code:req.query.code,redirect_uri:c.redirect,...(p==='x'?{code_verifier:decrypt(state.secret).verifier}:{})});
  if(!token.access_token)throw new Error('The account did not grant publishing access.');
  const auth={Authorization:'Bearer '+token.access_token};
  const candidates=[];
  const expires=Date.now()+Number(token.expires_in||3600)*1000;
  function add(platform,id,name,extra={}){candidates.push({platform,id:String(id),name:String(name||id),secret:encrypt({...token,expires,...extra})});}
  if(p==='meta'){
    // Enumerate every page, including accounts beyond the first response page.
    let next=GRAPH+'/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100';
    for(let i=0;next&&i<10;i++){
      const pages=await json(next,{headers:auth});
      for(const page of pages.data||[]){
        add('facebook',page.id,page.name,{access_token:page.access_token,expires:0});
        if(page.instagram_business_account)add('instagram',page.instagram_business_account.id,'@'+page.instagram_business_account.username,{access_token:page.access_token,expires:0});
      }
      // Only follow the documented Graph host, never a user-controlled URL.
      next=pages.paging?.next;
      if(next&&new URL(next).hostname!=='graph.facebook.com')next=null;
    }
  }else if(p==='linkedin'){
    const acl=await json('https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&state=APPROVED&count=100',{headers:{...auth,...LI_HEADERS}});
    const ids=[...new Set((acl.elements||[]).filter(a=>['ADMINISTRATOR','CONTENT_ADMIN'].includes(a.role)).map(a=>a.organization))];
    for(const urn of ids){
      const id=String(urn).split(':').pop();
      const org=await json('https://api.linkedin.com/rest/organizations/'+id,{headers:{...auth,...LI_HEADERS}});
      add('linkedin',urn,org.localizedName||'Company '+id);
    }
  }else if(p==='youtube'){
    const channels=await json('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',{headers:auth});
    for(const channel of channels.items||[])add('youtube',channel.id,channel.snippet.title);
  }else{
    const user=await json('https://api.x.com/2/users/me',{headers:auth});
    if(user.data)add('x',user.data.id,'@'+user.data.username);
  }
  if(!candidates.length)throw new Error('No eligible accounts were found. Check the account type and publishing permissions.');
  const pending=crypto.randomUUID();
  await db().collection('socialPendingAccounts').doc(pending).set({expires:Date.now()+900000,candidates});
  return pending;
}
async function choices(id){const snap=await db().collection('socialPendingAccounts').doc(id).get();const d=snap.data();if(!d||d.expires<Date.now())throw new Error('Account selection expired. Connect again.');return d;}
async function select(id,indexes){
  const pending=await choices(id),selected=indexes.map(i=>pending.candidates[i]);
  if(!selected.length||selected.some(x=>!x)||new Set(selected.map(x=>x.platform)).size!==selected.length)throw new Error('Choose one Shalom Group account for each platform.');
  const batch=db().batch();
  for(const a of selected)batch.set(db().collection('socialConnections').doc(a.platform),{...a,connectedAt:new Date().toISOString()});
  batch.delete(db().collection('socialPendingAccounts').doc(id));await batch.commit();
}
async function connections(){const snap=await db().collection('socialConnections').get();return Object.fromEntries(snap.docs.map(d=>[d.id,d.data()]));}
async function access(platform,connection){
  const token=decrypt(connection.secret),p=provider(platform);
  if(!token.expires||token.expires>Date.now()+120000)return token.access_token;
  if(!token.refresh_token)throw new Error('Reconnect this account before publishing.');
  const fresh=await formToken(p,{grant_type:'refresh_token',refresh_token:token.refresh_token});
  if(!fresh.access_token)throw new Error('Reconnect this account before publishing.');
  const secret=encrypt({...token,...fresh,expires:Date.now()+Number(fresh.expires_in||3600)*1000});
  await db().collection('socialConnections').doc(platform).update({secret});
  return fresh.access_token;
}
module.exports={db,begin,complete,choices,select,connections,access,GRAPH,LI_HEADERS};
