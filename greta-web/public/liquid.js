/* One moving glass surface per menu, with interruptible section navigation. */
(()=>{
 const reduce=matchMedia('(prefers-reduced-motion: reduce)');
 const groups=new Map();
 function enhance(group,selector){
  if(!group||groups.has(group))return;
  const lens=document.createElement('span');lens.className='liquid-lens';lens.setAttribute('aria-hidden','true');group.prepend(lens);group.classList.add('liquid-menu');
  let last,frame;const items=()=>Array.from(group.querySelectorAll(selector)).filter(e=>e.parentElement===group&&e.getBoundingClientRect().width>0);
  const selected=()=>items().find(e=>e.matches('.active,[aria-current],[aria-pressed="true"]'));
  function place(target=selected(),snap=false){cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(!target){lens.style.opacity='0';return}const a=group.getBoundingClientRect(),b=target.getBoundingClientRect();if(!b.width)return;lens.classList.toggle('lens-snap',snap||reduce.matches);lens.style.width=b.width+'px';lens.style.height=b.height+'px';lens.style.transform=`translate3d(${b.left-a.left+group.scrollLeft-group.clientLeft}px,${b.top-a.top+group.scrollTop-group.clientTop}px,0)`;lens.style.opacity='1';last=target;group.querySelectorAll('.liquid-target').forEach(e=>e.classList.remove('liquid-target'));target.classList.add('liquid-target')})}
  group.addEventListener('pointerover',e=>{if(e.pointerType==='touch')return;const t=e.target.closest(selector);if(t&&t.parentElement===group)place(t)});
  group.addEventListener('pointerleave',()=>place());group.addEventListener('focusin',e=>{const t=e.target.closest(selector);if(t)place(t)});group.addEventListener('focusout',e=>{if(!group.contains(e.relatedTarget))place()});
  group.addEventListener('click',e=>{const t=e.target.closest(selector);if(t)place(t)});
  new MutationObserver(records=>{if(records.some(r=>r.type==='childList'||r.attributeName==='aria-current'||r.attributeName==='aria-pressed'||r.attributeName==='class'&&r.target!==lens&&(String(r.oldValue||'').split(/\s+/).includes('active')!==r.target.classList.contains('active'))))place()}).observe(group,{subtree:true,childList:true,attributes:true,attributeOldValue:true,attributeFilter:['class','aria-pressed','aria-current']});
  const resize=new ResizeObserver(()=>place(last||selected(),true));resize.observe(group);groups.set(group,place);place(undefined,true);
 }
 enhance(document.querySelector('.nav-links'),'a[href^="#"]');
 enhance(document.getElementById('language-tabs'),'button');enhance(document.getElementById('type-tabs'),'button');enhance(document.getElementById('regions'),'button');enhance(document.querySelector('.amounts'),'button');enhance(document.getElementById('cast-controls'),'button');
 let scrollFrame,scrolling=false;
 const links=Array.from(document.querySelectorAll('.nav-links>a[href^="#"],.mobile-menu a[href^="#"]'));
 function mark(id){links.forEach(a=>a.hash==='#'+id?a.setAttribute('aria-current','location'):a.removeAttribute('aria-current'))}
 function cancel(){cancelAnimationFrame(scrollFrame);scrolling=false}
 ['wheel','touchstart','pointerdown'].forEach(type=>window.addEventListener(type,cancel,{passive:true}));window.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End','Escape',' '].includes(e.key))cancel()});
 function glide(target){cancel();const start=scrollY,header=document.querySelector('.header')?.getBoundingClientRect().bottom||90,end=Math.max(0,Math.min(document.documentElement.scrollHeight-innerHeight,target.getBoundingClientRect().top+start-header-28)),distance=end-start;if(reduce.matches){window.scrollTo(0,end);return}const duration=Math.min(1050,Math.max(550,Math.abs(distance)*.22)),begin=performance.now();scrolling=true;function tick(now){const p=Math.min(1,(now-begin)/duration),ease=p<.5?16*p**5:1-(-2*p+2)**5/2;window.scrollTo(0,start+distance*ease);if(p<1)scrollFrame=requestAnimationFrame(tick);else scrolling=false}scrollFrame=requestAnimationFrame(tick)}
 document.addEventListener('click',e=>{const a=e.target.closest('a[href]');if(!a||e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||a.target==='_blank'||a.hasAttribute('download'))return;const u=new URL(a.href,location.href);if(u.origin!==location.origin||u.pathname!==location.pathname||u.search!==location.search||!u.hash)return;let target;try{target=document.getElementById(decodeURIComponent(u.hash.slice(1)))}catch{}if(!target)return;e.preventDefault();if(location.hash!==u.hash)history.pushState(null,'',u.hash);mark(target.id);glide(target);const menu=a.closest('.mobile-menu');if(menu){const panel=menu.querySelector('div');if(reduce.matches)menu.removeAttribute('open');else panel.animate([{opacity:1,transform:'translateY(0) scale(1)'},{opacity:0,transform:'translateY(-5px) scale(.97)'}],{duration:160,easing:'ease-in',fill:'forwards'}).finished.then(()=>{menu.removeAttribute('open');panel.getAnimations().forEach(a=>a.cancel())}).catch(()=>{})}if(e.detail===0){target.setAttribute('tabindex','-1');target.focus({preventScroll:true});target.addEventListener('blur',()=>target.removeAttribute('tabindex'),{once:true})}});
 const sections=['configure','discover','features','maintenance','feedback'].map(id=>document.getElementById(id)).filter(Boolean);let spyFrame;
 function spy(){if(scrolling)return;let current;const line=(document.querySelector('.header')?.getBoundingClientRect().bottom||90)+100;for(const s of sections)if(s.getBoundingClientRect().top<=line)current=s.id;if(current)mark(current);else links.forEach(a=>a.removeAttribute('aria-current'))}
 window.addEventListener('scroll',()=>{cancelAnimationFrame(spyFrame);spyFrame=requestAnimationFrame(spy)},{passive:true});document.fonts?.ready.then(()=>groups.forEach(place=>place(undefined,true)));spy();
})();
