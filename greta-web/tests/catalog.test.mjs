import test from 'node:test';import assert from 'node:assert/strict';import {buildManifest,replaceOrigin,buildConfiguredPosterUrl,buildSharedRendererUrl} from '../api/service.mjs';import {buildCatalogPosterUrl,buildJustAddedRendererUrl} from '../lib/core.mjs';

test('only Just Added-eligible catalog entries receive a badge poster request',()=>{
 assert.equal(buildCatalogPosterUrl('https://addon.example','movie','tt1234567',true),'https://addon.example/art/poster/tt1234567?badge=just-added&v=5');
 assert.equal(buildCatalogPosterUrl('https://addon.example','movie','tt1234567',false),'https://addon.example/art/poster/tt1234567');
 assert.equal(buildCatalogPosterUrl('https://addon.example','movie','tmdb:1819380',true),'https://addon.example/art/poster/movie~tmdb:1819380?badge=just-added&v=5');
});
test('Just Added renderer URL supports IMDb and TMDB movie/series IDs',()=>{
 assert.equal(buildJustAddedRendererUrl('movie','tt1234567'),'https://great-indian-upcoming-posters.onrender.com/poster/tt1234567.jpg?badge=just-added&v=5');
 assert.equal(buildJustAddedRendererUrl('movie','tmdb:1819380'),'https://great-indian-upcoming-posters.onrender.com/poster/tmdb/1819380.jpg?badge=just-added&type=movie&v=5');
 assert.equal(buildJustAddedRendererUrl('series','tmdb:1819380'),'https://great-indian-upcoming-posters.onrender.com/poster/tmdb/1819380.jpg?badge=just-added&type=tv&v=5');
 assert.equal(buildJustAddedRendererUrl('movie','tvmaze:123'),null);
});
test('shared renderer URL supports IMDb and TMDB movies and series',()=>{
 assert.equal(buildSharedRendererUrl('movie','tt1234567'),'https://great-indian-upcoming-posters.onrender.com/poster/tt1234567.jpg?v=6');
 assert.equal(buildSharedRendererUrl('movie','tt1234567',true),'https://great-indian-upcoming-posters.onrender.com/poster/tt1234567.jpg?badge=just-added&v=6');
 assert.equal(buildSharedRendererUrl('movie','tmdb:1819380'),'https://great-indian-upcoming-posters.onrender.com/poster/tmdb/1819380.jpg?type=movie&v=6');
 assert.equal(buildSharedRendererUrl('series','tmdb:1819380',true),'https://great-indian-upcoming-posters.onrender.com/poster/tmdb/1819380.jpg?badge=just-added&type=tv&v=6');
 assert.equal(buildSharedRendererUrl('series','tvmaze:123'),null);
});

test('configured poster templates preserve Just Added eligibility instead of overriding it',()=>{
 const template='https://btttr.cc/poster/imdb/poster-default/{imdb_id}.jpg?rs=IM';
 const base='/install/01/bttr/token';
 assert.equal(buildConfiguredPosterUrl({id:'tt1234567',type:'movie',justAdded:true},'https://addon.example',base,template),'https://addon.example/install/01/bttr/token/poster/movie/tt1234567.jpg?badge=just-added&v=6');
 assert.equal(buildConfiguredPosterUrl({id:'tt1234567',type:'movie',justAdded:false},'https://addon.example',base,template),'https://addon.example/install/01/bttr/token/poster/movie/tt1234567.jpg?v=6');
 assert.equal(buildConfiguredPosterUrl({id:'tmdb:1819380',type:'movie',justAdded:true},'https://addon.example',base,template),'https://addon.example/install/01/bttr/token/poster/movie/tmdb:1819380.jpg?badge=just-added&v=6');
});
test('configured poster route forwards Just Added requests to the Render renderer',async()=>{
 const oldFetch=globalThis.fetch,oldOrigin=process.env.PUBLIC_ORIGIN;
 process.env.PUBLIC_ORIGIN='https://addon.example';
 let requested='';
 globalThis.fetch=async url=>{
  requested=String(url);
  return new Response(new Uint8Array(512).fill(7),{status:200,headers:{'content-type':'image/jpeg','x-poster-date-status':'just-added-overlay','x-poster-just-added':'true','x-poster-source':'BetterPosters'}});
 };
 try{
  const token=encodePosterConfig('https://btttr.cc/poster/imdb/poster-default/{imdb_id}.jpg?rs=IM');
  const route='/install/01/bttr/'+token+'/poster/movie/tt1234567.jpg?badge=just-added&v=5';
  const req={url:route,method:'GET',headers:{host:'addon.example'},query:{path:route.split('?')[0]}};
  const res={headers:{},setHeader(k,v){this.headers[k]=v},end(body){this.body=body}};
  await handler(req,res);
  assert.equal(res.statusCode,200);
  assert.equal(requested,'https://great-indian-upcoming-posters.onrender.com/poster/tt1234567.jpg?badge=just-added&v=6');
  assert.equal(res.headers['x-poster-badge'],'Just Added');
 }finally{
  globalThis.fetch=oldFetch;
  if(oldOrigin===undefined)delete process.env.PUBLIC_ORIGIN;else process.env.PUBLIC_ORIGIN=oldOrigin;
 }
});

