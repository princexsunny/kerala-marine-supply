'use strict';
const {request,json,postJson,sleep,PlatformError}=require('./core');
const {GRAPH,LI_HEADERS}=require('./accounts');
async function waitFor(check){
  for(let i=0;i<40;i++){const state=await check();if(state===true)return;if(state===false)throw new PlatformError('The platform rejected the media. Check its video or image requirements.');await sleep(3000);}
  throw new PlatformError('Media is taking longer to process. Try again later.');
}
function uploadForm(bytes,media,fields){const f=new FormData();for(const [k,v]of Object.entries(fields))f.append(k,String(v));f.append('source',new Blob([bytes],{type:media.contentType}),media.name);return f;}
function safeUpload(url,domain){const u=new URL(url);if(u.protocol!=='https:'||!(u.hostname===domain||u.hostname.endsWith('.'+domain)))throw new PlatformError('The platform returned an unexpected upload address.');return u.href;}
async function facebook(c,token,d,asset){
  const headers={Authorization:'Bearer '+token};let result;
  if(!d.media)result=await postJson(GRAPH+'/'+c.id+'/feed',{message:d.message},headers,true);
  else if(d.media.kind==='image')result=await json(GRAPH+'/'+c.id+'/photos',{method:'POST',headers,body:uploadForm(asset.bytes,d.media,{caption:d.message,published:true})},true);
  else result=await json('https://graph-video.facebook.com/'+GRAPH.split('/').pop()+'/'+c.id+'/videos',{method:'POST',headers,body:uploadForm(asset.bytes,d.media,{description:d.message,title:d.title||d.message.slice(0,80)||'Shalom Group'})},true);
  const id=result.post_id||result.id;if(!id)throw new PlatformError('No post reference was returned. Check Facebook before posting again.',true);
  return {status:d.media?.kind==='video'?'processing':'published',id,url:'https://www.facebook.com/'+id,message:d.media?.kind==='video'?'Uploaded to Facebook. Video processing may take a few minutes.':'Published'};
}
async function instagram(c,token,d,asset){
  const headers={Authorization:'Bearer '+token};
  const body=d.media.kind==='video'?{media_type:'REELS',video_url:asset.url,caption:d.message,share_to_feed:true}:{image_url:asset.url,caption:d.message};
  const container=await postJson(GRAPH+'/'+c.id+'/media',body,headers);
  if(!container.id)throw new PlatformError('Instagram did not accept the media.');
  await waitFor(async()=>{const s=await json(GRAPH+'/'+container.id+'?fields=status_code',{headers});return s.status_code==='FINISHED'?true:['ERROR','EXPIRED'].includes(s.status_code)?false:null;});
  const result=await postJson(GRAPH+'/'+c.id+'/media_publish',{creation_id:container.id},headers,true);
  if(!result.id)throw new PlatformError('Check Instagram before posting again.',true);
  // A permalink lookup failing must never turn a successful publish into a retry.
  let url='https://www.instagram.com/';try{url=(await json(GRAPH+'/'+result.id+'?fields=permalink',{headers})).permalink||url;}catch{}
  return {status:'published',id:result.id,url,message:'Published'};
}
async function linkedin(c,token,d,asset){
  const headers={Authorization:'Bearer '+token,...LI_HEADERS};let mediaId;
  if(d.media){
    const kind=d.media.kind==='video'?'videos':'images';
    const init=await postJson('https://api.linkedin.com/rest/'+kind+'?action=initializeUpload',{initializeUploadRequest:{owner:c.id,...(kind==='videos'?{fileSizeBytes:asset.bytes.length,uploadCaptions:false,uploadThumbnail:false}:{})}},headers);
    const value=init.value||{};mediaId=value.video||value.image;
    if(!mediaId)throw new PlatformError('LinkedIn did not accept the media.');
    if(kind==='videos'){
      const parts=[];
      for(const part of value.uploadInstructions||[]){const r=await request(safeUpload(part.uploadUrl,'linkedin.com'),{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:asset.bytes.subarray(part.firstByte,part.lastByte+1)});const etag=r.headers.get('etag');if(!etag)throw new PlatformError('LinkedIn could not finish the video upload.');parts.push(etag.replace(/"/g,''));}
      await postJson('https://api.linkedin.com/rest/videos?action=finalizeUpload',{finalizeUploadRequest:{video:mediaId,uploadToken:value.uploadToken||'',uploadedPartIds:parts}},headers);
    }else await request(safeUpload(value.uploadUrl,'linkedin.com'),{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':d.media.contentType},body:asset.bytes});
    await waitFor(async()=>{const s=await json('https://api.linkedin.com/rest/'+kind+'/'+encodeURIComponent(mediaId),{headers});return s.status==='AVAILABLE'?true:['PROCESSING_FAILED','FAILED'].includes(s.status)?false:null;});
  }
  const body={author:c.id,commentary:d.message,visibility:'PUBLIC',distribution:{feedDistribution:'MAIN_FEED',targetEntities:[],thirdPartyDistributionChannels:[]},lifecycleState:'PUBLISHED',isReshareDisabledByAuthor:false};
  if(mediaId)body.content={media:{id:mediaId,title:d.title||'Shalom Group update'}};
  const r=await request('https://api.linkedin.com/rest/posts',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)},true);
  const id=r.headers.get('x-restli-id');if(!id)throw new PlatformError('Check LinkedIn before posting again.',true);
  return {status:'published',id,url:'https://www.linkedin.com/feed/update/'+encodeURIComponent(id)+'/',message:'Published'};
}
async function youtube(c,token,d,asset){
  const headers={Authorization:'Bearer '+token};
  const title=(d.title||d.message.split('\n')[0]||'Shalom Group update').replace(/[<>]/g,'').slice(0,100);
  const init=await request('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',{method:'POST',headers:{...headers,'Content-Type':'application/json','X-Upload-Content-Type':d.media.contentType,'X-Upload-Content-Length':String(asset.bytes.length)},body:JSON.stringify({snippet:{title,description:d.message,categoryId:'22'},status:{privacyStatus:'public',selfDeclaredMadeForKids:false}})});
  const upload=safeUpload(init.headers.get('location'),'googleapis.com');
  const result=await json(upload,{method:'PUT',headers:{'Content-Type':d.media.contentType},body:asset.bytes},true);
  if(!result.id)throw new PlatformError('Check YouTube Studio before uploading again.',true);
  return {status:result.status?.privacyStatus==='public'?'processing':'uploaded',id:result.id,url:'https://www.youtube.com/watch?v='+result.id,message:result.status?.privacyStatus==='public'?'Uploaded to YouTube. Video processing may take a few minutes.':'Uploaded, but YouTube has not made it public. Check YouTube Studio.'};
}
async function x(c,token,d,asset){
  const headers={Authorization:'Bearer '+token};let mediaId;
  if(d.media){
    const init=await postJson('https://api.x.com/2/media/upload/initialize',{media_type:d.media.contentType,total_bytes:asset.bytes.length,media_category:d.media.kind==='video'?'tweet_video':'tweet_image'},headers);
    mediaId=init.data?.id;if(!mediaId)throw new PlatformError('X did not accept the media.');
    for(let offset=0,index=0;offset<asset.bytes.length;offset+=4*1024*1024,index++){
      const form=new FormData();form.append('segment_index',String(index));form.append('media',new Blob([asset.bytes.subarray(offset,offset+4*1024*1024)],{type:d.media.contentType}),d.media.name);
      await request('https://api.x.com/2/media/upload/'+mediaId+'/append',{method:'POST',headers,body:form});
    }
    const done=await json('https://api.x.com/2/media/upload/'+mediaId+'/finalize',{method:'POST',headers});
    if(done.data?.processing_info)await waitFor(async()=>{const s=await json('https://api.x.com/2/media/upload?command=STATUS&media_id='+mediaId,{headers});const state=s.data?.processing_info?.state;return state==='succeeded'?true:state==='failed'?false:null;});
  }
  const result=await postJson('https://api.x.com/2/tweets',{text:d.message,...(mediaId?{media:{media_ids:[mediaId]}}:{})},headers,true);
  if(!result.data?.id)throw new PlatformError('Check X before posting again.',true);
  return {status:'published',id:result.data.id,url:'https://x.com/i/web/status/'+result.data.id,message:'Published'};
}
async function check(platform,result,token){
  const headers={Authorization:'Bearer '+token};
  if(platform==='facebook'){
    const data=await json(GRAPH+'/'+encodeURIComponent(result.id)+'?fields=status',{headers});
    if(data.status?.publishing_phase?.publish_status==='published')return {status:'published',message:'Published'};
    if(['error','expired','upload_failed'].includes(data.status?.video_status))return {status:'check',message:'Facebook could not process this upload. Check the video on Facebook.'};
  }
  if(platform==='youtube'){
    const data=await json('https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails&id='+encodeURIComponent(result.id),{headers});
    const video=data.items?.[0];
    if(video?.status?.privacyStatus==='public'&&video.status.uploadStatus==='processed')return {status:'published',message:'Published'};
    if(video&&['failed','rejected','deleted'].includes(video.status?.uploadStatus))return {status:'check',message:'YouTube could not publish this upload. Check YouTube Studio.'};
    if(video?.status?.privacyStatus!=='public')return {status:'uploaded',message:'Uploaded, but not public. Check YouTube Studio.'};
  }
  return {};
}
module.exports={facebook,instagram,linkedin,youtube,x,check};
