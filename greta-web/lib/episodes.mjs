export const EPISODE_WINDOW_MS=7*86400000;
export function episodeTime(meta,now=Date.now()){
 if(meta.type!=='series')return null;
 const values=[meta.latestEpisodeReleasedAt,meta.nextEpisodeReleaseAt,meta.nextSeasonReleaseAt,...(meta.videos||[]).map(v=>v.released||v.airdate)].map(v=>v?Date.parse(v):NaN).filter(v=>Number.isFinite(v)&&v<=now);
 return values.length?Math.max(...values):null;
}
export function hasNewEpisodes(meta,now=Date.now()){const t=episodeTime(meta,now);return t!==null&&now-t<=EPISODE_WINDOW_MS}
export function upcomingTime(meta,now=Date.now()){
 if(meta.type!=='series')return null;
 const values=[meta.nextEpisodeReleaseAt,meta.nextSeasonReleaseAt,...(meta.videos||[]).map(v=>v.released||v.airdate),...(meta.seasons||[]).map(s=>s.premiereDate)].filter(v=>typeof v==='string'&&v.length>=10).map(Date.parse).filter(v=>Number.isFinite(v)&&v>now);
 return values.length?Math.min(...values):null;
}
export function episodeBadges(meta,now=Date.now()){
 const items=[];if(hasNewEpisodes(meta,now))items.push({kind:'new',label:'New Episodes',day:new Date(episodeTime(meta,now)).toISOString().slice(0,10)});
 const next=upcomingTime(meta,now);if(next!==null){const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Muscat',day:'numeric',month:'numeric'}).formatToParts(next);const date=parts.find(p=>p.type==='day').value+' '+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(parts.find(p=>p.type==='month').value)-1];items.push({kind:'upcoming',label:'Upcoming '+date,day:new Date(next).toISOString().slice(0,10)})}
 return items;
}
export function withEpisodePoster(meta,origin,base='',now=Date.now()){
 const badges=episodeBadges(meta,now),upcoming=upcomingTime(meta,now);if(!badges.length)return {...meta,hasNewEpisodes:false,nextEpisodeReleaseAt:null};
 const day=badges[0].day,next=badges.find(b=>b.kind==='upcoming');
 return {...meta,hasNewEpisodes:hasNewEpisodes(meta,now),nextEpisodeReleaseAt:upcoming===null?null:new Date(upcoming).toISOString(),poster:origin+base+'/episode-posters/'+encodeURIComponent(meta.id)+'/'+day+'.jpg?v=5'+(next?'&next='+next.day:'')};
}

export function releaseSortTime(meta,now=Date.now()){return Math.max(episodeTime(meta,now)||0,Date.parse(meta.releaseDate||meta.ottDate||'')||0)}