test('configured poster proxy preserves badge query embedded inside Vercel path parameter',async()=>{
 const oldFetch=globalThis.fetch,oldOrigin=process.env.PUBLIC_ORIGIN;
 process.env.PUBLIC_ORIGIN='https://addon.example';
 let requested='';
 globalThis.fetch=async url=>{
  requested=String(url);
  return new Response(new Uint8Array(512).fill(7),{status:200,headers:{'content-type':'image/jpeg','x-poster-date-status':'just-added-overlay','x-poster-just-added':'true','x-poster-source':'BetterPosters'}});
 };
 try{
  const token=encodePosterConfig('https://btttr.cc/poster/imdb/poster-default/{imdb_id}.jpg?rs=IM');
  const route='/install/ff/bttr/'+token+'/poster/movie/tt45692999.jpg?badge=just-added&v=5';
  const req={url:'/api/service?path='+encodeURIComponent(route),method:'GET',headers:{host:'addon.example'},query:{path:route}};
  const res={headers:{},setHeader(k,v){this.headers[k]=v},end(body){this.body=body}};
  await handler(req,res);
  assert.equal(res.statusCode,200);
  assert.equal(requested,'https://great-indian-upcoming-posters.onrender.com/poster/tt45692999.jpg?badge=just-added&v=5');
  assert.equal(res.headers['x-poster-badge'],'Just Added');
 }finally{
  globalThis.fetch=oldFetch;
  if(oldOrigin===undefined)delete process.env.PUBLIC_ORIGIN;else process.env.PUBLIC_ORIGIN=oldOrigin;
 }
});

test('all 255 catalog selections contain exactly the requested language/type bits',()=>{for(let mask=1;mask<256;mask++){const m=buildManifest('https://greta.example',mask);assert.equal(m.catalogs.length,mask.toString(2).replace(/0/g,'').length);for(const c of m.catalogs){assert.equal(c.pageSize,50);assert(c.extra.some(x=>x.name==='skip'));const i=['ml','ta','te','hi'].indexOf(c.id.split('_')[1])*2+(c.type==='series'?1:0);assert(mask&(1<<i))}assert(m.resources.every(r=>r.name==='catalog'));assert.equal(m.name,'The Great Indian Addon');assert.equal(m.version,'2.3.3');assert(!JSON.stringify(m).includes('chatgpt'))}assert.equal(buildManifest('https://greta.example',0),null)});

test('catalog endpoints expose 50-item pages and continue with skip pagination',async()=>{
 const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('offline fixture')};
 try{
  async function request(route){const req={url:route,method:'GET',headers:{host:'addon.example'},query:{path:route}};const res={headers:{},setHeader(k,v){this.headers[k]=v},end(body){this.body=JSON.parse(body)}};await handler(req,res);return res}
  const first=await request('/catalog/movie/dobins_ml_movie.json');
  const second=await request('/catalog/movie/dobins_ml_movie/skip=50.json');
  assert.equal(first.body.metas.length,50);
  assert(second.body.metas.length>0);
  const firstIds=new Set(first.body.metas.map(x=>x.id));
  assert(second.body.metas.every(x=>!firstIds.has(x.id)));
 }finally{globalThis.fetch=originalFetch}
});

