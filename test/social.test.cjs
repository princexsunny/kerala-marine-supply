const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
const core=require('../server/social/core');
process.env.SOCIAL_TOKEN_KEY='ab'.repeat(32);
function load(file,stubs={}){const module={exports:{}};const filename=path.join(root,file);vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,require:n=>Object.hasOwn(stubs,n)?stubs[n]:require(n),process,console,Buffer,URL,URLSearchParams,FormData,Blob,AbortSignal,fetch:(...args)=>fetch(...args),setTimeout,clearTimeout,Date,Set,Map},{filename});return module.exports;}
test('account credentials encrypt, decrypt and reject tampering',()=>{
  const encrypted=core.encrypt({access_token:'private',refresh_token:'refresh'});assert(!encrypted.includes('private'));assert.equal(core.decrypt(encrypted).access_token,'private');
  const broken=encrypted.split('.');broken[1]=Buffer.from('tampered').toString('base64');assert.throws(()=>core.decrypt(broken.join('.')));
});
test('missing encryption setup cannot connect or store tokens',()=>{
  const saved=process.env.SOCIAL_TOKEN_KEY;delete process.env.SOCIAL_TOKEN_KEY;assert.throws(()=>core.encrypt({access_token:'private'}));assert.equal(core.configured('facebook'),false);process.env.SOCIAL_TOKEN_KEY=saved;
});
test('platform compatibility never silently publishes image-only content to YouTube',()=>{
  const image={message:'Shalom update',media:{kind:'image'}};assert.match(core.eligible('youtube',image),/video/);assert.equal(core.eligible('instagram',image),null);assert.match(core.eligible('instagram',{message:'Hello'}),/image or video/);assert.match(core.eligible('x',{message:'a'.repeat(281)}),/Shorten/);assert.equal(core.eligible('x',{message:'Hello https://example.com/'+ 'a'.repeat(300)}),null);assert.throws(()=>core.validateDraft({}));
});
const calls=[];let replies=[];
function mockFetch(){global.fetch=async(url,opts={})=>{calls.push({url:String(url),opts});const r=replies.shift();if(r instanceof Error)throw r;if(typeof r==='function')return r(url,opts);return new Response(r?.body===undefined?'{}':JSON.stringify(r.body),{status:r?.status||200,headers:r?.headers||{}});};calls.length=0;}
const publisher=load('server/social/publishers.js',{'./core':{...core,sleep:async()=>{}},'./accounts':{GRAPH:'https://graph.facebook.com/v26.0',LI_HEADERS:{'LinkedIn-Version':'202610','X-Restli-Protocol-Version':'2.0.0'}}});
test('native Facebook and X text publishing use explicit authorisation and return real references',async()=>{
  mockFetch();replies=[{body:{id:'page_post'}}];let r=await publisher.facebook({id:'page'},'secret',{message:'Hello'},null);assert.equal(r.status,'published');assert.equal(r.id,'page_post');assert.equal(calls[0].opts.headers.Authorization,'Bearer secret');
  calls.length=0;replies=[{body:{data:{id:'123'}}}];r=await publisher.x({id:'x'},'secret',{message:'Hello'},null);assert.equal(r.url,'https://x.com/i/web/status/123');assert.equal(JSON.parse(calls[0].opts.body).text,'Hello');
});
test('Instagram waits for processing and publishes its returned container',async()=>{
  mockFetch();replies=[{body:{id:'container'}},{body:{status_code:'IN_PROGRESS'}},{body:{status_code:'FINISHED'}},{body:{id:'post'}},{body:{permalink:'https://www.instagram.com/p/example/'}}];
  const r=await publisher.instagram({id:'ig'},'secret',{message:'Hello',media:{kind:'video'}},{url:'https://storage.googleapis.com/clip'});assert.equal(r.id,'post');assert.equal(JSON.parse(calls[3].opts.body).creation_id,'container');assert.equal(JSON.parse(calls[0].opts.body).media_type,'REELS');
});
test('X media upload uses v2 initialize, append and finalize before posting',async()=>{
  mockFetch();replies=[{body:{data:{id:'media'}}},{},{body:{data:{}}},{body:{data:{id:'posted'}}}];
  await publisher.x({},'secret',{message:'Photo',media:{kind:'image',contentType:'image/jpeg',name:'photo.jpg'}},{bytes:Buffer.from('image')});
  assert(calls[0].url.endsWith('/initialize'));assert(calls[1].url.endsWith('/media/append'));assert(calls[2].url.endsWith('/media/finalize'));assert.equal(JSON.parse(calls[3].opts.body).media.media_ids[0],'media');
});
test('LinkedIn image is uploaded and available before company posting',async()=>{
  mockFetch();replies=[{body:{value:{image:'urn:li:image:1',uploadUrl:'https://www.linkedin.com/upload'}}},{},{body:{status:'AVAILABLE'}},{status:201,headers:{'x-restli-id':'urn:li:share:1'}}];
  const r=await publisher.linkedin({id:'urn:li:organization:123'},'secret',{message:'Hello',media:{kind:'image',contentType:'image/jpeg'}},{bytes:Buffer.from('image')});assert.equal(r.status,'published');assert.equal(JSON.parse(calls[3].opts.body).author,'urn:li:organization:123');assert.equal(JSON.parse(calls[3].opts.body).content.media.id,'urn:li:image:1');
});
test('YouTube reports processing rather than claiming upload is already public',async()=>{
  mockFetch();replies=[{headers:{location:'https://www.googleapis.com/upload/session'}},{body:{id:'vid',status:{privacyStatus:'public'}}}];
  const r=await publisher.youtube({id:'channel'},'secret',{message:'Boat yard progress\nDetails',media:{kind:'video',contentType:'video/mp4'}},{bytes:Buffer.from('video')});assert.equal(r.status,'processing');const body=JSON.parse(calls[0].opts.body);assert.equal(body.snippet.title,'Boat yard progress');assert.equal(body.status.privacyStatus,'public');assert.equal(body.status.selfDeclaredMadeForKids,false);
  replies=[{body:{items:[{status:{privacyStatus:'public',uploadStatus:'processed'}}]}}];assert.equal((await publisher.check('youtube',{id:'vid'},'secret')).status,'published');
});
test('uncertain final writes cannot be mistaken for retryable failures and secrets stay private',async()=>{
  mockFetch();replies=[new Error('private token leaked?')];await assert.rejects(publisher.facebook({id:'page'},'secret',{message:'Hello'},null),e=>e.uncertain===true&&!e.message.includes('private token'));
  replies=[{status:403,body:{error:{message:'secret diagnostic'}}}];await assert.rejects(publisher.facebook({id:'page'},'secret',{message:'Hello'},null),e=>e.uncertain===false&&!e.message.includes('secret diagnostic'));
});
function memoryDB(){
  const records=new Map();const clone=x=>x===undefined?undefined:structuredClone(x);
  function ref(collection,id){const key=collection+'/'+id;return {key,id,async get(){const data=clone(records.get(key));return {id,exists:data!==undefined,data:()=>data};},async set(d){records.set(key,clone(d));},async update(d){records.set(key,{...records.get(key),...clone(d)});},async delete(){records.delete(key);}};}
  const db={collection(name){const q={doc:id=>ref(name,id),orderBy(){return q;},limit(){return q;},async get(){return {docs:[...records].filter(([k])=>k.startsWith(name+'/')).map(([k,v])=>({id:k.slice(name.length+1),data:()=>clone(v)}))};}};return q;},async runTransaction(fn){return fn({get:r=>r.get(),create:(r,d)=>r.set(d),set:(r,d)=>r.set(d),update:(r,d)=>r.update(d),delete:r=>r.delete()});},batch(){const tasks=[];return {set:(r,d)=>tasks.push(()=>r.set(d)),delete:r=>tasks.push(()=>r.delete()),async commit(){for(const t of tasks)await t();}};}};
  return {db,records};
}
function appHarness(){
  const mem=memoryDB(),routes=[],middleware=[],connections={facebook:{id:'page',name:'Shalom Group',secret:'not-for-browser'},x:{id:'x',name:'@shalomgroup',secret:'not-for-browser'}};
  const router={use:f=>middleware.push(f),get:(p,...handlers)=>routes.push({method:'GET',p,handlers}),post:(p,...handlers)=>routes.push({method:'POST',p,handlers})};
  const counts={facebook:0,x:0};let rejectX=false;
  const pubs={facebook:async()=>{counts.facebook++;return {status:'published',id:'fb',url:'https://www.facebook.com/fb',message:'Published'};},x:async()=>{counts.x++;if(rejectX){rejectX=false;throw new core.PlatformError('The platform could not accept this post.');}return {status:'published',id:'xp',url:'https://x.com/i/web/status/xp'};},check:async()=>({})};
  function multer(){return {single:()=>((req,res,next)=>next())};}multer.memoryStorage=()=>({});
  load('server/routes/social.js',{'express':{Router:()=>router},multer,'../firebase':{admin:{storage:()=>({bucket:()=>({file:()=>({save:async()=>{},download:async()=>[Buffer.from('bytes')],getSignedUrl:async()=>['https://storage.googleapis.com/file']})})})}},'../social/core':core,'../social/publishers':pubs,'../social/accounts':{db:()=>mem.db,connections:async()=>connections,access:async()=> 'token'}});
  async function dispatch(method,url,body={},custom={}){
    let selected,params={};for(const r of routes){if(r.method!==method)continue;const keys=[];const re=new RegExp('^'+r.p.replace(/:([a-zA-Z]+)/g,(_,k)=>{keys.push(k);return '([^/]+)';})+'$');const match=url.match(re);if(match){selected=r;keys.forEach((k,i)=>params[k]=match[i+1]);break;}}
    assert(selected,url);return new Promise((resolve,reject)=>{
      const req={method,body,params,query:{},get:n=>({'Origin':'https://keralamarinesupply.in','X-KMS-Social':'1',...custom.headers})[n],...custom};
      const res={code:200,setHeader(){},status(n){this.code=n;return this;},json(data){resolve({status:this.code,body:structuredClone(data)});},redirect(code,url){resolve({status:code,url});}};
      const handlers=[...middleware,...selected.handlers];let i=0;function next(){const handler=handlers[i++];if(!handler)return;try{const p=handler(req,res,next);if(p?.catch)p.catch(reject);}catch(e){reject(e);}}next();
    });
  }
  return {...mem,dispatch,connections,counts,rejectNextX:()=>{rejectX=true;}};
}
const settle=async()=>{for(let i=0;i<25;i++)await new Promise(resolve=>setImmediate(resolve));};
test('server status hides credentials; mutation routes reject foreign origins',async()=>{
  const h=appHarness();const r=await h.dispatch('GET','/social/status');assert.equal(r.body.platforms.length,5);assert(!JSON.stringify(r.body).includes('not-for-browser'));const rejected=await h.dispatch('POST','/social/publish',{}, {headers:{Origin:'https://evil.example'}});assert.equal(rejected.status,403);
});
test('cloud drafts persist, validate input and reject disguised files',async()=>{
  const h=appHarness();let r=await h.dispatch('POST','/social/drafts',{message:'Shalom progress'});assert.equal(r.status,200);assert(h.records.has('socialDrafts/'+r.body.id));
  r=await h.dispatch('POST','/social/drafts',{message:''});assert.equal(r.status,400);
  r=await h.dispatch('POST','/social/drafts',{message:'test'},{file:{buffer:Buffer.from('not a jpeg'),size:10,mimetype:'image/jpeg',originalname:'bad.jpg'}});assert.equal(r.status,400);
});
test('duplicate publish requests send once; retry sends only failed platforms',async()=>{
  const h=appHarness();h.rejectNextX();const d=await h.dispatch('POST','/social/drafts',{message:'Shalom update'});
  const body={draftId:d.body.id,requestId:'request-one'};let r=await h.dispatch('POST','/social/publish',body);assert.equal(r.status,202);await settle();
  assert.equal(h.counts.facebook,1);assert.equal(h.counts.x,1);
  await h.dispatch('POST','/social/publish',body);await settle();assert.equal(h.counts.facebook,1);assert.equal(h.counts.x,1);
  const job=h.records.get('socialPosts/request-one');assert.equal(job.results.facebook.status,'published');assert.equal(job.results.instagram.status,'not-connected');assert.equal(job.results.x.status,'failed');
  await h.dispatch('POST','/social/retry/request-one');await settle();assert.equal(h.counts.facebook,1);assert.equal(h.counts.x,2);assert.equal(h.records.get('socialPosts/request-one').results.x.status,'published');
});
test('restart reconciliation protects uncertain sends; no accounts cannot publish',async()=>{
  const h=appHarness();h.records.set('socialPosts/interrupted',{draftId:'draft',draft:{message:'Saved'},createdAt:new Date().toISOString(),results:{facebook:{status:'publishing'},x:{status:'queued'}}});
  const r=await h.dispatch('GET','/social/posts');assert.equal(r.body[0].results.facebook.status,'check');assert.equal(r.body[0].results.x.status,'failed');
  delete h.connections.facebook;delete h.connections.x;const d=await h.dispatch('POST','/social/drafts',{message:'No destinations'});assert.equal((await h.dispatch('POST','/social/publish',{draftId:d.body.id,requestId:'no-account'})).status,400);assert.equal(h.counts.facebook,0);
});
test('OAuth states are single-use, expire, and are bound to the signed-in session',async()=>{
  const mem=memoryDB();process.env.X_CLIENT_ID='id';process.env.X_CLIENT_SECRET='secret';
  const a=load('server/social/accounts.js',{'../firebase':{admin:{firestore:()=>mem.db},init(){}},'../session':{COOKIE_NAME:'session',parseCookies:req=>({session:req.cookie})},'./core':core});
  const url=new URL(await a.begin('x',{cookie:'owner'}));assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  const state=url.searchParams.get('state');await assert.rejects(a.complete('x',{cookie:'other',query:{state,code:'code'}}));
  const ref=[...mem.records.keys()][0];assert(mem.records.has(ref));mem.records.get(ref).expires=Date.now()-1;await assert.rejects(a.complete('x',{cookie:'owner',query:{state,code:'code'}}));
  const fresh=new URL(await a.begin('x',{cookie:'owner'})),freshState=fresh.searchParams.get('state');mockFetch();replies=[{body:{access_token:'new-private-token',expires_in:7200}},{body:{data:{id:'shalom-x',username:'shalomgroup'}}}];
  const pending=await a.complete('x',{cookie:'owner',query:{state:freshState,code:'code'}});assert(mem.records.has('socialPendingAccounts/'+pending));assert(!JSON.stringify(mem.records.get('socialPendingAccounts/'+pending)).includes('new-private-token'));
  await assert.rejects(a.complete('x',{cookie:'owner',query:{state:freshState,code:'code'}}));
  await a.select(pending,[0]);assert.equal(mem.records.get('socialConnections/x').name,'@shalomgroup');assert(!mem.records.has('socialPendingAccounts/'+pending));
  delete process.env.X_CLIENT_ID;delete process.env.X_CLIENT_SECRET;
});
test('the admin menu links to a private page behind admin authentication',()=>{
  const source=fs.readFileSync(path.join(root,'server/index.js'),'utf8');assert(source.includes("app.use('/api', adminAuth, socialRoutes)"));assert(source.includes("'social-publisher.html'"));assert(source.indexOf('PRIVATE_PAGES.forEach')<source.indexOf('express.static(PUBLIC_DIR'));assert(fs.readFileSync(path.join(root,'public/admin.html'),'utf8').includes('href="social-publisher.html"'));
});
