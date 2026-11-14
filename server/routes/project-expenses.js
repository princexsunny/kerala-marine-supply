'use strict';
const express=require('express'),crypto=require('crypto');
const {admin,init}=require('../firebase');
const model=require('../../public/project-expense-model');
const router=express.Router();
const validId=id=>/^[a-zA-Z0-9_-]{1,100}$/.test(id);
router.use((req,res,next)=>{
  res.setHeader('Cache-Control','no-store, private');
  if(['POST','PUT'].includes(req.method)){
    let allowed=false;try{allowed=new URL(req.get('Origin')).origin===new URL(process.env.SOCIAL_BASE_URL||'https://keralamarinesupply.in').origin;}catch{}
    if(!allowed)return res.status(403).json({error:'Open the calculator on your website and try again.'});
  }
  next();
});
const db=()=>{init();return admin.firestore().collection('expenseProjects');};
const wrap=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){res.status(e.status||500).json({error:e.status?e.message:'Could not access projects. Please try again. Your form is still open.'});}};
function readBody(req){try{const p=model.validate(req.body?.project);if(Buffer.byteLength(JSON.stringify(p),'utf8')>400*1024)throw Error('This project is too large. Download a backup and start another project.');return p;}catch(e){e.status=400;throw e;}}
router.get('/expense-projects',wrap(async(req,res)=>{
  const snap=await db().orderBy('name').get();
  res.json(snap.docs.map(d=>({id:d.id,name:d.data().name,updatedAt:d.data().updatedAt})));
}));
router.get('/expense-projects/:id',wrap(async(req,res)=>{
  if(!validId(req.params.id))return res.status(400).json({error:'Invalid project.'});
  const doc=await db().doc(req.params.id).get();if(!doc.exists)return res.status(404).json({error:'Project not found.'});
  const d=doc.data();res.json({id:doc.id,revision:d.revision,project:JSON.parse(d.json),updatedAt:d.updatedAt});
}));
router.post('/expense-projects',wrap(async(req,res)=>{
  const p=readBody(req),id=crypto.randomUUID(),updatedAt=new Date().toISOString();
  await db().doc(id).create({name:p.name,json:JSON.stringify(p),revision:1,updatedAt});
  res.status(201).json({id,revision:1,project:p,updatedAt});
}));
router.put('/expense-projects/:id',wrap(async(req,res)=>{
  if(!validId(req.params.id))return res.status(400).json({error:'Invalid project.'});
  const p=readBody(req),expected=req.body.revision;
  if(!Number.isSafeInteger(expected)||expected<1)return res.status(400).json({error:'Reload this project before saving.'});
  const collection=db(),ref=collection.doc(req.params.id),updatedAt=new Date().toISOString();
  await admin.firestore().runTransaction(async tx=>{
    const doc=await tx.get(ref);if(!doc.exists){const e=new Error('Project not found.');e.status=404;throw e;}
    if(doc.data().revision!==expected){const e=new Error('This project was changed on another page or device. Your form is still here. Copy your entries, then reload the project before saving.');e.status=409;throw e;}
    tx.set(ref,{name:p.name,json:JSON.stringify(p),revision:expected+1,updatedAt});
  });
  res.json({id:req.params.id,revision:expected+1,project:p,updatedAt});
}));
const attachmentUpload=require('multer')({storage:require('multer').memoryStorage(),limits:{fileSize:5*1024*1024}}).single('file');
router.post('/expense-projects/:id/attachments',(req,res,next)=>attachmentUpload(req,res,e=>e?res.status(400).json({error:'Choose a PDF or image up to 5 MB.'}):next()),wrap(async(req,res)=>{
 if(!validId(req.params.id))return res.status(400).json({error:'Invalid project.'});const doc=await db().doc(req.params.id).get();if(!doc.exists)return res.status(404).json({error:'Project not found.'});const f=req.file,b=f?.buffer;const pdf=b?.subarray(0,5).toString()==='%PDF-',png=b?.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpg=b?.[0]===255&&b?.[1]===216&&b?.[2]===255,webp=b?.subarray(0,4).toString()==='RIFF'&&b?.subarray(8,12).toString()==='WEBP';if(!b||!(pdf||png||jpg||webp))return res.status(400).json({error:'Choose a PDF, JPG, PNG or WebP file.'});const id=crypto.randomUUID(),name=String(f.originalname||'Bill').slice(0,200);await admin.storage().bucket().file('project-bills/'+req.params.id+'/'+id).save(b,{contentType:pdf?'application/pdf':png?'image/png':jpg?'image/jpeg':'image/webp',metadata:{cacheControl:'private, no-store',metadata:{name}}});res.json({id,name});
}));
router.get('/expense-projects/:id/attachments/:attachment',wrap(async(req,res)=>{if(!validId(req.params.id)||!validId(req.params.attachment))return res.status(400).json({error:'Invalid attachment.'});const doc=await db().doc(req.params.id).get();if(!doc.exists)return res.status(404).json({error:'Project not found.'});const file=admin.storage().bucket().file('project-bills/'+req.params.id+'/'+req.params.attachment);const [exists]=await file.exists();if(!exists)return res.status(404).json({error:'Attachment not found.'});const [metadata]=await file.getMetadata(),[bytes]=await file.download();res.setHeader('Content-Type',metadata.contentType||'application/octet-stream');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(metadata.metadata?.name||'Bill'));res.send(bytes);}));
module.exports=router;