test('origins are rewritten throughout nested artwork and metadata',()=>{const x=replaceOrigin({a:['https://dobins-indian-catalog.quickfield138.chatgpt.site/art/poster/tt1']},'https://greta.example');assert.equal(x.a[0],'https://greta.example/art/poster/tt1')});
import handler from '../api/service.mjs';import {readFileSync} from 'node:fs';
test('personalised and standalone install bases serve catalogs, extras and selected languages',async()=>{const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('offline fixture')};try{async function request(route){const req={url:route,method:'GET',headers:{host:'addon.example'},query:{path:route.split('?')[0]}};const res={headers:{},setHeader(k,v){this.headers[k]=v},end(body){this.body=JSON.parse(body)}};await handler(req,res);return res}const root=await request('/catalog/movie/dobins_ml_movie.json');assert(root.body.metas.length>1);const selected=await request('/install/01/catalog/movie/dobins_ml_movie.json');assert.equal(selected.statusCode,200);assert.deepEqual(selected.body,root.body);const paged=await request('/install/01/catalog/movie/dobins_ml_movie/skip=1.json');assert.equal(paged.body.metas[0].id,root.body.metas[1].id);const query=await request('/install/01/catalog/movie/dobins_ml_movie.json?skip=1');assert.equal(query.body.metas[0].id,root.body.metas[1].id);const searched=await request('/install/01/catalog/movie/dobins_ml_movie/search='+encodeURIComponent(root.body.metas[0].name)+'.json');assert.equal(searched.body.metas[0].id,root.body.metas[0].id);assert.deepEqual((await request('/install/01/catalog/series/dobins_ml_series.json')).body,{metas:[]});assert.equal((await request('/install/00/catalog/movie/dobins_ml_movie.json')).statusCode,400);assert.deepEqual((await request('/standalone/catalog/movie/dobins_ml_movie.json')).body,root.body);const config=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url)));for(const source of ['/install/:mask/:rest*','/standalone/:rest*'])assert(config.rewrites.some(r=>r.source===source));}finally{globalThis.fetch=originalFetch}});
import {normalizePosterTemplate,encodePosterConfig,decodePosterConfig,ratedPoster} from '../public/poster-config.js';
test('poster URL settings preserve provider options and substitute only matching IMDb titles',()=>{const t=normalizePosterTemplate('https://posters.example/key/poster/tt0133093.jpg?ratings=imdb,rt');assert.equal(t,'https://posters.example/key/poster/{imdbId}.jpg?ratings=imdb,rt');assert.equal(decodePosterConfig(encodePosterConfig(t)),t);assert.equal(ratedPoster(t,'tt34792531','fallback'), 'https://posters.example/key/poster/tt34792531.jpg?ratings=imdb,rt');assert.equal(ratedPoster(t,'tmdb:123','fallback'),'fallback');assert.equal(encodePosterConfig(''),'');for(const invalid of ['http://posters.example/{id}','https://localhost/{id}','https://user:pass@posters.example/{id}','https://posters.example/no-id','https://posters.example/{unknown}'])assert.throws(()=>normalizePosterTemplate(invalid));});
test('configured installation serves rated posters through catalog pagination and keeps selection',async()=>{const oldFetch=globalThis.fetch,oldOrigin=process.env.PUBLIC_ORIGIN;process.env.PUBLIC_ORIGIN='https://addon.example';globalThis.fetch=async()=>{throw Error('offline fixture')};try{const token=encodePosterConfig('https://btttr.cc/poster/imdb/poster-default/{imdb_id}.jpg?rs=IM');async function request(tail){const req={url:'/install/01/bttr/'+token+tail,method:'GET',headers:{host:'addon.example'}};const res={headers:{},setHeader(k,v){this.headers[k]=v},end(body){this.body=JSON.parse(body)}};await handler(req,res);return res}const manifest=await request('/manifest.json');assert.equal(manifest.statusCode,200);assert.equal(manifest.body.catalogs.length,1);assert(manifest.body.configurationURL.includes('#bttr='+token));const page=await request('/catalog/movie/dobins_ml_movie/skip=1.json');assert.equal(page.statusCode,200);assert(page.body.metas.length>0);for(const m of page.body.metas){
 const imdb=[m.id,m.imdb_id,m.imdbId,m.imdb,m.externals?.imdb,m.externalIds?.imdb,m.ids?.imdb].find(v=>typeof v==='string'&&v.startsWith('tt')&&v.slice(2).length>0&&[...v.slice(2)].every(ch=>ch>='0'&&ch<='9'));
 const local='https://addon.example/install/01/bttr/'+token+'/poster/'+m.type+'/'+(imdb||m.id)+'.jpg';
 if(m.justAdded===true)assert.equal(m.poster,local+'?badge=just-added&v=6');
 else assert.equal(m.poster,local+'?v=6');
}assert.equal(page.headers['Cache-Control'],'private,no-store');assert.deepEqual((await request('/catalog/series/dobins_ml_series.json')).body,{metas:[]});}finally{globalThis.fetch=oldFetch;if(oldOrigin===undefined)delete process.env.PUBLIC_ORIGIN;else process.env.PUBLIC_ORIGIN=oldOrigin}});

