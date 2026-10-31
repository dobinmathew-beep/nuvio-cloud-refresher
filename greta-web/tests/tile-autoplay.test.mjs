import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const runtime=await readFile(new URL('../public/youtube-runtime.js',import.meta.url),'utf8');
const tiles=await readFile(new URL('../public/tile-clips.js',import.meta.url),'utf8');
const cinema=await readFile(new URL('../public/cinema.js',import.meta.url),'utf8');
async function setup(){
 const players=[],cards=new Map(),elements=[],timers=[];
 function element(tag){const classes=new Set();const x={tag,id:'',dataset:{},clientWidth:185,style:{setProperty(){}},classList:{contains:c=>classes.has(c),add:c=>classes.add(c),remove:c=>classes.delete(c)},append(){}};elements.push(x);return x}
 const stage={querySelector(selector){if(!cards.has(selector))cards.set(selector,element('figure'));return cards.get(selector)}};
 const YT={Player:class{constructor(mount,options){this.mount=mount;this.options=options;this.plays=0;this.seeks=[];players.push(this)}mute(){}playVideo(){this.plays++}pauseVideo(){}getCurrentTime(){return this.options.playerVars.start+1}seekTo(n){this.seeks.push(n)}}};
 const context=vm.createContext({window:{YT},YT,location:{origin:'https://example.test'},navigator:{},document:{hidden:false,body:element('body'),querySelector:()=>stage,getElementById:()=>null,createElement:tag=>({...element(tag),setAttribute(){}}),addEventListener(){}},matchMedia:()=>({matches:false,addEventListener(){}}),IntersectionObserver:class{observe(){}},ResizeObserver:class{observe(){}},setTimeout:f=>{timers.push(f);return timers.length},clearTimeout(){}});
 vm.runInContext(cinema.slice(0,cinema.indexOf('];')+2),context);
 vm.runInContext(runtime,context);vm.runInContext(tiles,context);
 await Promise.resolve();await Promise.resolve();
 return {players,cards,elements,timers};
}
test('all ten tile players request muted inline autoplay before any source becomes ready',async()=>{
 const {players,elements}=await setup();assert.equal(players.length,10);assert.equal(new Set(players.map(p=>p.options.videoId)).size,10);
 for(const p of players){assert.equal(p.options.host,'https://www.youtube-nocookie.com');assert.equal(p.options.playerVars.autoplay,1);assert.equal(p.options.playerVars.mute,1);assert.equal(p.options.playerVars.playsinline,1);assert.equal(p.options.playerVars.controls,0)}
 assert.equal(elements.filter(e=>e.tag==='button').length,0);
});
test('one unavailable film cannot block autoplay in the other nine tiles',async()=>{
 const {players,cards}=await setup();players[0].options.events.onError({data:100});
 for(const p of players.slice(1)){p.options.events.onReady({target:p});p.options.events.onStateChange({data:1})}
 assert.equal(players.slice(1).filter(p=>p.plays===1).length,9);assert.equal([...cards.values()].filter(c=>c.dataset.previewStatus==='playing').length,9);
});
test('an ended preview restarts its own film window automatically',async()=>{
 const {players}=await setup();const p=players[0];p.options.events.onReady({target:p});p.options.events.onStateChange({data:0});assert.deepEqual(p.seeks,[p.options.playerVars.start]);assert.equal(p.plays,2);assert.equal(players[1].plays,0);
});
