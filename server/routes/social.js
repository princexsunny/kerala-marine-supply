'use strict';
const express=require('express'),multer=require('multer'),crypto=require('crypto');
const {admin}=require('../firebase');
const accounts=require('../social/accounts');
const publishers=require('../social/publishers');
const {PLATFORMS,NAMES,configured,provider,baseUrl,validId,validateDraft,eligible}=require('../social/core');
const router=express.Router(),active=new Set();
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:50*1024*1024,files:1,fields:5,fieldSize:24000}}).single('file');
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(err=>{
  const known=err.publicMessage;
  res.status(err.status||500).json({error:known||'Could not complete this action. Please try again or check the account setup.'});
});
function fail(message,status=400){const e=new Error(message);e.publicMessage=message;e.status=status;throw e;}
const safe=fn=>async(...args)=>{try{return await fn(...args);}catch(e){if(!e.publicMessage)e.publicMessage=e.message;e.status=400;throw e;}};
router.use((req,res,next)=>{
  res.setHeader('Cache-Control','no-store, private');
  if(['POST','PUT','DELETE','PATCH'].includes(req.method)){
    if(req.get('X-KMS-Social')!=='1'||req.get('Origin')!==new URL(baseUrl()).origin)return res.status(403).json({error:'Open Social Publisher on the website and try again.'});
  }
  next();
});
router.get('/social/status',wrap(async(req,res)=>{
  const all=await accounts.connections();
  res.json({brand:'Shalom Group',platforms:PLATFORMS.map(id=>({id,name:NAMES[id],connected:!!all[id],accountName:all[id]?.name||null,canConnect:configured(id),connectUrl:'/api/social/connect/'+provider(id)}))});
}));
router.get('/social/connect/:provider',wrap(async(req,res)=>{
  if(!['meta','linkedin','youtube','x'].includes(req.params.provider))fail('Unknown platform.');
  if(!configured(req.params.provider))return res.redirect(303,'/social-publisher.html?notice=setup');
  res.redirect(302,await accounts.begin(req.params.provider,req));
}));
router.get('/social/callback/:provider',async(req,res)=>{
  try{
    if(!['meta','linkedin','youtube','x'].includes(req.params.provider))throw new Error();
    if(req.query.error)throw new Error();
    const pending=await accounts.complete(req.params.provider,req);
    res.redirect(303,'/social-publisher.html?accounts='+encodeURIComponent(pending));
  }catch{res.redirect(303,'/social-publisher.html?notice=connection-failed');}
});
router.get('/social/choices/:id',wrap(async(req,res)=>{
  if(!validId(req.params.id))fail('Invalid account selection.');
  const p=await accounts.choices(req.params.id);
  res.json(p.candidates.map((a,index)=>({index,platform:a.platform,name:a.name,id:a.id})));
}));
router.post('/social/choose',wrap(async(req,res)=>{
  if(!validId(req.body.pending)||!Array.isArray(req.body.indexes)||req.body.indexes.some(i=>!Number.isInteger(i)||i<0))fail('Choose your Shalom Group account.');
  await accounts.select(req.body.pending,req.body.indexes);res.json({ok:true});
}));
router.post('/social/disconnect/:platform',wrap(async(req,res)=>{
  if(!PLATFORMS.includes(req.params.platform))fail('Unknown platform.');
  await accounts.db().collection('socialConnections').doc(req.params.platform).delete();res.json({ok:true});
}));
async function getDraft(id){
  if(!validId(id))fail('Invalid draft.');
  const snap=await accounts.db().collection('socialDrafts').doc(id).get();if(!snap.exists)fail('Draft not found.',404);return snap.data();
}
router.get('/social/drafts',wrap(async(req,res)=>{
  const snap=await accounts.db().collection('socialDrafts').orderBy('updatedAt','desc').limit(30).get();res.json(snap.docs.map(d=>({id:d.id,...d.data()})));
}));
router.post('/social/drafts',(req,res,next)=>{
  upload(req,res,err=>{if(err)return res.status(400).json({error:err.code==='LIMIT_FILE_SIZE'?'Choose a video under 50 MB or an image under 10 MB.':'The upload could not be read. Choose one image or MP4 video.'});next();});
},wrap(async(req,res)=>{
  const id=req.body.id||crypto.randomUUID();if(!validId(id))fail('Invalid draft.');
  const ref=accounts.db().collection('socialDrafts').doc(id),snap=await ref.get();
  const previous=snap.data();let media=req.body.removeMedia==='true'?null:previous?.media||null;
  if(req.file){
    const file=req.file,b=file.buffer;
    const jpeg=b.length>3&&b[0]===255&&b[1]===216&&b[2]===255;
    const mp4=b.length>12&&b.toString('ascii',4,8)==='ftyp';
    if(!jpeg&&!mp4)fail('Choose a JPEG image or MP4 video.');
    if(jpeg&&file.size>10*1024*1024)fail('Choose an image under 10 MB.');
    const ext=jpeg?'jpg':'mp4',storagePath='social-publisher/'+id+'/'+crypto.randomUUID()+'.'+ext;
    const contentType=jpeg?'image/jpeg':'video/mp4';
    // Validate the text before persisting the file, not afterwards.
    await safe(async()=>validateDraft({message:req.body.message,title:req.body.title,media:{kind:jpeg?'image':'video'}}))();
    await admin.storage().bucket().file(storagePath).save(b,{resumable:false,contentType,metadata:{cacheControl:'private, no-store'}});
    media={kind:jpeg?'image':'video',contentType,storagePath,name:String(file.originalname||'upload.'+ext).slice(0,150),size:file.size};
  }
  const draft=await safe(async()=>validateDraft({message:req.body.message,title:req.body.title,media}))();
  draft.updatedAt=new Date().toISOString();draft.createdAt=previous?.createdAt||draft.updatedAt;
  await ref.set(draft);res.json({id,...draft});
}));
router.get('/social/media/:id',wrap(async(req,res)=>{
  const d=await getDraft(req.params.id);if(!d.media)fail('No attachment.',404);
  const file=admin.storage().bucket().file(d.media.storagePath);
  res.type(d.media.contentType);res.setHeader('Content-Length',String(d.media.size));
  file.createReadStream().on('error',()=>{if(!res.headersSent)res.status(404).end();else res.destroy();}).pipe(res);
}));
function publicJob(id,j){return {id,draftId:j.draftId,message:j.draft.message,mediaKind:j.draft.media?.kind||null,createdAt:j.createdAt,results:j.results};}
async function runJob(id,retry=false){
  if(active.has(id))return;active.add(id);
  const ref=accounts.db().collection('socialPosts').doc(id);
  try{
    const snap=await ref.get();if(!snap.exists)return;const job=snap.data();
    const connected=await accounts.connections();let asset=null;
    if(job.draft.media){const file=admin.storage().bucket().file(job.draft.media.storagePath);const [bytes]=await file.download();const [url]=await file.getSignedUrl({action:'read',expires:Date.now()+3600000});asset={bytes,url};}
    for(const p of PLATFORMS){
      if(job.results[p]?.status!=='queued')continue;
      const now=connected[p];
      if(!now||now.id!==job.results[p].accountId){job.results[p]={...job.results[p],status:'failed',message:'Account changed or disconnected. Save a new draft before publishing.'};await ref.update({results:job.results});continue;}
      job.results[p]={...job.results[p],status:'publishing',startedAt:new Date().toISOString()};await ref.update({results:job.results});
      try{
        const token=await accounts.access(p,now);
        const result=await publishers[p](now,token,job.draft,asset);
        job.results[p]={...job.results[p],...result};
      }catch(e){job.results[p]={...job.results[p],status:e.uncertain?'check':'failed',message:e.message&&/^(Reconnect|The platform|Connection interrupted|Media is taking|Instagram|LinkedIn|X did|Check |YouTube|No post)/.test(e.message)?e.message:'Could not publish. Check the account connection and try again.'};}
      // A database write failure after publishing stops the job. It must not
      // be retried automatically, because the platform may already have posted.
      await ref.update({results:job.results});
    }
  }catch{
    // Preserve queued and in-flight states for reconciliation on the next read.
  }finally{active.delete(id);}
}
async function reconcile(id,job){
  if(active.has(id))return job;
  let changed=false;
  for(const p of PLATFORMS){
    const r=job.results[p];
    if(r?.status==='publishing'){r.status='check';r.message='Publishing was interrupted. Check this account before creating another post.';changed=true;}
    if(r?.status==='queued'){r.status='failed';r.message='Publishing stopped before this platform was sent. You can retry it.';changed=true;}
    if(['processing','uploaded'].includes(r?.status)&&['facebook','youtube'].includes(p)&&(!r.checkedAt||Date.now()-r.checkedAt>30000)){
      try{
        const c=(await accounts.connections())[p];
        if(c&&c.id===r.accountId){const token=await accounts.access(p,c);Object.assign(r,await publishers.check(p,r,token),{checkedAt:Date.now()});changed=true;}
      }catch{/* A failed status lookup cannot undo an accepted upload. */}
    }
  }
  if(changed)await accounts.db().collection('socialPosts').doc(id).update({results:job.results});
  return job;
}
router.post('/social/publish',wrap(async(req,res)=>{
  if(!validId(req.body.draftId)||!validId(req.body.requestId))fail('Save the draft before publishing.');
  const d=await getDraft(req.body.draftId),connected=await accounts.connections();
  const results={};let count=0;
  for(const p of PLATFORMS){const why=eligible(p,d);const c=connected[p];results[p]={status:!c?'not-connected':why?'skipped':'queued',accountName:c?.name||'',accountId:c?.id||'',message:!c?'Connect this account first.':why||'Waiting to publish'};if(results[p].status==='queued')count++;}
  if(!count)fail('No connected accounts can publish this content. Connect an account or change the attachment.');
  const id=req.body.requestId,ref=accounts.db().collection('socialPosts').doc(id);
  const existing=await accounts.db().runTransaction(async tx=>{const snap=await tx.get(ref);if(snap.exists){if(snap.data().draftId!==req.body.draftId)fail('This publishing request belongs to another draft.');return true;}tx.create(ref,{draftId:req.body.draftId,draft:d,createdAt:new Date().toISOString(),results});return false;});
  if(!existing)void runJob(id);
  res.status(202).json({id});
}));
router.get('/social/posts',wrap(async(req,res)=>{
  const snap=await accounts.db().collection('socialPosts').orderBy('createdAt','desc').limit(20).get();const posts=[];
  for(const d of snap.docs)posts.push(publicJob(d.id,await reconcile(d.id,d.data())));
  res.json(posts);
}));
router.post('/social/retry/:id',wrap(async(req,res)=>{
  if(!validId(req.params.id))fail('Invalid post.');const ref=accounts.db().collection('socialPosts').doc(req.params.id);
  await accounts.db().runTransaction(async tx=>{
    const snap=await tx.get(ref);if(!snap.exists)fail('Post not found.',404);const job=snap.data();
    if(active.has(req.params.id)||Object.values(job.results).some(r=>['publishing','queued'].includes(r.status)))fail('This post is still publishing.');
    let n=0;for(const p of PLATFORMS)if(job.results[p]?.status==='failed'){job.results[p].status='queued';job.results[p].message='Waiting to retry';n++;}
    if(!n)fail('There are no failed platforms to retry.');tx.update(ref,{results:job.results});
  });
  void runJob(req.params.id,true);res.status(202).json({id:req.params.id});
}));
module.exports=router;
