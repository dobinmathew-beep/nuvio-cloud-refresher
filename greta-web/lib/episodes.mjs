export const EPISODE_WINDOW_MS=7*86400000;
export function episodeTime(meta,now=Date.now()){
 if(meta.type!=='series')return null;
 const values=[meta.latestEpisodeReleasedAt,...(meta.videos||[]).map(v=>v.released||v.airdate)].map(v=>v?Date.parse(v):NaN).filter(v=>Number.isFinite(v)&&v<=now);
 return values.length?Math.max(...values):null;
}
export function hasNewEpisodes(meta,now=Date.now()){const t=episodeTime(meta,now);return t!==null&&now-t<=EPISODE_WINDOW_MS}
export function episodeBadges(meta,now=Date.now()){
 if(!hasNewEpisodes(meta,now))return [];
 const t=episodeTime(meta,now);
 return [{kind:'new',label:'New Episodes',day:new Date(t).toISOString().slice(0,10)}];
}
export function withEpisodePoster(meta,origin,base='',now=Date.now()){
 const badges=episodeBadges(meta,now);if(!badges.length)return {...meta,hasNewEpisodes:false,nextEpisodeReleaseAt:null};
 const day=badges[0].day;
 return {...meta,hasNewEpisodes:true,nextEpisodeReleaseAt:null,poster:origin+base+'/episode-posters/'+encodeURIComponent(meta.id)+'/'+day+'.jpg?v=5'};
}
export function releaseSortTime(meta,now=Date.now()){return Math.max(episodeTime(meta,now)||0,Date.parse(meta.releaseDate||meta.ottDate||'')||0)}
