"""IMDb-matched digital-release catalogs. Public sources only; no AI or paid API."""
from pathlib import Path
from datetime import datetime,timedelta,date,timezone
from zoneinfo import ZoneInfo
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote,urljoin
from bs4 import BeautifulSoup
from rapidfuzz.fuzz import ratio
import ast,json,re,subprocess,os,unicodedata,threading,base64,io,textwrap
from PIL import Image,ImageDraw,ImageFont
import alternate,physical,series_sources,episode_badges
ROOT=Path(__file__).resolve().parent;DATA=ROOT/'data';DATA.mkdir(exist_ok=True)
LANGS={'malayalam':'ml','tamil':'ta','telugu':'te','hindi':'hi'};ZONE=ZoneInfo('Asia/Muscat');NOW=datetime.now(ZONE);TODAY=NOW.date().isoformat()
BASE=os.environ.get('ADDON_ORIGIN','https://dobins-indian-catalog.quickfield138.chatgpt.site');POLICY='confirmed-digital-imdb-v1'
def load(n,default):
 try:return json.loads((DATA/n).read_text())
 except (FileNotFoundError,ValueError):return default
def save(n,obj):
 p=DATA/n;t=p.with_suffix('.tmp');t.write_text(json.dumps(obj,ensure_ascii=False,indent=2));t.replace(p)
def get(url,json_data=True):
 p=subprocess.run(['curl','-fsSL','--retry','1','--connect-timeout','10','--max-time','30','-A','DobinsIndianCatalog/1.0 (public release metadata)',url],capture_output=True)
 if p.returncode:raise RuntimeError('Source unavailable: '+url)
 return json.loads(p.stdout) if json_data else p.stdout.decode('utf-8','replace')
def norm(s):
 s=unicodedata.normalize('NFKD',str(s)).lower().replace('&',' and ')
 s=re.sub(r'\b(?:season|s)\s*\d+\b|\((?:series|web series)\)',' ',s,flags=re.I)
 return re.sub(r'[^a-z0-9]+','',s.removeprefix('the '))
def cycle(now=NOW):
 ds=[]
 for delta in (0,1,2):
  d=now.date()-timedelta(days=delta)
  for h in ([1,6,18] if d.weekday() in (3,4,5) else [6,18]):
   dt=datetime.combine(d,datetime.min.time(),ZONE)+timedelta(hours=h)
   if dt<=now:ds.append(dt)
 return max(ds).isoformat()

def dailyott():
 first=get('https://www.dailyott.in/api/movies?limit=200&page=1');assert first.get('status')=='success'
 rows=first.get('movies',[]);pages=min(int(first.get('totalPages',1)),8)
 def page(n):return get(f'https://www.dailyott.in/api/movies?limit=200&page={n}').get('movies',[])
 with ThreadPoolExecutor(max_workers=4) as pool:
  for batch in pool.map(page,range(2,pages+1)):rows.extend(batch)
 if len(rows)<20:raise RuntimeError('DailyOTT response unexpectedly empty')
 return rows

