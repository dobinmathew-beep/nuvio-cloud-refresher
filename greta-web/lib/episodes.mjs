export const EPISODE_WINDOW_MS=7*86400000;
export function episodeTime(meta,now=Date.now()){
 if(meta.type!=='series')return null;
 const values=[meta.latestEpisodeReleasedAt,...(meta.videos||[]).map(v=>v.released||v.airdate)].map(v=>v?Date.parse(v):NaN).filter(v=>Number.isFinite(v)&&v<=now);
 return values.length?Math.max(...values):null;
}
export function hasNewEpisodes(meta,now=Date.now()){const t=episodeTime(meta,now);return t!==null&&now-t<=EPISODE_WINDOW_MS}
export function withEpisodePoster(meta,origin,base='',now=Date.now()){
 if(!hasNewEpisodes(meta,now))return {...meta,hasNewEpisodes:false};
 const day=new Date(episodeTime(meta,now)).toISOString().slice(0,10);
 return {...meta,hasNewEpisodes:true,poster:origin+base+'/episode-posters/'+encodeURIComponent(meta.id)+'/'+day+'.jpg'};
}
