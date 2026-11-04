(function(){
'use strict';
const $=id=>document.getElementById(id),names={facebook:'Facebook',instagram:'Instagram',linkedin:'LinkedIn',youtube:'YouTube',x:'X'};
let platforms=[],drafts=[],draftId=null,media=null,file=null,removeMedia=false,previewUrl=null,busy=false,dirty=false,requestId=null,timer=null;
const pending=new URLSearchParams(location.search).get('accounts');
function node(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
function note(text,error=false){$('status').textContent=text;$('status').className='message'+(error?' error':'');}
async function api(path,options={}){
  const response=await fetch('/api/social/'+path,{...options,credentials:'same-origin',headers:{'X-KMS-Social':'1',...options.headers}});
  if(response.status===401){location.href='/login.html?next='+encodeURIComponent('/social-publisher.html');throw Error('Please sign in again.');}
  const body=await response.json();if(!response.ok)throw Error(body.error||'Please try again.');return body;
}
const post=(path,body)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
function changed(){dirty=true;requestId=null;updateTargets();}
function currentKind(){return file?(file.type.startsWith('video/')?'video':'image'):removeMedia?null:media?.kind||null;}
function reason(p){const kind=currentKind(),message=$('message').value.trim();if(p==='youtube'&&kind!=='video')return 'needs a video';if(p==='instagram'&&!kind)return 'needs an image or video';if(p==='instagram'&&message.length>2200)return 'message is too long';if(p==='linkedin'&&message.length>3000)return 'message is too long';if(p==='x'&&Array.from(message.replace(/https?:\/\/\S+/g,'x'.repeat(23))).reduce((n,c)=>n+(c.codePointAt(0)>0x10ff?2:1),0)>280)return 'message is too long (280 character limit)';return '';}
function updateTargets(){
  const ready=platforms.filter(p=>p.connected&&!reason(p.id)),missing=platforms.filter(p=>!p.connected),skips=platforms.filter(p=>p.connected&&reason(p.id));
  $('publish').disabled=busy||!ready.length;
  if(busy)return;
  if(!platforms.length){$('targets').textContent='Account status could not be loaded. Refresh before publishing.';return;}
  const lines=[];
  if(ready.length)lines.push('Will publish to '+ready.map(p=>p.name).join(', ')+'.');
  if(missing.length)lines.push('Not connected: '+missing.map(p=>p.name).join(', ')+'.');
  if(skips.length)lines.push('Not included: '+skips.map(p=>p.name+' — '+reason(p.id)).join('; ')+'.');
  if(!platforms.some(p=>p.connected))lines.unshift('Save a draft now. Connect your Shalom Group accounts once before publishing.');
  $('targets').textContent=lines.join(' ');
}
function setBusy(value){busy=value;for(const id of ['save','new','pick-video','pick-image','remove-media','message','title','file'])$(id).disabled=value;$('publish').textContent=value?'Please wait…':'Publish to all';updateTargets();}
function preview(){
  if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}
  const kind=currentKind();$('preview').replaceChildren();$('preview').hidden=!kind;$('upload-intro').hidden=!!kind;$('filename').hidden=!kind;$('remove-media').hidden=!kind;
  if(!kind)return;
  const el=node(kind==='video'?'video':'img');el.src=file?(previewUrl=URL.createObjectURL(file)):'/api/social/media/'+draftId;
  if(kind==='video'){el.controls=true;el.preload='metadata';el.playsInline=true;}else el.alt='Your post image';
  $('preview').append(el);$('filename').textContent=file?.name||media?.name||'Attachment';
}
async function pick(chosen){
  if(!chosen)return;
  if(chosen.size>(chosen.type.startsWith('image/')?10:50)*1024*1024){note('Choose an image under 10 MB or a video under 50 MB.',true);return;}
  if(!['image/jpeg','image/png','image/webp','video/mp4'].includes(chosen.type)){note('Choose a JPEG, PNG, WebP image or MP4 video.',true);return;}
  if(chosen.type.startsWith('image/')){
    setBusy(true);note('Preparing your image…');
    try{const bitmap=await createImageBitmap(chosen);const scale=Math.min(1,1920/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.9));if(!blob)throw Error();file=new File([blob],chosen.name.replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg'});}
    catch{note('This image could not be opened. Try another image.',true);return;}
    finally{setBusy(false);}
  }else file=chosen;
  removeMedia=false;changed();preview();note('Attachment ready. Add a message, then publish or save your draft.');
}
$('pick-video').onclick=()=>{$('file').accept='video/mp4';$('file').click();};
$('pick-image').onclick=()=>{$('file').accept='image/jpeg,image/png,image/webp';$('file').click();};
$('file').onchange=()=>{void pick($('file').files[0]);$('file').value='';};
$('dropzone').ondragover=e=>e.preventDefault();$('dropzone').ondrop=e=>{e.preventDefault();if(!busy)void pick(e.dataTransfer.files[0]);};
$('remove-media').onclick=()=>{file=null;removeMedia=true;changed();preview();};
$('message').oninput=()=>{$('counter').textContent=$('message').value.length+' characters';changed();};$('title').oninput=changed;
async function saveDraft(){
  const form=new FormData();form.append('message',$('message').value);form.append('title',$('title').value);form.append('removeMedia',String(removeMedia));if(draftId)form.append('id',draftId);if(file)form.append('file',file);
  const saved=await api('drafts',{method:'POST',body:form});draftId=saved.id;media=saved.media;file=null;removeMedia=false;dirty=false;preview();return saved;
}
$('save').onclick=async()=>{setBusy(true);note('Saving your draft…');try{await saveDraft();note('Draft saved. You can return to it on any device.');await loadDrafts();}catch(e){note(e.message,true);}finally{setBusy(false);}};
$('composer').onsubmit=async e=>{
  e.preventDefault();if(busy)return;
  if(!platforms.some(p=>p.connected&&!reason(p.id))){note('Connect an account that can publish this content first.',true);return;}
  setBusy(true);note(file?'Uploading your attachment…':'Preparing your post…');
  try{
    if(!draftId||dirty)await saveDraft();
    // Reuse the same key after a timeout or lost response. A second click
    // cannot duplicate the original publishing request.
    if(!requestId)requestId=crypto.randomUUID();
    await post('publish',{draftId,requestId});
    note('Publishing has started. You can follow each account below.');await Promise.all([loadPosts(),loadDrafts()]);
  }catch(e){note(e.message,true);}finally{setBusy(false);}
};
function reset(){draftId=null;media=null;file=null;removeMedia=false;requestId=null;dirty=false;$('message').value='';$('title').value='';$('counter').textContent='0 characters';preview();updateTargets();note('Ready for a new post.');}
$('new').onclick=()=>{if(!dirty||confirm('Start a new post? Save your draft first if you need it.'))reset();};
async function loadAccounts(){
  const status=await api('status');platforms=status.platforms;$('accounts').replaceChildren();
  for(const p of platforms){
    const row=node('div',undefined,'account'),icon=node('span',{facebook:'f',instagram:'IG',linkedin:'in',youtube:'▶',x:'X'}[p.id],'icon'),body=node('div',undefined,'account-body');
    body.append(node('div',p.name,'account-name'),node('div',p.connected?p.accountName:p.canConnect?'Ready to connect':'One-time setup needed','account-status'+(p.connected?' connected':'')));
    const button=node('a',p.connected?'Reconnect':p.canConnect?'Connect':'Set up','btn connect');button.href=p.connectUrl;
    row.append(icon,body,button);$('accounts').append(row);
  }
  if(platforms.some(p=>!p.canConnect))$('setup-note').textContent='The website’s social publishing apps still need one-time server setup. Once that is ready, use Connect beside each platform and choose your Shalom Group account. You can save drafts now.';
  updateTargets();
}
function when(value){return new Date(value).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'})+' IST';}
async function loadDrafts(){
  drafts=await api('drafts');$('drafts').replaceChildren();if(!drafts.length){$('drafts').append(node('div','No drafts yet. Save a post above to keep it for later.','empty'));return;}
  for(const d of drafts){const row=node('div',undefined,'draft'),text=node('div');text.append(node('p',(d.message||d.title||'Shalom Group '+(d.media?.kind||'update')).slice(0,140),'excerpt'),node('span',(d.media?.kind||'Message')+' · '+when(d.updatedAt),'meta'));const open=node('button','Open','btn');open.type='button';open.onclick=()=>{
    if(busy)return;if(dirty&&!confirm('Open this draft? Unsaved changes will be replaced.'))return;
    draftId=d.id;media=d.media;file=null;removeMedia=false;dirty=false;requestId=null;$('message').value=d.message;$('title').value=d.title||'';$('counter').textContent=d.message.length+' characters';preview();updateTargets();window.scrollTo({top:0,behavior:'smooth'});note('Draft opened.');
  };row.append(text,open);$('drafts').append(row);}
}
async function loadPosts(){
  const posts=await api('posts');$('posts').replaceChildren();let running=false;
  if(!posts.length)$('posts').append(node('div','Your publishing results will appear here.','empty'));
  const labels={'not-connected':'Not connected',skipped:'Not included',queued:'Waiting',publishing:'Publishing…',published:'Published',processing:'Uploaded · processing',uploaded:'Uploaded · check visibility',failed:'Could not publish',check:'Check account'};
  for(const p of posts){
    const card=node('article',undefined,'post');card.append(node('p',(p.message||'Shalom Group '+(p.mediaKind||'update')).slice(0,200),'excerpt'),node('span',when(p.createdAt),'meta'));const results=node('div',undefined,'results');
    for(const [id,r] of Object.entries(p.results)){
      if(['queued','publishing'].includes(r.status))running=true;
      const item=node('div',undefined,'result '+r.status);item.append(node('strong',names[id]+' · '+(labels[r.status]||r.status)),node('div',r.accountName||'Account not connected'));if(r.message)item.append(node('div',r.message));
      if(r.url&&/^https:\/\/(www\.)?(facebook\.com|instagram\.com|linkedin\.com|youtube\.com|x\.com)\//.test(r.url)){const link=node('a','Open post ↗');link.href=r.url;link.target='_blank';link.rel='noopener';item.append(link);}results.append(item);
    }
    card.append(results);
    if(Object.values(p.results).some(r=>r.status==='failed')&&!Object.values(p.results).some(r=>['queued','publishing'].includes(r.status))){const retry=node('button','Retry failed accounts','btn');retry.type='button';retry.style.marginTop='14px';retry.onclick=async()=>{retry.disabled=true;try{await post('retry/'+p.id,{});await loadPosts();}catch(e){note(e.message,true);retry.disabled=false;}};card.append(retry);}
    $('posts').append(card);
  }
  clearTimeout(timer);if(running)timer=setTimeout(()=>loadPosts().catch(()=>{note('Could not refresh publishing results. Use Refresh to check.',true);}),5000);
}
async function loadChoices(){
  if(!pending||!/^[a-zA-Z0-9_-]{1,100}$/.test(pending))return;
  const list=await api('choices/'+pending);$('choices').hidden=false;
  for(const p of list){const label=node('label',undefined,'choice-row'),radio=document.createElement('input');radio.type='radio';radio.name='choice-'+p.platform;radio.value=p.index;label.append(radio,node('span',names[p.platform]+' — '+p.name));$('choice-list').append(label);}
  $('choose-form').onsubmit=async e=>{e.preventDefault();const indexes=Array.from($('choice-list').querySelectorAll('input:checked')).map(el=>Number(el.value));try{await post('choose',{pending,indexes});$('choices').hidden=true;history.replaceState({},'','/social-publisher.html');await loadAccounts();note('Accounts connected. Your next post will go to the names shown here.');}catch(err){note(err.message,true);}};
}
async function refresh(){await Promise.allSettled([loadAccounts().catch(e=>{note(e.message,true);$('accounts').textContent='Accounts could not be loaded. Use Refresh to try again.';}),loadDrafts().catch(()=>{$('drafts').textContent='Drafts could not be loaded. Use Refresh to try again.';}),loadPosts().catch(()=>{$('posts').textContent='Recent posts could not be loaded. Use Refresh to try again.';})]);}
$('refresh').onclick=refresh;
window.addEventListener('beforeunload',e=>{if(dirty||busy){e.preventDefault();e.returnValue='';}});
const notice=new URLSearchParams(location.search).get('notice');
if(notice==='setup'){$('setup').open=true;note('One-time server setup is needed to connect your Shalom Group accounts. You can save a draft now.');}
if(notice==='connection-failed')note('The account connection did not finish. Check the platform permissions and try Connect again.',true);
void refresh();void loadChoices().catch(e=>note(e.message,true));
})();