def collect():
 health=[];old=load('sources.json',{});out=[];raw=[]
 try:raw=dailyott();old['dailyott']={'checkedAt':NOW.isoformat(),'records':raw};health.append({'source':'DailyOTT','url':'https://www.dailyott.in/','state':'live','records':len(raw)})
 except Exception as e:
  # The public frontend embeds the same structured snapshot; discover its hashed asset.
  try:
   html=get('https://www.dailyott.in/',False);s=BeautifulSoup(html,'html.parser');src=next(x['src'] for x in s.select('script[src]') if '/assets/index-' in x['src']);js=get(urljoin('https://www.dailyott.in',src),False)
   match=re.search(r'movies:JSON.parse\(`(.*?)`\)',js,re.S);groups=json.loads(ast.literal_eval("'''"+match.group(1)+"'''"));raw=list({x['_id']:x for v in groups.values() for x in v}.values());assert len(raw)>20
   old['dailyott']={'checkedAt':NOW.isoformat(),'records':raw};health.append({'source':'DailyOTT','state':'frontend-fallback','records':len(raw)})
  except Exception:
   raw=old.get('dailyott',{}).get('records',[]);health.append({'source':'DailyOTT','state':'cached' if raw else 'failed','error':str(e)})
 kinds={}
 for m in raw:
  day=str(m.get('releaseDate',''))[:10];typ={'Movie':'movie','Series':'series'}.get(m.get('type'))
  if not typ or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',day) or day>TODAY:continue
  if not (m.get('verified') or m.get('source_verified')):continue
  langs=[str(x).lower() for x in m.get('languages',[]) if str(x).lower() in LANGS]
  original=str(m.get('tmdbDetails',{}).get('originalLanguage') or m.get('original_language') or '').lower()
  if original in LANGS:langs=[original]
  elif original in LANGS.values():langs=[next(k for k,v in LANGS.items() if v==original)]
  for lang in langs:
   out.append({'name':m['title'],'language':lang,'type':typ,'ottDate':day,'platforms':[m.get('platform','')],'poster':m.get('posterUrl'),'description':m.get('tmdbDetails',{}).get('overview',''),'year':str(m.get('tmdbDetails',{}).get('releaseDate',''))[:4] or None,'source':'https://www.dailyott.in/','sourceId':m.get('_id'),'confirmed':True,'sourceRecord':m})
   kinds.setdefault(norm(m['title']),set()).add(typ)
 try:
  html=get('https://cinebuds.com/ott-release-dates/',False);s=BeautifulSoup(html,'html.parser');rows=s.select('table.ott-table--recent tr.ott-row');assert len(rows)>5
  latest=[]
  for r in rows:
   ti=r.select_one('time[datetime]');a=r.select_one('.ott-title');langnode=r.select_one('.ott-lang')
   if not ti or not a or not langnode:continue
   day=ti['datetime'][:10];name=a.get_text(' ',strip=True);ls=langnode.get_text(' ',strip=True).lower();lang=next((l for l in LANGS if ls.startswith(l)),None)
   if not lang or day>TODAY:continue
   ks=kinds.get(norm(name),set());typ='series' if 'series' in name.lower() else next(iter(ks)) if len(ks)==1 else 'movie'
   image=r.select_one('img');latest.append({'name':name,'language':lang,'type':typ,'ottDate':day,'platforms':[x.get_text(' ',strip=True) for x in r.select('.cb-badge')],'poster':image.get('src') if image else None,'year':None,'source':'https://cinebuds.com/ott-release-dates/','detail':a.get('href'),'confirmed':True})
  out.extend(latest);old['cinebuds']={'checkedAt':NOW.isoformat(),'records':latest};health.append({'source':'Cinebuds','url':'https://cinebuds.com/ott-release-dates/','state':'live','records':len(latest)})
 except Exception as e:
  cached=old.get('cinebuds',{}).get('records',[]);out.extend(cached);health.append({'source':'Cinebuds','state':'cached' if cached else 'failed','error':str(e)})
 save('sources.json',old)
 if not any(x['state'] in ('live','frontend-fallback') for x in health):raise RuntimeError('All digital-release sources unavailable; last-good catalogs retained')
 merged={}
 for e in out:
  key=(e['language'],e['type'],norm(e['name']))
  if key not in merged:merged[key]={**e,'sources':[e['source']]}
  else:
   m=merged[key];m['sources']=list(set(m['sources']+[e['source']]));m['platforms']=list(set(m['platforms']+e['platforms']))
   # First digital premiere wins across sources; a later new-platform date must not reset it.
   if (e['type']=='series' and e['ottDate']>m['ottDate']) or (e['type']=='movie' and e['ottDate']<m['ottDate']):m['ottDate']=e['ottDate']
 return list(merged.values()),health