test('accepts exact BetterPosters IMDb underscore placeholder and encoded copies',()=>{const exact='https://btttr.cc/poster/imdb/poster-default/{imdb_id}.jpg?rs=IM';assert.equal(normalizePosterTemplate(exact),exact);assert.equal(normalizePosterTemplate(exact.replace('{imdb_id}','%7Bimdb_id%7D')),exact);assert.equal(decodePosterConfig(encodePosterConfig(exact)),exact);assert.equal(ratedPoster(exact,'tt0133093','fallback'),'https://btttr.cc/poster/imdb/poster-default/tt0133093.jpg?rs=IM');});


test('configured poster route sends normal titles through the shared renderer and preserves its date headers',async()=>{
 const oldFetch=globalThis.fetch;let requested='';
 globalThis.fetch=async url=>{requested=String(url);return new Response(new Uint8Array(512).fill(7),{status:200,headers:{'content-type':'image/webp','content-length':'512','x-poster-date-status':'upcoming-date-overlay','x-poster-date':'2026-12-20','x-poster-date-type':'premiere','x-poster-source':'BetterPosters','x-poster-just-added':'false'}})};
 try{const token=encodePosterConfig('https://btttr.cc/poster/imdb/poster-default/{imdb_id}.jpg?rs=IM');const route='/install/01/bttr/'+token+'/poster/movie/tt1234567.jpg?v=6';const req={url:route,method:'GET',headers:{host:'addon.example'}};const res={headers:{},setHeader(k,v){this.headers[k]=v},end(body){this.body=body}};await handler(req,res);assert.equal(res.statusCode,200);assert.equal(requested,'https://great-indian-upcoming-posters.onrender.com/poster/tt1234567.jpg?v=6');assert.equal(res.headers['Content-Type'],'image/webp');assert.equal(res.headers['X-Poster-Source'],'BetterPosters');assert.equal(res.headers['X-Poster-Date-Status'],'upcoming-date-overlay');assert.equal(res.headers['X-Poster-Date'],'2026-12-20');assert.equal(res.body.length,512);}
 finally{globalThis.fetch=oldFetch}
});

test('public data-health route exposes GitHub snapshot provenance and catalog counts',async()=>{
 const oldFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('offline fixture')};
 try{const req={url:'/data-health.json',method:'GET',headers:{host:'addon.example'},query:{path:'/data-health.json'}};const res={headers:{},setHeader(k,v){this.headers[k]=v},end(body){this.body=JSON.parse(body)}};await handler(req,res);assert.equal(res.statusCode,200);assert(res.body.snapshots['catalogs.json']);assert(res.body.snapshots['status.json']);assert(res.body.snapshots['metadata.json']);assert.equal(typeof res.body.catalogCounts.dobins_ml_movie,'number');assert(Array.isArray(res.body.catalogIdSets.dobins_ml_movie));assert.equal(typeof res.body.metadataRecords,'number');}
 finally{globalThis.fetch=oldFetch}
});
