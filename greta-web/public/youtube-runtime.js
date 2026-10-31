/* Share one official iframe API between the page background and portrait tiles. */
(()=>{let pending;window.greatYouTubeReady=()=>{if(window.YT?.Player)return Promise.resolve(window.YT);if(pending)return pending;pending=new Promise((resolve,reject)=>{const previous=window.onYouTubeIframeAPIReady;window.onYouTubeIframeAPIReady=()=>{try{previous?.()}finally{resolve(window.YT)}};const script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';script.id='great-youtube-api';script.async=true;script.onerror=()=>{pending=null;script.remove();reject(Error('Film previews unavailable'))};document.head.append(script)});return pending}})();
/* Shared by BOTH background and tiles, so autoplay cannot drift between implementations. */
window.greatFilmPlayer=(mount,film,{width=200,height=300,events={}}={})=>new YT.Player(mount,{
 host:'https://www.youtube-nocookie.com',width,height,videoId:film.id,
 playerVars:{autoplay:1,mute:1,controls:0,playsinline:1,rel:0,disablekb:1,fs:0,start:film.start,end:film.end,origin:location.origin},
 events
});