def candidate_index():
 cache=load('candidates.json',{});pool=[]
 def f(k):
  lang,typ=k;cat=LANGS[lang]+('_series' if typ=='series' else '');url=f'https://83e20802dcf1-indian-streams.baby-beamup.club/catalog/{typ}/{cat}.json'
  try:
   ms=get(url).get('metas',[]);cache[lang+'-'+typ]=ms
  except Exception:ms=cache.get(lang+'-'+typ,[])
  return [dict(m,language=lang,type=typ) for m in ms if re.fullmatch(r'tt\d+',str(m.get('id',''))) and m.get('name')]
 with ThreadPoolExecutor(max_workers=4) as ex:
  for ms in ex.map(f,[(l,t) for l in LANGS for t in ('movie','series')]):pool.extend(ms)
 save('candidates.json',cache);return pool

def select_candidate(e,pool):
 matches=[]
 for m in pool:
  if m.get('type')!=e['type'] or m.get('language')!=e['language']:continue
  score=ratio(norm(e['name']),norm(m.get('name','')))
  year=int(str(m.get('releaseInfo','0'))[:4]) if str(m.get('releaseInfo','0'))[:4].isdigit() else 0
  if year>int(e['ottDate'][:4]) or (e.get('year') and year and str(year)!=str(e['year'])):continue
  if score>=97:matches.append((score,year,m))
 if not matches:return None
 matches.sort(key=lambda x:(x[0],x[1]),reverse=True)
 if len(matches)>1 and matches[0][:2]==matches[1][:2] and matches[0][2]['id']!=matches[1][2]['id']:return None
 return matches[0][2]

def suggestion(e):
 q=re.sub(r'\s*\((?:Season\s*\d+|Series)\)|\bSeason\s*\d+','',e['name'],flags=re.I).strip();url='https://v3.sg.media-imdb.com/suggestion/x/'+quote(q,safe='')+'.json'
 try:data=get(url).get('d',[])
 except Exception:return None
 options=[]
 for x in data:
  if not re.fullmatch(r'tt\d+',str(x.get('id',''))):continue
  typ='series' if x.get('qid') in ('tvSeries','tvMiniSeries') else 'movie' if x.get('qid') in ('movie','tvMovie','video') else None
  if typ!=e['type']:continue
  score=ratio(norm(q),norm(x.get('l','')));year=x.get('y',0)
  if score<97 or not year or year>int(e['ottDate'][:4]):continue
  if e.get('year') and str(year)!=str(e['year']):continue
  if int(e['ottDate'][:4])-year>4 and not e.get('year'):continue
  options.append((score,year,x))
 options.sort(key=lambda x:(x[0],x[1]),reverse=True)
 if not options or (len(options)>1 and options[0][:2]==options[1][:2]):return None
 x=options[0][2];return {'id':x['id'],'name':x['l'],'type':e['type'],'releaseInfo':str(x.get('y','')),'poster':x.get('i',{}).get('imageUrl')}

def metadata(mid,typ,fallback):
 try:
  m=get(f'https://v3-cinemeta.strem.io/meta/{typ}/{mid}.json').get('meta',{})
  if m.get('id')!=mid or m.get('type')!=typ:raise ValueError('IMDb metadata mismatch')
  m['_metadataCheckedAt']=NOW.isoformat();m['_partial']=False;return m
 except Exception:return {'_metadataCheckedAt':NOW.isoformat(),'_partial':True,'id':mid,'type':typ,'name':fallback['name'],'poster':fallback.get('poster'),'releaseInfo':str(fallback.get('releaseInfo',''))}

