/* Every tile starts independently, using the exact same player factory as the backdrop. */
(()=>{
 const slots=[['.star-mohanlal','Mohanlal'],['.star-mammootty','Mammootty'],['.support-srk','Shah Rukh Khan'],['.support-vijay','Vijay'],['.support-allu','Allu Arjun'],['.actress-one','Deepika'],['.actress-two','Samantha'],['.cast-parvathy','Parvathy'],['.cast-nayanthara','Nayanthara'],['.cast-rajinikanth','Rajinikanth']];
 const stage=document.querySelector('.cinema'),reduce=matchMedia('(prefers-reduced-motion: reduce)');if(!stage)return;
 const items=[];let initialized=false,visible=true;
 const allowed=()=>!reduce.matches&&!navigator.connection?.saveData;
 const active=()=>allowed()&&visible&&!document.hidden&&!document.body.classList.contains('motion-paused');
 function cancel(item){clearTimeout(item.loop);item.loop=null}
 function restart(item){if(!active()||!item.ready)return;cancel(item);item.card.classList.add('tile-crossfade');item.index=(item.index+1)%item.sequence.length;item.film=item.sequence[item.index];item.card.dataset.film=item.film.film;item.player.mute();item.player.loadVideoById({videoId:item.film.id,startSeconds:item.film.start,endSeconds:item.film.end})}
 function schedule(item){cancel(item);if(!active())return;const time=Math.max(item.film.start,item.player.getCurrentTime()||item.film.start);item.loop=setTimeout(()=>restart(item),Math.max(250,(item.film.end-time)*1000))}
 function sync(){items.forEach(item=>{cancel(item);if(!item.ready||item.failed)return;item.player.mute();if(active())item.player.playVideo();else item.player.pauseVideo()})}
 async function initialize(){if(initialized||!allowed())return;initialized=true;try{await window.greatYouTubeReady()}catch{initialized=false;return}
  // No queue or playback-dependent gate: a delayed source never blocks another tile.
  slots.forEach(([selector,name],id)=>{const card=stage.querySelector(selector),fallback=films.find(f=>f.name===name),sequence=window.greatCastFilms?.[name]||[fallback],film=sequence[0];if(!card||!film)return;
   const surface=document.createElement('div');surface.className='tile-video';surface.setAttribute('aria-hidden','true');const mount=document.createElement('div');mount.id='actor-preview-'+id;surface.append(mount);card.append(surface);
   function size(width,height){const h=Math.max(240,height*1.65);surface.style.setProperty('--player-cover-width',(h*16/9)+'px');surface.style.setProperty('--player-cover-height',h+'px')}const resize=new ResizeObserver(entries=>size(entries[0].contentRect.width,entries[0].contentRect.height));resize.observe(card);size(card.clientWidth,card.clientWidth*1.5);
   const item={card,film,sequence,index:0,errors:0,player:null,ready:false,failed:false,loop:null};items.push(item);card.dataset.film=film.film;card.dataset.previewStatus='loading';
   item.player=window.greatFilmPlayer(mount.id,film,{width:200,height:300,events:{
    onReady:e=>{item.ready=true;e.target.mute();if(active())e.target.playVideo();else e.target.pauseVideo()},
    onStateChange:e=>{if(e.data===1){if(!active()){item.player.pauseVideo();return}item.failed=false;item.errors=0;card.dataset.previewStatus='playing';card.classList.add('tile-playing');card.classList.remove('tile-crossfade');schedule(item)}else if(e.data===0){restart(item)}else if(e.data===2||e.data===3){cancel(item);card.dataset.previewStatus=e.data===3?'buffering':'paused'}},
    onError:e=>{cancel(item);card.dataset.previewError=String(e.data);if(item.ready&&++item.errors<item.sequence.length){restart(item);return}item.failed=true;card.dataset.previewStatus='unavailable';card.classList.remove('tile-playing','tile-crossfade')},
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
