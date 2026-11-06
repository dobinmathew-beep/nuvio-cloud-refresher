// Rights-checked free-stream discovery for titles explicitly licensed for redistribution.
// Deliberately does not scrape paywalls, DRM-protected services, or unlicensed mirrors.
const IA_SEARCH='https://archive.org/advancedsearch.php';
const ALLOWED_LICENSES=[
  'creativecommons.org/publicdomain/zero',
  'creativecommons.org/publicdomain/mark',
  'creativecommons.org/licenses/by/',
  'creativecommons.org/licenses/by-sa/',
  'creativecommons.org/licenses/by-nd/',
  'creativecommons.org/licenses/by-nc/',
  'creativecommons.org/licenses/by-nc-sa/',
  'creativecommons.org/licenses/by-nc-nd/',
  'creativecommons.org/licenses/by/4.0',
  'creativecommons.org/licenses/by-sa/4.0'
];
const VIDEO_EXT=/\.(mp4|m4v|webm|ogv)$/i;
const clean=s=>String(s||'').replace(/[<>]/g,'').trim().slice(0,180);
function licensed(meta){
  const raw=String(meta.licenseurl||meta.license||'').toLowerCase();
  return ALLOWED_LICENSES.some(x=>raw.includes(x)) ||
    /public.?domain|\bcc0\b/i.test(String(meta.rights||''));
}
export async function freeStreams({type,id,metadata,fetcher=fetch}){
  if(type!=='movie'||!metadata?.name) return [];
  const title=clean(metadata.name);
  if(!title) return [];
  const q='title:"'+title.replace(/["\\]/g,' ')+'" AND mediatype:movies';
  const endpoint=IA_SEARCH+'?'+new URLSearchParams({q,fl:'identifier,title',rows:'8',output:'json'});
  let search;
  try{
    const res=await fetcher(endpoint,{signal:AbortSignal.timeout(9000)});
    if(!res.ok) return [];
    search=await res.json();
  }catch{return [];}
  const docs=search?.response?.docs||[];
  const streams=[];
  for(const doc of docs.slice(0,6)){
    if(!doc.identifier) continue;
    try{
      const res=await fetcher('https://archive.org/metadata/'+encodeURIComponent(doc.identifier),{signal:AbortSignal.timeout(7000)});
      if(!res.ok) continue;
      const item=await res.json(),meta=item?.metadata||{};
      if(!licensed(meta)) continue;
      const files=(item.files||[]).filter(f=>VIDEO_EXT.test(f.name||'')&&!f.private&&Number(f.size||0)>0)
        .sort((a,b)=>Number(b.size||0)-Number(a.size||0));
      const f=files[0];
      if(!f) continue;
      const url='https://archive.org/download/'+encodeURIComponent(doc.identifier)+'/'+f.name.split('/').map(encodeURIComponent).join('/');
      streams.push({name:'Internet Archive · Licensed free',title:(clean(meta.title)||title)+'\nPublic-domain / Creative Commons · '+(f.format||'Video'),url,behaviorHints:{filename:f.name}});
    }catch{}
    if(streams.length>=3) break;
  }
  return streams;
}
