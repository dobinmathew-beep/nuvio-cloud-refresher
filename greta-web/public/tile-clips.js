/* Every tile starts independently, using the exact same player factory as the backdrop. */
(()=>{
 const slots=[['.star-mohanlal','Mohanlal'],['.star-mammootty','Mammootty'],['.support-srk','Shah Rukh Khan'],['.support-vijay','Vijay'],['.support-allu','Allu Arjun'],['.actress-one','Deepika'],['.actress-two','Samantha'],['.cast-parvathy','Parvathy'],['.cast-nayanthara','Nayanthara'],['.cast-rajinikanth','Rajinikanth']];
 const stage=document.querySelector('.cinema'),reduce=matchMedia('(prefers-reduced-motion: reduce)');if(!stage)return;
 const items=[];let initialized=false,visible=true;
 const allowed=()=>!reduce.matches&&!navigator.connection?.saveData;
 const active=()=>allowed()&&visible&&!document.hidden&&!document.body.classList.contains('motion-paused');
 function cancel(item){clearTimeout(item.loop);item.loop=null}
 function restart(item){if(!active()||!item.ready)return;cancel(item);item.player.seekTo(item.film.start,true);item.player.playVideo()}
 function schedule(item){cancel(item);if(!active())return;const time=Math.max(item.film.start,item.player.getCurrentTime()||item.film.start);item.loop=setTimeout(()=>restart(item),Math.max(250,(item.film.end-time)*1000))}
 function sync(){items.forEach(item=>{cancel(item);if(!item.ready||item.failed)return;item.player.mute();if(active())item.player.playVideo();else item.player.pauseVideo()})}
 async function initialize(){if(initialized||!allowed())return;initialized=true;try{await window.greatYouTubeReady()}catch{initialized=false;return}
  // No queue or playback-dependent gate: a delayed source never blocks another tile.
  slots.forEach(([selector,name],id)=>{const card=stage.querySelector(selector),film=films.find(f=>f.name===name);if(!card||!film)return;
   const surface=document.createElement('div');surface.className='tile-video';surface.setAttribute('aria-hidden','true');const mount=document.createElement('div');mount.id='actor-preview-'+id;surface.append(mount);card.append(surface);
   const resize=new ResizeObserver(entries=>surface.style.setProperty('--player-scale',String(entries[0].contentRect.width/200)));resize.observe(card);surface.style.setProperty('--player-scale',String(card.clientWidth/200));
   const item={card,film,player:null,ready:false,failed:false,loop:null};items.push(item);card.dataset.film=film.film;card.dataset.previewStatus='loading';
   item.player=window.greatFilmPlayer(mount.id,film,{width:200,height:300,events:{
    onReady:e=>{item.ready=true;e.target.mute();if(active())e.target.playVideo();else e.target.pauseVideo()},
    onStateChange:e=>{if(e.data===1){if(!active()){item.player.pauseVideo();return}item.failed=false;card.dataset.previewStatus='playing';card.classList.add('tile-playing');schedule(item)}else if(e.data===0){restart(item)}else if(e.data===2||e.data===3){cancel(item);card.dataset.previewStatus=e.data===3?'buffering':'paused'}},
    onError:e=>{item.failed=true;cancel(item);card.dataset.previewStatus='unavailable';card.dataset.previewError=String(e.data);card.classList.remove('tile-playing')},
    onAutoplayBlocked:()=>{card.dataset.previewStatus='autoplay-blocked';card.classList.remove('tile-playing')}
   }});
  });
 }
 new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;sync()},{threshold:.04}).observe(stage);
 document.addEventListener('visibilitychange',sync);
 document.getElementById('motion-toggle')?.addEventListener('click',()=>{if(!initialized&&!document.body.classList.contains('motion-paused'))initialize();else sync()});
 reduce.addEventListener('change',()=>{if(allowed()&&!initialized)initialize();else sync()});
 if(!document.body.classList.contains('motion-paused'))initialize();
})();
