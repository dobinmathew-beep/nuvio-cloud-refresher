import badgeText from './badge-text.mjs';
import {data} from './core.mjs';import worker from './core.mjs';import {episodeBadges} from './episodes.mjs';import {ratedPoster} from '../public/poster-config.js';
const cache=new Map(),jobs=new Map();
const imageHosts=new Set(['btttr.cc','image.tmdb.org','images.metahub.space','live.metahub.space','api.ratingposterdb.com','static.tvmaze.com','m.media-amazon.com']);
export async function fetchPoster(url){
 for(let i=0;i<4;i++){
  const u=new URL(url);if(u.protocol!=='https:'||!imageHosts.has(u.hostname)||u.username||u.password||u.port)throw Error('Unsupported poster host');
  const r=await fetch(u.href,{redirect:'manual',signal:AbortSignal.timeout(12000)});
  if(r.status>=300&&r.status<400){url=new URL(r.headers.get('location'),u).href;continue}
  if(!r.ok||!r.headers.get('content-type')?.startsWith('image/'))throw Error('Poster unavailable');
  if(Number(r.headers.get('content-length'))>12000000)throw Error('Poster too large');const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>12000000)throw Error('Poster too large');return bytes;
 }throw Error('Too many poster redirects');
}
export async function renderBadge(bytes,badges=[{kind:'new',label:'New Episodes'}]){
 const {default:sharp}=await import('sharp');
 const resized=await sharp(bytes,{limitInputPixels:30000000}).rotate().resize({width:600,withoutEnlargement:true}).toBuffer({resolveWithObject:true});
 const width=resized.info.width,height=resized.info.height,margin=width*.056,pillHeight=width*.116,gap=width*.024,padding=width*.052;
 const rows=badges.map((badge,index)=>{
  let advance=0,minY=0,maxY=0;const paths=[];
  for(const ch of badge.label){const glyph=badgeText.glyphs[ch];if(!glyph)throw Error('Invalid badge lettering');if(glyph.path)paths.push(`<path d="${glyph.path}" transform="translate(${advance},0)"/>`);advance+=glyph.width;minY=Math.min(minY,glyph.minY);maxY=Math.max(maxY,glyph.maxY)}
  let scale=width*.068/badgeText.unitsPerEm;let pillWidth=Math.max(width*.47,advance*scale+padding*2);if(pillWidth>width*.63){pillWidth=width*.63;scale=(pillWidth-padding*2)/advance}
  const textWidth=advance*scale,textHeight=(maxY-minY)*scale,baseline=(pillHeight-textHeight)/2+maxY*scale;
  return `<g transform="translate(${margin},${margin+index*(pillHeight+gap)})"><rect width="${pillWidth}" height="${pillHeight}" rx="${width*.02}" fill="#eeeeee"/><g fill="#111111" transform="translate(${(pillWidth-textWidth)/2},${baseline}) scale(${scale},${-scale})">${paths.join('')}</g></g>`;
 }).join('');
 const overlayHeight=Math.ceil(margin+badges.length*pillHeight+Math.max(0,badges.length-1)*gap);
 const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${overlayHeight}">${rows}</svg>`);
 return sharp(resized.data).composite([{input:svg,top:0,left:0}]).jpeg({quality:90,mozjpeg:true}).toBuffer();
}
export async function episodePoster(id,day,origin,template=''){
 const all=await data('catalogs.json');const entry=Object.entries(all).filter(([k])=>k.endsWith('_series')).flatMap(([,v])=>v).find(m=>m.id===id);if(!entry)return new Response('Unknown series',{status:404});
 const defaultPoster=()=>worker.fetch(new Request(origin+'/art/poster/'+(id.startsWith('tt')?id:'series~'+id)));
 const badges=episodeBadges(entry);const active=badges.some(b=>b.day===day);
 if(!active)return defaultPoster();
 const key=template+'|'+id+'|'+badges.map(b=>b.label+':'+b.day).join('|'),old=cache.get(key);if(old&&Date.now()-old.at<600000)return new Response(old.bytes,{headers:old.headers});
 if(jobs.has(key))return (await jobs.get(key)).clone();
 const job=(async()=>{let bytes,skipOverlay=false,overlayMode='addon';const rated=template?ratedPoster(template,id,''):'';
  if(rated&&new URL(rated).hostname==='btttr.cc')try{
   bytes=await fetchPoster(rated);
   if(new URL(rated).searchParams.get('tag')!=='none'){
    try{const control=await fetchPoster(statusControlUrl(rated));skipOverlay=await providerHasStatus(bytes,control);if(skipOverlay)overlayMode='provider-status'}
    catch{skipOverlay=true;overlayMode='provider-unverified'}
   }
  }catch{}
  if(!bytes){const r=await defaultPoster();if(!r.ok)return r;bytes=Buffer.from(await r.arrayBuffer())}
  let output,mime='image/jpeg';if(skipOverlay){output=bytes;try{const {default:sharp}=await import('sharp');const m=await sharp(bytes).metadata();mime={jpeg:'image/jpeg',png:'image/png',webp:'image/webp',avif:'image/avif'}[m.format]||mime}catch{}}
  else try{output=await renderBadge(bytes,badges)}catch{return defaultPoster()}
  const headers={'Content-Type':mime,'Cache-Control':template?'private,max-age=600':'public,max-age=3600','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff','X-Addon-Status-Overlay':overlayMode};
  while(cache.size>=24)cache.delete(cache.keys().next().value);cache.set(key,{bytes:output,headers,at:Date.now()});return new Response(output,{headers});})();jobs.set(key,job);
 try{return (await job).clone()}finally{jobs.delete(key)}
}

// Compare the provider's original with its documented status-tags-off version.
// The comparison excludes the top-right quality-badge area. Unknown results
// preserve the provider image rather than risk drawing over an existing label.
export function statusControlUrl(url){const u=new URL(url);if(u.hostname!=='btttr.cc')throw Error('Not a BetterPosters URL');u.searchParams.set('tag','none');return u.href}
export async function providerHasStatus(original,control){
 const {default:sharp}=await import('sharp');const width=240,height=360;
 const decode=bytes=>sharp(bytes,{limitInputPixels:30000000}).resize(width,height,{fit:'fill'}).toColourspace('srgb').removeAlpha().raw().toBuffer();
 const [a,b]=await Promise.all([decode(original),decode(control)]);let sum=0,changed=0,pixels=0;
 for(let y=0;y<Math.floor(height*.24);y++)for(let x=0;x<Math.floor(width*.70);x++){
  const p=(y*width+x)*3,d=(Math.abs(a[p]-b[p])+Math.abs(a[p+1]-b[p+1])+Math.abs(a[p+2]-b[p+2]))/3;sum+=d;if(d>22)changed++;pixels++;
 }
 return sum/pixels>2&&changed/pixels>.008;
}