def title_logo(name):
 im=Image.new('RGBA',(1200,300));d=ImageDraw.Draw(im)
 try:font=ImageFont.truetype('DejaVuSans-Bold.ttf',90)
 except OSError:font=ImageFont.load_default(size=90)
 lines=textwrap.wrap(name,24)[:2] or [name];text='\n'.join(lines);box=d.multiline_textbbox((0,0),text,font=font,spacing=12,align='center',stroke_width=1)
 w,h=box[2]-box[0],box[3]-box[1];x=(1200-w)//2;y=(300-h)//2-box[1]
 d.multiline_text((x,y+3),text,font=font,spacing=12,align='center',fill=(0,0,0,150),stroke_width=3,stroke_fill=(0,0,0,100))
 d.multiline_text((x,y),text,font=font,spacing=12,align='center',fill=(250,248,241,255),stroke_width=1,stroke_fill=(255,255,255,255))
 crop=im.getbbox();im=im.crop((max(0,crop[0]-10),max(0,crop[1]-10),min(1200,crop[2]+10),min(300,crop[3]+10))) if crop else im
 b=io.BytesIO();im.save(b,format='PNG',optimize=True);return base64.b64encode(b.getvalue()).decode()

def build():
 events,health=collect();series_events,series_health=series_sources.collect(get,load,save,LANGS,TODAY,NOW,norm);events.extend(series_events);health.extend(series_health);disc_events,disc_health=physical.collect(get,load,save,LANGS,TODAY,NOW,norm);events=physical.merge_events(events+disc_events,norm);health.extend(disc_health);pool=candidate_index();matches=load('matches.json',{});metas=load('metadata.json',{});old_catalogs=load('catalogs.json',{});unmatched=[]
 for m in metas.values():
  for field,kind in [('poster','posters'),('background','backgrounds')]:
   if str(m.get(field,'')).startswith(BASE):m[field]=next((x for x in m.get('artwork',{}).get(kind,[]) if not x.startswith(BASE)),None)
 # Fair backfill: give each of the eight catalogs a turn, newest first.
 buckets={(l,t):sorted([e for e in events if e['language']==l and e['type']==t],key=lambda e:e['ottDate'],reverse=True) for l in LANGS for t in ('movie','series')}
 ordered=[]
 for i in range(max(map(len,buckets.values()),default=0)):
  for es in buckets.values():
   if i<len(es):ordered.append(es[i])
 # Source collectors have already verified identity and release evidence. Do not
 # make verified backfill compete with unrelated fuzzy-search matching budgets.
 for e in ordered:
  verified=e.get('_verifiedMetadata')
  if not verified or verified.get('type')!='series' or not verified.get('id'):continue
  key=e['language']+'|series|'+norm(e['name']);mid=verified['id'];mk=alternate.key('series',mid)
  metas[mk]={**metas.get(mk,{}),**{k:v for k,v in verified.items() if v is not None},'_metadataCheckedAt':NOW.isoformat(),'_partial':False}
  matches[key]={'id':mid,'checkedAt':NOW.isoformat(),'alternatePolicy':alternate.POLICY,'method':verified.get('metadataSource','Verified series source')}
 budget=int(os.environ.get('MAX_NEW_MATCHES','160'));attempts=0;work=[]
 for e in ordered:
  key=e['language']+'|'+e['type']+'|'+norm(e['name']);cached=matches.get(key)
  if cached and alternate.key(e['type'],cached.get('id','')) in metas:
   checked=metas[alternate.key(e['type'],cached['id'])].get('_metadataCheckedAt')
   if checked and (NOW-datetime.fromisoformat(checked)).total_seconds()<10800:continue
  if cached and cached.get('alternatePolicy')==alternate.POLICY and not cached.get('id') and not e.get('_verifiedMetadata') and (NOW-datetime.fromisoformat(cached['checkedAt'])).total_seconds()<21600:continue
  if attempts>=budget:continue
  work.append((key,e));attempts+=1
 def resolve(pair):
  key,e=pair;existing=matches.get(key,{}).get('id');mk=alternate.key(e['type'],existing or '');c=metas.get(mk) or select_candidate(e,pool) or e.get('_verifiedMetadata') or suggestion(e)
  m=e.get('_verifiedMetadata') if c and e.get('_verifiedMetadata',{}).get('id')==c['id'] else None
  if c:
   mid=c['id'];previous=metas.get(alternate.key(e['type'],mid));checked=previous.get('_metadataCheckedAt') if previous else None
   if previous and checked and (NOW-datetime.fromisoformat(checked)).total_seconds()<10800:m=previous
   elif not m and mid.startswith('tt'):m=metadata(mid,e['type'],c)
   if m and m.get('_partial') and previous and not previous.get('_partial'):m=previous
   if m and (m.get('type')!=e['type'] or (not e.get('_verifiedMetadata') and ratio(norm(alternate.plain(e['name'])),norm(m.get('name','')))<85)):m=None
  if not m or m.get('_partial'):m=alternate.resolve(e,get,norm) or m
  if not m:return key,{'checkedAt':NOW.isoformat(),'alternatePolicy':alternate.POLICY,'reason':'No unambiguous IMDb, TMDB or TVmaze match'},None
  m['_metadataCheckedAt']=NOW.isoformat();m['_alternatePolicy']=alternate.POLICY
  return key,{'id':m['id'],'checkedAt':NOW.isoformat(),'alternatePolicy':alternate.POLICY,'method':m.get('metadataSource','IMDb-matched metadata')},m
 with ThreadPoolExecutor(max_workers=4) as ex:
  for n,(key,match,m) in enumerate(ex.map(resolve,work),1):
   matches[key]=match
   if m:metas[alternate.key(m['type'],m['id'])]=m
   if n%10==0:save('matches.json',matches);save('metadata.json',metas);print('MATCHED',n,'/',len(work),flush=True)
 save('matches.json',matches)
 catalogs={f'dobins_{LANGS[l]}_{t}':[] for l in LANGS for t in ('movie','series')};seen={k:set() for k in catalogs}
 for e in ordered:
  key=e['language']+'|'+e['type']+'|'+norm(e['name']);match=matches.get(key,{});mid=match.get('id');cid=f'dobins_{LANGS[e["language"]]}_{e["type"]}'
  if not mid or alternate.key(e['type'],mid) not in metas:
   unmatched.append({'name':e['name'],'language':e['language'],'type':e['type'],'ottDate':e['ottDate'],'reason':match.get('reason','Awaiting metadata backfill')});continue
  if mid in seen[cid]:continue
  seen[cid].add(mid);m=metas[alternate.key(e['type'],mid)];aid=alternate.artid(e['type'],mid);poster=e.get('poster') or m.get('poster');poster=re.sub(r'/w\d+/','/w780/',poster) if poster and 'image.tmdb.org' in poster else poster
  if not poster:continue
  previous=m.get('artwork',{});m['artwork']={'posters':list(dict.fromkeys(x for x in ([f'https://api.ratingposterdb.com/t0-free-rpdb/imdb/poster-default/{mid}.jpg'] if mid.startswith('tt') else [])+[poster,m.get('poster')]+([f'https://images.metahub.space/poster/medium/{mid}/img'] if mid.startswith('tt') else []) if x)),'backgrounds':list(dict.fromkeys(x for x in [m.get('background')]+([f'https://images.metahub.space/background/medium/{mid}/img'] if mid.startswith('tt') else []) if x))}
  m['artwork']['logos']=list(dict.fromkeys(x for x in [m.get('logo')]+([f'https://images.metahub.space/logo/medium/{mid}/img'] if mid.startswith('tt') else []) if x and not x.startswith(BASE)))
  if not m.get('_logoFallback'):m['_logoFallback']=title_logo(m['name'])
  episode_at,new_episodes=episode_badges.latest(m.get('videos',[]),NOW) if e['type']=='series' else (None,False)
  if episode_at and episode_at[:10]>e['ottDate']:e['ottDate']=episode_at[:10]
  m['ott']={'date':e['ottDate'],'kind':e.get('releaseKind','digital'),'platforms':e['platforms'],'sources':e['sources']};m['availability']=e.get('availability',[])
  catalogs[cid].append({'id':mid,'type':e['type'],'name':m['name'],'poster':BASE+'/art/poster/'+aid,'posterShape':'poster','background':BASE+'/art/background/'+aid,'logo':BASE+'/art/logo/'+aid,'releaseInfo':str(m.get('releaseInfo','')),'metadataSource':m.get('metadataSource','https://v3-cinemeta.strem.io/'),'imdbRating':m.get('imdbRating'),'genres':m.get('genres',[]),'description':f"Home release ({e.get('releaseKind','digital')}): {e['ottDate']} · {', '.join(e['platforms'])}\n\n"+m.get('description',e.get('description','')),'releaseDate':e['ottDate'],'releaseKind':e.get('releaseKind','digital'),'availability':e.get('availability',[]),'physicalReleases':e.get('physicalReleases',[]),'ottDate':next((a['date'] for a in e.get('availability',[]) if a['kind']=='digital'),None),'platforms':e['platforms'],'sources':e['sources'],'language':e['language'],'releaseDateBasis':e.get('releaseDateBasis','source release'),'latestEpisodeReleasedAt':episode_at,'hasNewEpisodes':new_episodes,'nextEpisodeReleaseAt':episode_badges.upcoming(m.get('videos',[]),NOW,m.get('seasons',[])) if e['type']=='series' else None})
 for cid,ms in catalogs.items():
  if cid.endswith('_series'):
   known={m['id'] for m in ms};ms.extend(m for m in old_catalogs.get(cid,[]) if m['id'] not in known and (m.get('releaseDate') or m.get('ottDate') or '')<=TODAY)
  if cid.endswith('_series'):
   for item in ms:
    item['nextEpisodeReleaseAt']=episode_badges.upcoming(metas.get(alternate.key('series',item['id']),{}).get('videos',[]),NOW,metas.get(alternate.key('series',item['id']),{}).get('seasons',[]))
    item['latestEpisodeReleasedAt'],item['hasNewEpisodes']=episode_badges.latest(metas.get(alternate.key('series',item['id']),{}).get('videos',[]),NOW)
    if item['latestEpisodeReleasedAt'] and item['latestEpisodeReleasedAt'][:10]>(item.get('releaseDate') or ''):item['releaseDate']=item['latestEpisodeReleasedAt'][:10]
  ms.sort(key=lambda m:(bool(m.get('hasNewEpisodes')),max(m.get('latestEpisodeReleasedAt') or '',m.get('releaseDate') or m.get('ottDate') or ''),m['name']),reverse=True)
  if not ms and old_catalogs.get(cid):catalogs[cid]=old_catalogs[cid]
 if any(not catalogs[c] for c in catalogs):
  save('metadata.json',metas);save('unmatched.json',unmatched);raise RuntimeError('An empty catalog would be published; retaining last-good catalogs while metadata backfills')
 save('metadata.json',metas);save('catalogs.json',catalogs);save('unmatched.json',unmatched)
 status={'name':'Dobins Indian Catalog','policy':POLICY,'releasePolicy':physical.POLICY,'metadataPolicy':alternate.POLICY,'seriesPolicy':series_sources.POLICY,'updatedAt':NOW.isoformat(),'lastSuccessCycle':cycle(),'timezone':'Asia/Muscat','schedule':'06:00 and 18:00 daily; also 01:00 Thursday, Friday, Saturday','sources':health,'counts':{k:len(v) for k,v in catalogs.items()},'artworkPolicy':'RPDB posters first, high-resolution artwork fallbacks, original title logos with readable PNG fallback','pendingMatches':len(unmatched),'checkedCandidates':len(events),'errors':[]}
 save('status.json',status);print('SUCCESS',json.dumps(status),flush=True)
if __name__=='__main__':
 try:build()
 except Exception as e:
  s=load('status.json',{});s.update(lastAttemptAt=NOW.isoformat(),errors=[str(e)]);save('status.json',s);print('FAILED; last-good catalogs retained:',str(e),flush=True);raise
