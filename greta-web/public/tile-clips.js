/* A slow, continuous star procession. Only the featured film plays. */
(()=>{
 const slots=[['.star-mohanlal','Mohanlal'],['.star-mammootty','Mammootty'],['.support-srk','Shah Rukh Khan'],['.support-vijay','Vijay'],['.support-allu','Allu Arjun'],['.actress-one','Deepika'],['.actress-two','Samantha'],['.cast-parvathy','Parvathy'],['.cast-nayanthara','Nayanthara'],['.cast-rajinikanth','Rajinikanth']];
 const stage=document.querySelector('.cinema'),reduce=matchMedia('(prefers-reduced-motion: reduce)');if(!stage)return;
 const items=slots.map(([selector,name])=>({card:stage.querySelector(selector),sequence:window.greatCastFilms?.[name]||[],index:0,ready:false,errors:0,player:null,loop:null})).filter(x=>x.card);
 let current=0,visible=true,timer=null,apiReady=false;
 const allowed=()=>!reduce.matches&&!navigator.connection?.saveData;
 const active=()=>allowed()&&visible&&!document.hidden&&!document.body.classList.contains('motion-paused');
 const featured=item=>items[current]===item;
 const cancel=item=>{clearTimeout(item.loop);item.loop=null};
 stage.classList.add('star-procession');
 function position(){items.forEach((item,i)=>{const offset=(i-current+items.length)%items.length;item.card.dataset.position=offset===0?'current':offset===1?'next':offset===2?'waiting':offset===items.length-1?'previous':'hidden';item.card.setAttribute('aria-hidden',offset===0?'false':'true')});stage.dataset.activeStar=items[current].card.querySelector('img')?.alt||''}
 function restart(item){if(!active()||!featured(item)||!item.ready)return;cancel(item);item.card.classList.add('tile-crossfade');item.index=(item.index+1)%item.sequence.length;item.film=item.sequence[item.index];item.player.loadVideoById({videoId:item.film.id,startSeconds:item.film.start,endSeconds:item.film.end})}
 function schedule(item){cancel(item);if(!active()||!featured(item))return;const time=Math.max(item.film.start,item.player.getCurrentTime()||item.film.start);item.loop=setTimeout(()=>restart(item),Math.max(250,(item.film.end-time)*1000))}
 function ensure(item){if(item.player||!apiReady||!allowed()||!item.sequence.length)return;item.film=item.sequence[item.index];
  const surface=document.createElement('div');surface.className='tile-video';surface.setAttribute('aria-hidden','true');const mount=document.createElement('div');mount.id='actor-preview-'+items.indexOf(item);surface.append(mount);item.card.append(surface);
  function size(){const h=Math.max(300,item.card.clientHeight*1.25,item.card.clientWidth*1.4);surface.style.setProperty('--player-cover-width',(h*16/9)+'px');surface.style.setProperty('--player-cover-height',h+'px')}
  new ResizeObserver(size).observe(item.card);size();item.card.dataset.previewStatus='loading';
  item.player=window.greatFilmPlayer(mount.id,item.film,{width:400,height:500,events:{
   onReady:e=>{item.ready=true;e.target.mute();if(active()&&featured(item))e.target.playVideo();else e.target.pauseVideo()},
   onStateChange:e=>{if(e.data===1){if(!active()||!featured(item)){item.player.pauseVideo();return}item.card.dataset.previewStatus='playing';item.card.classList.add('tile-playing');item.card.classList.remove('tile-crossfade');schedule(item)}else if(e.data===0)restart(item);else if(e.data===2||e.data===3){cancel(item);item.card.dataset.previewStatus=e.data===3?'buffering':'paused'}},
   onError:e=>{cancel(item);if(item.ready&&featured(item)&&++item.errors<item.sequence.length){restart(item);return}item.card.dataset.previewStatus='unavailable';item.card.dataset.previewError=String(e.data);item.card.classList.remove('tile-playing','tile-crossfade')},
   onAutoplayBlocked:()=>{item.card.dataset.previewStatus='autoplay-blocked';item.card.classList.remove('tile-playing')}
  }});
 }
 function playback(){items.forEach(item=>{cancel(item);if(!item.ready)return;item.player.mute();if(active()&&featured(item))item.player.playVideo();else item.player.pauseVideo()});if(active()){ensure(items[current]);ensure(items[(current+1)%items.length])}}
 function tick(){clearTimeout(timer);if(!active())return;timer=setTimeout(()=>{current=(current+1)%items.length;position();playback();tick()},14000)}
 function sync(){playback();tick()}
 position();tick();
 window.greatYouTubeReady().then(()=>{apiReady=true;playback()}).catch(()=>{stage.dataset.videoStatus='unavailable'});
 new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;sync()},{threshold:.04}).observe(stage);
 document.addEventListener('visibilitychange',sync);
 document.getElementById('motion-toggle')?.addEventListener('click',sync);
 reduce.addEventListener('change',sync);
})();
