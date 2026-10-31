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
export async function renderBadge(bytes,badges=[{kind:'new',label:'NEW EPISODES'}]){
 const {default:sharp}=await import('sharp');
 const resized=await sharp(bytes,{limitInputPixels:30000000}).rotate().resize({width:600,withoutEnlargement:true}).toBuffer({resolveWithObject:true});
 const width=resized.info.width,height=resized.info.height,banner=Math.max(25,Math.round(width*.085));
 const rows=badges.map((badge,index)=>{
  let x=0;const paths=[];for(const ch of badge.label){const g=badgeText.glyphs[ch];if(!g)throw Error('Invalid badge lettering');if(g.path)paths.push(`<path d="${g.path}" transform="translate(${x},0)"/>`);x+=g.width+110}
  const textWidth=width*(badge.kind==='upcoming'?.67:.56),scale=textWidth/(x-110),baseline=(banner+badgeText.capHeight*scale)/2;
  const bg=badge.kind==='upcoming'?'#ffcb69':'#143e38',fg=badge.kind==='upcoming'?'#143e38':'#fff9e9';
  return `<g transform="translate(0,${index*banner})"><rect width="${width}" height="${banner}" fill="${bg}"/><rect width="${Math.round(width*.016)}" height="${banner}" fill="${badge.kind==='upcoming'?'#a94529':'#ffcb69'}"/><g fill="${fg}" transform="translate(${(width-textWidth)/2},${baseline}) scale(${scale},${-scale})">${paths.join('')}</g></g>`;
 }).join('');
 const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${banner*badges.length}">${rows}</svg>`);
 return sharp(resized.data).composite([{input:svg,top:0,left:0}]).jpeg({quality:90,mozjpeg:true}).toBuffer();
}
export async function episodePoster(id,day,origin,template=''){
 const all=await data('catalogs.json');const entry=Object.entries(all).filter(([k])=>k.endsWith('_series')).flatMap(([,v])=>v).find(m=>m.id===id);if(!entry)return new Response('Unknown series',{status:404});
 const defaultPoster=()=>worker.fetch(new Request(origin+'/art/poster/'+(id.startsWith('tt')?id:'series~'+id)));
 const badges=episodeBadges(entry);const active=badges.some(b=>b.day===day);
 if(!active)return defaultPoster();
 const key=template+'|'+id+'|'+badges.map(b=>b.label+':'+b.day).join('|'),old=cache.get(key);if(old&&Date.now()-old.at<600000)return new Response(old.bytes,{headers:old.headers});
 if(jobs.has(key))return (await jobs.get(key)).clone();
 const job=(async()=>{let bytes;const rated=template?ratedPoster(template,id,''):'';
  if(rated&&new URL(rated).hostname==='btttr.cc')try{bytes=await fetchPoster(rated)}catch{}
  if(!bytes){const r=await defaultPoster();if(!r.ok)return r;bytes=Buffer.from(await r.arrayBuffer())}
  let output;try{output=await renderBadge(bytes,badges)}catch{return defaultPoster()}
  const headers={'Content-Type':'image/jpeg','Cache-Control':template?'private,max-age=600':'public,max-age=3600','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff'};
  while(cache.size>=24)cache.delete(cache.keys().next().value);cache.set(key,{bytes:output,headers,at:Date.now()});return new Response(output,{headers});})();jobs.set(key,job);
 try{return (await job).clone()}finally{jobs.delete(key)}
}
