import {fetchPoster} from '../lib/episode-posters.mjs';
import {decodePosterConfig,encodePosterConfig,ratedPoster} from '../public/poster-config.js';
import {readFileSync} from 'node:fs';import {fileURLToPath} from 'node:url';import path from 'node:path';import worker,{manifest as originalManifest,dataHealth} from '../lib/core.mjs';import {checkout,configuration} from '../lib/payments.mjs';
const SHARED_POSTER_RENDERER='https://great-indian-upcoming-posters.onrender.com';
export function buildSharedRendererUrl(type,id,justAdded=false,version='6'){
 const value=String(id||'');
 const v=/^\d{1,8}$/.test(String(version))?String(version):'6';
 const badge=justAdded?'badge=just-added&':'';
 if(/^tt\d{7,10}$/.test(value))return SHARED_POSTER_RENDERER+'/poster/'+value+'.jpg?'+badge+'v='+v;
 const tmdb=value.match(/^tmdb:(\d{1,12})$/);
 if(tmdb)return SHARED_POSTER_RENDERER+'/poster/tmdb/'+tmdb[1]+'.jpg?'+badge+'type='+(type==='movie'?'movie':'tv')+'&v='+v;
 return null;
}

async function resolveRendererId(id){
 const value=String(id||'');
 const tvmaze=value.match(/^tvmaze:(\\d{1,12})$/);
 if(!tvmaze)return value;
 try{
  const response=await fetch('https://api.tvmaze.com/shows/'+tvmaze[1],{cache:'no-store',signal:AbortSignal.timeout(7000)});
  if(!response.ok)return value;
  const show=await response.json();
  const imdb=show?.externals?.imdb;
  return typeof imdb==='string'&&/^tt\\d{7,10}$/.test(imdb)?imdb:value;
 }catch{return value;}
}
const legacy='https://dobins-indian-catalog.quickfield138.chatgpt.site';const raw='https://raw.githubusercontent.com/dobinmathew-beep/nuvio-cloud-refresher/dobins-catalog/dobins-indian-catalog/data/';const healthCache={};
function originFor(req){const configured=process.env.PUBLIC_ORIGIN;if(configured){const u=new URL(configured);if(u.protocol!=='https:')throw Error('PUBLIC_ORIGIN must use HTTPS');return u.origin}const host=req.headers.host;if(!host||!/^[a-zA-Z0-9.-]+(?::\d+)?$/.test(host))throw Error('Invalid host');return (host.startsWith('localhost')||host.startsWith('127.0.0.1')||host.startsWith('terminal.local:')?'http://':'https://')+host}
const replaceOrigin=(x,origin)=>typeof x==='string'?x.replaceAll(legacy,origin):Array.isArray(x)?x.map(v=>replaceOrigin(v,origin)):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,replaceOrigin(v,origin)])):x;
function buildManifest(origin,mask=255,standalone=false,posterTemplate=''){if(!Number.isInteger(mask)||mask<1||mask>255)return null;const m=replaceOrigin(originalManifest,origin);return {...m,id:m.id+(standalone?'.standalone':''),version:'2.3.3',name:'The Great Indian Addon'+(standalone?' (Standalone)':''),logo:origin+'/icon.png',catalogs:m.catalogs.filter((_,i)=>mask&(1<<i)),resources:standalone?[...m.resources,{name:'meta',types:['movie','series'],idPrefixes:m.idPrefixes}]:m.resources,behaviorHints:{configurable:true,configurationRequired:false},configurationURL:origin+'/configure'+(posterTemplate?'#bttr='+encodePosterConfig(posterTemplate)+'&catalogs='+mask.toString(16):'')}}
async function paymentHealth(){if(healthCache.at&&Date.now()-healthCache.at<60000)return healthCache.value;let saved={};try{const r=await fetch(raw+'payment-health.json?minute='+Math.floor(Date.now()/60000),{signal:AbortSignal.timeout(5000)});if(r.ok)saved=await r.json()}catch{}const c=configuration();let gatewayAvailable=false;if(c.ready){try{const probe=await fetch(c.url,{method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(8000)});gatewayAvailable=probe.status>=200&&probe.status<400}catch{}}const result={state:c.ready?(gatewayAvailable?'ok':'degraded'):'not-configured',lastCheckedAt:saved.checkedAt||null,checkout:{ready:c.ready&&gatewayAvailable,configured:c.ready,provider:'Bank Muscat',amountMode:c.mode},checks:saved.checks||[],note:'Availability checks never charge a payment method.'};healthCache.at=Date.now();healthCache.value=result;return result}
const ratingId=m=>[m?.id,m?.imdb_id,m?.imdbId,m?.imdb,m?.externals?.imdb,m?.externalIds?.imdb,m?.ids?.imdb].find(v=>typeof v==='string'&&/^tt[0-9]+$/.test(v))||'';
export function buildConfiguredPosterUrl(m,origin,posterBase,_posterTemplate){
 const posterId=ratingId(m)||String(m?.id||'');
 const query=m?.justAdded===true?'?badge=just-added&v=6':'?v=6';
 return origin+posterBase+'/poster/'+m.type+'/'+posterId+'.jpg'+query;
}
export {buildManifest,replaceOrigin};
export default async function handler(req,res){const send=(status,body,extra={})=>{res.statusCode=status;for(const [k,v] of Object.entries({'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, HEAD, OPTIONS, POST','Access-Control-Allow-Headers':'Content-Type','Cache-Control':'no-store',...extra}))res.setHeader(k,v);res.end(req.method==='HEAD'?undefined:JSON.stringify(body))};try{const origin=originFor(req);const incoming=new URL(req.url,origin);const candidate=req.query?.path||incoming.searchParams.get('path');
const candidateUrl=new URL(typeof candidate==='string'?candidate:incoming.pathname,origin);
if(candidateUrl.origin!==origin)return send(400,{error:'Invalid internal route.'});
let route=candidateUrl.pathname;
const requestParams=new URLSearchParams(incoming.search);
requestParams.delete('path');
for(const [key,value] of candidateUrl.searchParams)if(!requestParams.has(key))requestParams.append(key,value);
let scopeMask=255,posterTemplate='';const scoped=route.match(/^\/install\/([a-fA-F0-9]{1,2})(?:\/bttr\/([A-Za-z0-9_-]+))?(\/.*)$/);if(scoped){scopeMask=parseInt(scoped[1],16);if(!scopeMask)return send(400,{error:'Select at least one catalog.'});if(scoped[2]){try{posterTemplate=decodePosterConfig(scoped[2])}catch{return send(400,{error:'Invalid poster configuration.'})}}route=scoped[3]}else if(route.startsWith('/standalone/')&&route!=='/standalone/manifest.json')route=route.slice('/standalone'.length);
 if(req.method==='OPTIONS')return send(204,{});
 if(route==='/api/checkout'){if(req.method!=='POST')return send(405,{error:'Use POST.'});if(req.headers.origin&&req.headers.origin!==origin)return send(403,{error:'Request origin is not allowed.'});let body=req.body;if(typeof body==='string')try{body=JSON.parse(body)}catch{return send(400,{error:'Invalid JSON.'})}if(!body){let s='';for await(const chunk of req){s+=chunk;if(s.length>4096)return send(413,{error:'Request too large.'})}try{body=JSON.parse(s)}catch{return send(400,{error:'Invalid JSON.'})}}const result=checkout(body);if(result.status===200&&!(await paymentHealth()).checkout.ready)return send(503,{error:'The secure gateway is temporarily unavailable. No payment has been created.'});return send(result.status,result.body)}
 if(!['GET','HEAD'].includes(req.method))return send(405,{error:'Method not allowed.'});
 if(route==='/manifest.json'||route==='/standalone/manifest.json'){const m=buildManifest(origin,scopeMask,route==='/standalone/manifest.json',posterTemplate);return m?send(200,m,{'Cache-Control':posterTemplate?'private,no-store':'public,max-age=300'}):send(400,{error:'Select at least one catalog.'})}
 if(route==='/health.json')return send(200,await paymentHealth());if(route==='/data-health.json')return send(200,await dataHealth(),{'Cache-Control':'no-store'});
 const posterRoute=route.replace(/%3A/gi,':').match(/^\/poster\/(movie|series)\/((?:tt\d+)|(?:(?:tmdb|tvmaze):\d+))\.jpg$/);if(posterRoute&&posterTemplate){
 const [,type,id]=posterRoute;
 const badgeRequested=requestParams.get('badge')==='just-added';
 const rendererId=await resolveRendererId(id);\n const rendererUrl=buildSharedRendererUrl(type,rendererId,badgeRequested,requestParams.get('v')||'6');
 if(rendererUrl){
  try{
   const rendered=await fetch(rendererUrl,{cache:'no-store',signal:AbortSignal.timeout(15000)});
   if(!rendered.ok)throw Error('Shared poster renderer HTTP '+rendered.status);
   const mime=(rendered.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
   if(!mime.startsWith('image/'))throw Error('Shared poster renderer returned '+(mime||'no image content type'));
   const bytes=await rendered.arrayBuffer();
   if(bytes.byteLength<500||bytes.byteLength>15000000)throw Error('Shared poster renderer image size outside limits');
   const headers={'Content-Type':mime,'Access-Control-Allow-Origin':'*','Cache-Control':'private,max-age=3600','X-Content-Type-Options':'nosniff'};
   for(const name of ['X-Poster-Date-Status','X-Poster-Just-Added','X-Poster-Date','X-Poster-Date-Type','X-Poster-Source']){
    const value=rendered.headers.get(name);
    if(value)headers[name]=value;
   }
   if(rendered.headers.get('X-Poster-Just-Added')==='true')headers['X-Poster-Badge']='Just Added';
   res.statusCode=200;
   for(const [k,v] of Object.entries(headers))res.setHeader(k,v);
   return res.end(req.method==='HEAD'?undefined:Buffer.from(bytes));
  }catch(error){
   console.warn('[shared-poster-renderer-proxy-failed]',JSON.stringify({id,type,error:String(error?.message||error).slice(0,180)}));
  }
 }
 // Preserve a working image if the shared renderer is unavailable.
 const imdb=rendererId.startsWith('tt')?rendererId:'';
 if(imdb){
  const rated=ratedPoster(posterTemplate,imdb,'');
  if(rated){
   try{
    const image=await fetchPoster(rated);
    const mime=image.contentType||'image/jpeg';
    res.statusCode=200;
    for(const [k,v] of Object.entries({'Content-Type':mime,'Access-Control-Allow-Origin':'*','Cache-Control':'private,max-age=300','X-Content-Type-Options':'nosniff','X-Poster-Source':'betterposters-fallback'}))res.setHeader(k,v);
    return res.end(req.method==='HEAD'?undefined:image);
   }catch{}
  }
 }
 const fallbackId=rendererId.startsWith('tt')?rendererId:type+'~'+id;
 const fallbackUrl=origin+'/art/poster/'+fallbackId+(badgeRequested?'?badge=just-added&v=6':'?v=6');
 const fallback=await worker.fetch(new Request(fallbackUrl,{method:req.method}));
 res.statusCode=fallback.status;
 for(const [k,v] of fallback.headers)res.setHeader(k,v);
 return res.end(req.method==='HEAD'?undefined:Buffer.from(await fallback.arrayBuffer()));
}
const catalogRequest=route.match(/^\/catalog\/(movie|series)\/([^/]+?)(?:\.json|\/)/);if(catalogRequest&&!buildManifest(origin,scopeMask).catalogs.some(c=>c.type===catalogRequest[1]&&c.id===catalogRequest[2]))return send(200,{metas:[]});
 const request=new Request(origin+route+(requestParams.size?'?'+requestParams.toString():''),{method:req.method});const result=await worker.fetch(request);const contentType=result.headers.get('content-type')||'';if(contentType.includes('application/json')){const value=replaceOrigin(await result.json(),origin);const posterBase=posterTemplate?'/install/'+scopeMask.toString(16).padStart(2,'0')+'/bttr/'+encodePosterConfig(posterTemplate):'';if(posterTemplate){const posterUrl=m=>buildConfiguredPosterUrl(m,origin,posterBase,posterTemplate);for(const m of value.metas||[])m.poster=posterUrl(m);if(value.meta)value.meta.poster=posterUrl(value.meta)}if(route==='/status.json')value.name='The Great Indian Addon';return send(result.status,value,{'Cache-Control':posterTemplate?'private,no-store':result.headers.get('cache-control')||'public,max-age=300'})}res.statusCode=result.status;for(const [k,v] of result.headers)res.setHeader(k,v);res.end(req.method==='HEAD'?undefined:Buffer.from(await result.arrayBuffer()));}catch{send(503,{error:'This service is temporarily unavailable. Please try again shortly.'})}}
