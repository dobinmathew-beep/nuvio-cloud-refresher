import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const runtime=await readFile(new URL('../public/youtube-runtime.js',import.meta.url),'utf8');
const cast=await readFile(new URL('../public/cast-films.js',import.meta.url),'utf8');
const tiles=await readFile(new URL('../public/tile-clips.js',import.meta.url),'utf8');
const cinema=await readFile(new URL('../public/cinema.js',import.meta.url),'utf8');
async function setup(){
 const players=[],cards=new Map(),elements=[],timers=[];
 function element(tag){const classes=new Set();const x={tag,id:'',dataset:{},clientWidth:185,clientHeight:350,setAttribute(){},querySelector(){return {alt:'Star'}},style:{setProperty(){}},classList:{contains:c=>classes.has(c),add:c=>classes.add(c),remove:c=>classes.delete(c)},append(){}};elements.push(x);return x}
 const stage={...element('stage'),querySelector(selector){if(!cards.has(selector))cards.set(selector,element('figure'));return cards.get(selector)}};
 const YT={Player:class{constructor(mount,options){this.mount=mount;this.options=options;this.plays=0;this.seeks=[];players.push(this)}getAvailablePlaybackRates(){return [1,1.25,1.5,2]}setPlaybackRate(rate){this.rate=rate}getPlaybackRate(){return this.rate||1}mute(){}playVideo(){this.plays++}pauseVideo(){this.pauses=(this.pauses||0)+1}getCurrentTime(){return this.options.playerVars.start+1}loadVideoById(clip){this.loads??=[];this.loads.push(clip)}seekTo(n){this.seeks.push(n)}}};
 const context=vm.createContext({window:{YT},YT,location:{origin:'https://example.test'},navigator:{},document:{hidden:false,body:element('body'),querySelector:()=>stage,getElementById:()=>null,createElement:tag=>({...element(tag),setAttribute(){}}),addEventListener(){}},matchMedia:()=>({matches:false,addEventListener(){}}),IntersectionObserver:class{observe(){}},ResizeObserver:class{observe(){}},setTimeout:f=>{timers.push(f);return timers.length},clearTimeout(){}});
 vm.runInContext(cinema.slice(0,cinema.indexOf('];')+2),context);
 vm.runInContext(runtime,context);vm.runInContext(cast,context);vm.runInContext(tiles,context);
 await Promise.resolve();await Promise.resolve();
 return {players,cards,elements,timers};
}
test('only the current and next star load, with muted inline autoplay and no controls',async()=>{
 const {players,elements}=await setup();assert.equal(players.length,2);
 for(const p of players){assert.equal(p.options.host,'https://www.youtube-nocookie.com');assert.equal(p.options.playerVars.autoplay,1);assert.equal(p.options.playerVars.mute,1);assert.equal(p.options.playerVars.playsinline,1);assert.equal(p.options.playerVars.controls,0)}
 assert.equal(elements.filter(e=>e.tag==='button').length,0);
 players.forEach(p=>p.options.events.onReady({target:p}));assert.equal(players[0].plays,1);assert.equal(players[1].plays,0);assert.equal(players[1].pauses,1);
});
test('a stalled film does not stall the star sequence or keep the previous film playing',async()=>{
 const {players,cards,timers}=await setup();const previous=players[0];previous.options.events.onReady({target:previous});players[1].options.events.onReady({target:players[1]});
 previous.options.events.onError({data:100});timers[0]();
 assert.equal(cards.get('.star-mammootty').dataset.position,'current');assert.equal(cards.get('.star-mohanlal').dataset.position,'previous');assert.equal(players[1].plays,1);assert.ok(previous.pauses>0);assert.equal(players.length,3);
});
test('the sequence visits all ten stars and returns to Mohanlal',async()=>{
 const {cards,timers}=await setup();for(let i=0;i<10;i++)timers[i]();assert.equal(cards.size,10);assert.equal(cards.get('.star-mohanlal').dataset.position,'current');assert.equal([...cards.values()].filter(c=>c.dataset.position==='current').length,1);
});
test('an ended preview advances to a different film in that actor’s rotation',async()=>{
 const {players}=await setup();const p=players[0];p.options.events.onReady({target:p});p.options.events.onStateChange({data:0});assert.equal(p.loads.length,1);assert.notEqual(p.loads[0].videoId,p.options.videoId);assert.equal(p.plays,1);assert.equal(players[1].plays,0);
});

test('every actor has multiple distinct film sources',()=>{const ctx=vm.createContext({window:{}});vm.runInContext(cast,ctx);for(const sources of Object.values(ctx.window.greatCastFilms))assert.ok(new Set(sources.map(s=>s.id)).size>=2)});

test('featured clips request 1.5x playback and hide paused player surfaces',async()=>{
 const {players,cards}=await setup();const p=players[0];p.options.events.onReady({target:p});p.options.events.onStateChange({data:1});assert.equal(p.rate,1.5);const card=cards.get('.star-mohanlal');assert.ok(card.classList.contains('tile-playing'));p.options.events.onStateChange({data:2});assert.equal(card.classList.contains('tile-playing'),false);
});
