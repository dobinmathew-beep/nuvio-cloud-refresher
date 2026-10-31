/* Official embedded footage; no copied movie files or streaming feeds. */
const films=[
 {name:'Mohanlal',film:'Lucifer',language:'Malayalam',id:'-1rT04_lLn0',start:20,end:44},
 {name:'Mammootty',film:'Bheeshma Parvam',language:'Malayalam',id:'4dJE1yH-9V0',start:14,end:38},
 {name:'Parvathy',film:'Uyare',language:'Malayalam',id:'VD50OZ89JPU',start:9,end:33},
 {name:'Vijay',film:'Master',language:'Tamil',id:'UTiXQcrLlv4',start:18,end:42},
 {name:'Nayanthara',film:'Aramm',language:'Tamil',id:'hWsn_1cs6Dc',start:15,end:39},
 {name:'Allu Arjun',film:'Pushpa',language:'Telugu',id:'Q1NKMPhP8PY',start:17,end:41},
 {name:'Samantha',film:'Yashoda',language:'Telugu',id:'c8pvrUovnvw',start:15,end:39},
 {name:'Shah Rukh Khan',film:'Jawan',language:'Hindi',id:'COv52Qyctws',start:18,end:42},
 {name:'Deepika',film:'Piku',language:'Hindi',id:'oprUxgiaNjw',start:13,end:37},
 {name:'Rajinikanth',film:'Jailer',language:'Tamil',id:'Y5BeWdODPqo',start:20,end:44}
];
const backdrop=document.getElementById('film-backdrop'),play=document.getElementById('cinema-play'),caption=document.getElementById('cinema-caption'),rail=document.getElementById('cast-controls'),source=document.getElementById('film-source');
let player,index=0,enabled=false,ready=false,advanceTimer,fadeTimer,loadTimer,playing=false,failures=0;const reducedVideo=matchMedia('(prefers-reduced-motion: reduce)');
function mark(){const f=films[index];rail.querySelectorAll('button').forEach((b,i)=>b.setAttribute('aria-pressed',String(i===index&&enabled)));caption.textContent=enabled?f.name+' · '+f.film+' · Sound off':'Official film previews · Sound off';source.href='https://www.youtube.com/watch?v='+f.id;source.textContent=f.film+' · Official preview ↗';play.innerHTML='<span aria-hidden="true">'+(enabled?'Ⅱ':'▷')+'</span> '+(enabled?'Pause cinema background':'Play cinema background');play.setAttribute('aria-pressed',String(enabled))}
function clearTimers(){clearTimeout(advanceTimer);clearTimeout(fadeTimer);clearTimeout(loadTimer)}
function next(){if(!enabled)return;choose((index+1)%films.length)}
function choose(n){clearTimers();playing=false;index=n;backdrop.classList.remove('is-playing');mark();if(!enabled)return;if(!player){init();return}if(!ready)return;fadeTimer=setTimeout(()=>{const f=films[index];player.mute();player.loadVideoById({videoId:f.id,startSeconds:f.start,endSeconds:f.end});loadTimer=setTimeout(()=>{if(!playing){backdrop.classList.remove('is-playing');caption.textContent='Preview unavailable here · Choose another star';}},15000)},500)}
function stop(){enabled=false;playing=false;clearTimers();backdrop.classList.remove('is-enabled');backdrop.classList.remove('is-playing');if(ready)player.pauseVideo();mark()}
function start(n=index){enabled=true;backdrop.classList.add('is-enabled');failures=0;choose(n)}
function init(){if(window.YT?.Player){create();return}if(document.getElementById('youtube-background-api'))return;const script=document.createElement('script');script.id='youtube-background-api';script.src='https://www.youtube.com/iframe_api';script.async=true;script.onerror=()=>{stop();caption.textContent='Video previews could not load. The catalog is still available.'};window.onYouTubeIframeAPIReady=create;document.head.append(script)}
function create(){if(player)return;const f=films[index];player=new YT.Player('backdrop-player',{host:'https://www.youtube-nocookie.com',width:'1920',height:'1080',videoId:f.id,playerVars:{autoplay:1,mute:1,controls:0,playsinline:1,rel:0,disablekb:1,fs:0,start:f.start,end:f.end,origin:location.origin},events:{onReady:e=>{ready=true;e.target.mute();if(enabled){e.target.playVideo();loadTimer=setTimeout(()=>{if(!playing){stop();caption.textContent='Tap play to start the cinema background'}},18000)}else e.target.pauseVideo()},onStateChange:e=>{playing=e.data===1;if(playing&&enabled){clearTimeout(loadTimer);failures=0;backdrop.classList.add('is-playing');mark();clearTimeout(advanceTimer);advanceTimer=setTimeout(next,(films[index].end-films[index].start)*1000)}else if(e.data===0&&enabled){next()}},onError:()=>{backdrop.classList.remove('is-playing');if(++failures<films.length)next();else{stop();caption.textContent='Film previews are unavailable in this browser. Use the official preview link.'}},onAutoplayBlocked:()=>{stop();caption.textContent='Tap play to start the cinema background'}}})}
films.forEach((f,i)=>{const b=document.createElement('button');b.className='cast-chip';b.type='button';b.textContent=f.name;b.title=f.film+' · '+f.language;b.setAttribute('aria-label',f.name+' in '+f.film+', '+f.language);b.setAttribute('aria-pressed','false');b.addEventListener('click',()=>start(i));rail.append(b)});
play.addEventListener('click',()=>enabled?stop():start());
document.getElementById('motion-toggle')?.addEventListener('click',()=>{if(document.body.classList.contains('motion-paused'))stop()});
document.addEventListener('visibilitychange',()=>{if(!ready)return;if(document.hidden){player.pauseVideo();clearTimeout(advanceTimer)}else if(enabled){player.playVideo()}});
reducedVideo.addEventListener('change',e=>{if(e.matches)stop()});
mark();let paused=false;try{paused=localStorage.getItem('great-motion-paused')==='true'}catch{}if(!reducedVideo.matches&&!paused&&!navigator.connection?.saveData)start();
