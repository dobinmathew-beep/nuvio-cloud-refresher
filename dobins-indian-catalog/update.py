"""IMDb-matched digital-release catalogs. Public sources only; no AI or paid API."""
# Preserve last-good catalog entries when a refresh source has incomplete metadata.
from pathlib import Path
from datetime import datetime,timedelta,date,timezone
from zoneinfo import ZoneInfo
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote,urljoin
from bs4 import BeautifulSoup
from rapidfuzz.fuzz import ratio
import ast,json,re,subprocess,os,unicodedata,threading,base64,io,textwrap
from PIL import Image,ImageDraw,ImageFont
import alternate,physical,series_sources,episode_badges,upcoming_sources
ROOT=Path(__file__).resolve().parent;DATA=ROOT/'data';DATA.mkdir(exist_ok=True)
LANGS={'malayalam':'ml','tamil':'ta','telugu':'te','hindi':'hi'};ZONE=ZoneInfo('Asia/Muscat');NOW=datetime.now(ZONE);TODAY=NOW.date().isoformat()
BASE=os.environ.get('ADDON_ORIGIN','https://dobins-indian-catalog.quickfield138.chatgpt.site');POLICY='confirmed-digital-imdb-v1'
def load_verified_imdb_aliases():
 try:
  aliases=json.loads((DATA/'imdb-aliases.json').read_text())
  return {value:key for key,value in aliases.items()}
 except Exception:return {}
IMDB_ALIAS_BY_METADATA=load_verified_imdb_aliases()
DISPLAY_NAME_OVERRIDES={'tt37541677':'Bharathanatyam 2 Mohiniyattam'}
IMDB_RATING_OVERRIDES={'tt22797990':'6.0','tt37541677':'7.6'}
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
def append_legacy_series(current,legacy,today,metadata_cache=None):
 metadata_cache=metadata_cache or {}
 known_ids={str(m.get('id','')) for m in current}
 known_names={norm(m.get('name','')) for m in current if m.get('name')}
 for old in legacy:
  old=dict(old);oid=str(old.get('id',''));name=norm(old.get('name',''))
  day=str(old.get('releaseDate') or old.get('ottDate') or '')
  typ=str(old.get('type') or (current[0].get('type') if current else 'movie'))
  alias=IMDB_ALIAS_BY_METADATA.get(alternate.key(typ,oid))
  if alias:
   old['id']=alias;oid=alias
   old['poster']=BASE+'/art/poster/'+alias
   old['background']=BASE+'/art/background/'+alias
   old['logo']=BASE+'/art/logo/'+alias
   matched=metadata_cache.get(alias,{})
   if matched.get('imdbRating') not in (None,''):old['imdbRating']=matched['imdbRating']
  if oid in DISPLAY_NAME_OVERRIDES:old['name']=DISPLAY_NAME_OVERRIDES[oid]
  if oid in IMDB_RATING_OVERRIDES:old['imdbRating']=IMDB_RATING_OVERRIDES[oid]
  if oid in known_ids:
   for existing in current:
    if str(existing.get('id',''))==oid:
     if oid in DISPLAY_NAME_OVERRIDES:existing['name']=DISPLAY_NAME_OVERRIDES[oid]
     if oid in IMDB_RATING_OVERRIDES:existing['imdbRating']=IMDB_RATING_OVERRIDES[oid]
   continue
  if name and name in known_names:continue
  if not day or day>today:continue
  current.append(old);known_ids.add(oid)
  if name:known_names.add(name)
 return current
def cycle(now=NOW):
 # Use the same two-hour cycle as the lightweight schedule gate.
 from schedule import due
 return due(now)

def dailyott():
 first=get('https://www.dailyott.in/api/movies?limit=200&page=1');assert first.get('status')=='success'
 rows=first.get('movies',[]);pages=min(int(first.get('totalPages',1)),8)
 def page(n):return get(f'https://www.dailyott.in/api/movies?limit=200&page={n}').get('movies',[])
 with ThreadPoolExecutor(max_workers=4) as pool:
  for batch in pool.map(page,range(2,pages+1)):rows.extend(batch)
 if len(rows)<20:raise RuntimeError('DailyOTT response unexpectedly empty')
 return rows

# Upcoming digital dates are collected from every supported OTT date feed before event merging.
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
  if not typ or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',day):continue
  if not (m.get('verified') or m.get('source_verified')):continue
  # Never infer a dubbed catalog from a multi-language availability list.
  raw_langs=[str(x).lower() for x in m.get('languages',[])]
  langs=[x for x in raw_langs if x in LANGS]
  original=str(m.get('tmdbDetails',{}).get('originalLanguage') or m.get('original_language') or '').lower()
  if original in LANGS:langs=[original]
  elif original in LANGS.values():langs=[next(k for k,v in LANGS.items() if v==original)]
  elif original:langs=[]
  elif len(langs)!=1:langs=[]
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
   if not lang:continue
   ks=kinds.get(norm(name),set());typ='series' if 'series' in name.lower() else next(iter(ks)) if len(ks)==1 else 'movie'
   image=r.select_one('img');latest.append({'name':name,'language':lang,'type':typ,'ottDate':day,'platforms':[x.get_text(' ',strip=True) for x in r.select('.cb-badge')],'poster':image.get('src') if image else None,'year':None,'source':'https://cinebuds.com/ott-release-dates/','detail':a.get('href'),'confirmed':True})
  out.extend(latest);old['cinebuds']={'checkedAt':NOW.isoformat(),'records':latest};health.append({'source':'Cinebuds','url':'https://cinebuds.com/ott-release-dates/','state':'live','records':len(latest)})
 except Exception as e:
  cached=old.get('cinebuds',{}).get('records',[]);out.extend(cached);health.append({'source':'Cinebuds','state':'cached' if cached else 'failed','error':str(e)})
 upcoming_events,upcoming_health=upcoming_sources.collect(get,TODAY,LANGS,norm)
 out.extend(upcoming_events);health.extend(upcoming_health)
 save('sources.json',old)
 if not any(x['state'] in ('live','frontend-fallback') for x in health):raise RuntimeError('All digital-release sources unavailable; last-good catalogs retained')
 merged={}
 for e in out:
  key=(e['language'],e['type'],norm(e['name']))
  if key not in merged:merged[key]={**e,'sources':[e['source']]}
  else:
   m=merged[key];m['sources']=list(set(m['sources']+[e['source']]));m['platforms']=list(set(m['platforms']+e['platforms']))
   # First digital premiere wins across sources; a later new-platform date must not reset it.
   old_day=str(m.get('ottDate') or '');new_day=str(e.get('ottDate') or '')
   if e['type']=='movie':
    old_rank=(0,old_day) if old_day>TODAY else (1,old_day)
    new_rank=(0,new_day) if new_day>TODAY else (1,new_day)
    if new_rank<old_rank:
     m['ottDate']=new_day
     for field in ('releaseKind','releaseDateBasis','sourceRecord','year'):
      if e.get(field) is not None:m[field]=e[field]
   else:
    old_rank=(0,old_day) if old_day>=TODAY else (1,-int(old_day.replace('-','')) if old_day else 0)
    new_rank=(0,new_day) if new_day>=TODAY else (1,-int(new_day.replace('-','')) if new_day else 0)
    if new_rank<old_rank:m['ottDate']=new_day
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

def event_digital_date(event,today=TODAY):
 # Prefer the nearest future digital premiere over any historical availability.
 dates=[str(x.get('date'))[:10] for x in (event.get('availability') or []) if x.get('kind')=='digital' and x.get('date')]
 if event.get('releaseKind')=='digital' and event.get('ottDate'):dates.append(str(event['ottDate'])[:10])
 future=sorted(x for x in dates if x>=today)
 return future[0] if future else (min(dates) if dates else None)
def release_classification(event,meta):
 # Classify movie entries by the home-release event being advertised, not the theatrical title's age.
 if event.get('type')!='movie':return None,None,None
 availability=event.get('availability') or []
 digital=event_digital_date(event)
 physical=next((x.get('date') for x in availability if x.get('kind')=='physical' and x.get('date')),None)
 if digital:label='New OTT arrival';label_date=digital
 elif physical or event.get('releaseKind')=='physical':label='New physical release';label_date=None
 else:return None,None,None
 source=event.get('sourceRecord') or {}
 details=source.get('tmdbDetails') or {}
 original=str(details.get('releaseDate') or meta.get('releaseDate') or '')[:10]
 if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',original):
  year=str(meta.get('releaseInfo') or source.get('year') or '')[:4]
  original=year if re.fullmatch(r'\d{4}',year) else None
 return label,original,label_date

def catalog_sort_date(item):
 # For movies, a fresh OTT arrival outranks an older physical-edition date.
 if item.get('type')=='movie':
  return str(item.get('ottDate') or item.get('releaseDate') or '')
 return str(max(item.get('latestEpisodeReleasedAt') or '',item.get('releaseDate') or item.get('ottDate') or ''))

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
 events,health=collect();series_events,series_health=series_sources.collect(get,load,save,LANGS,TODAY,NOW,norm);events.extend(series_events);health.extend(series_health);disc_events,disc_health=physical.collect(get,load,save,LANGS,TODAY,NOW,norm);events=physical.merge_events(events+disc_events,norm,TODAY);health.extend(disc_health);pool=candidate_index();matches=load('matches.json',{});metas=load('metadata.json',{});old_catalogs=load('catalogs.json',{});unmatched=[]
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
   if checked and (NOW-datetime.fromisoformat(checked)).total_seconds()<10800 and str(cached.get('id','')).startswith('tt'):continue
  if cached and cached.get('alternatePolicy')==alternate.POLICY and not cached.get('id') and not e.get('_verifiedMetadata') and (NOW-datetime.fromisoformat(cached['checkedAt'])).total_seconds()<21600:continue
  if attempts>=budget:continue
  work.append((key,e));attempts+=1
 def resolve(pair):
  key,e=pair;existing=matches.get(key,{}).get('id');mk=alternate.key(e['type'],existing or '');c=metas.get(mk) or ({'id':existing,'name':e['name'],'type':e['type']} if re.fullmatch(r'tt\d+',str(existing or '')) else None) or select_candidate(e,pool) or e.get('_verifiedMetadata') or suggestion(e)
  m=e.get('_verifiedMetadata') if c and e.get('_verifiedMetadata',{}).get('id')==c['id'] else None
  if c:
   mid=c['id'];previous=metas.get(alternate.key(e['type'],mid));checked=previous.get('_metadataCheckedAt') if previous else None
   if previous and checked and (NOW-datetime.fromisoformat(checked)).total_seconds()<10800:m=previous
   elif not m and mid.startswith('tt'):m=metadata(mid,e['type'],c)
   if m and m.get('_partial') and previous and not previous.get('_partial'):m=previous
   if m and (m.get('type')!=e['type'] or (not e.get('_verifiedMetadata') and ratio(norm(alternate.plain(e['name'])),norm(m.get('name','')))<85)):m=None
  if not m or m.get('_partial') or not str(m.get('id','')).startswith('tt'):
   alt=alternate.resolve(e,get,norm)
   if alt and str(alt.get('id','')).startswith('tt'):
    fresh=metadata(alt['id'],e['type'],alt)
    if fresh.get('_partial'):
     fresh={**alt,**fresh,'id':alt['id'],'type':e['type'],'poster':fresh.get('poster') or alt.get('poster'),'metadataSource':alt.get('metadataSource','Verified IMDb match'),'_partial':False}
    m=fresh
   else:
    suggested=None if norm(e.get('name',''))=='femaledog' else suggestion(e)
    if suggested:
     fresh=metadata(suggested['id'],e['type'],suggested)
     if fresh.get('_partial'):
      fresh={**(alt or m or {}),**fresh,'id':suggested['id'],'type':e['type'],'poster':fresh.get('poster') or suggested.get('poster') or (alt or {}).get('poster'),'metadataSource':'Verified IMDb title/year match','_partial':False}
     m=fresh
    elif not m or m.get('_partial'):m=alt or m
  if m and not str(m.get('id','')).startswith('tt'):
   alias=IMDB_ALIAS_BY_METADATA.get(alternate.key(e['type'],str(m.get('id',''))))
   if alias:
    previous=m;fresh=metadata(alias,e['type'],previous)
    if fresh.get('_partial'):
     fresh={**previous,**fresh,'id':alias,'type':e['type'],'poster':fresh.get('poster') or previous.get('poster'),'metadataSource':'Verified IMDb title match','_partial':False}
    else:fresh={**previous,**fresh,'id':alias,'type':e['type']}
    m=fresh
  if m and m.get('id') in DISPLAY_NAME_OVERRIDES:m['name']=DISPLAY_NAME_OVERRIDES[m['id']]
  if m and m.get('id') in IMDB_RATING_OVERRIDES:m['imdbRating']=IMDB_RATING_OVERRIDES[m['id']]
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
  # Enforce original-language-only catalogs even when a source labels a dubbed
  # version as a separate language. Cinemeta's original_language is authoritative.
  original=str(m.get('original_language') or m.get('originalLanguage') or '').lower()
  original=next((lang for lang,code in LANGS.items() if original in (lang,code)),None)
  if original and original!=e['language']:continue
  previous=m.get('artwork',{});m['artwork']={'posters':list(dict.fromkeys(x for x in ([f'https://api.ratingposterdb.com/t0-free-rpdb/imdb/poster-default/{mid}.jpg'] if mid.startswith('tt') else [])+[poster,m.get('poster')]+([f'https://images.metahub.space/poster/medium/{mid}/img'] if mid.startswith('tt') else []) if x)),'backgrounds':list(dict.fromkeys(x for x in [m.get('background')]+([f'https://images.metahub.space/background/medium/{mid}/img'] if mid.startswith('tt') else []) if x))}
  m['artwork']['logos']=list(dict.fromkeys(x for x in [m.get('logo')]+([f'https://images.metahub.space/logo/medium/{mid}/img'] if mid.startswith('tt') else []) if x and not x.startswith(BASE)))
  if not m.get('name'):m['name']=e.get('name') or str(mid)
  if not m.get('_logoFallback'):m['_logoFallback']=title_logo(m['name'])
  episode_at,new_episodes=episode_badges.latest(m.get('videos',[]),NOW) if e['type']=='series' else (None,False)
  if episode_at and episode_at[:10]>e['ottDate']:e['ottDate']=episode_at[:10]
  m['availability']=e.get('availability',[])
  release_label,original_release_date,label_date=release_classification(e,m)
  digital_date=event_digital_date(e)
  display_date=label_date or e['ottDate']
  display_kind='digital' if digital_date else e.get('releaseKind','digital')
  m['ott']={'date':digital_date or e['ottDate'],'kind':display_kind,'platforms':e['platforms'],'sources':e['sources']}
  description_label=release_label or ('Upcoming OTT release' if e['ottDate']>TODAY else 'Home release')
  catalogs[cid].append({'id':mid,'type':e['type'],'name':m['name'],'poster':BASE+'/art/poster/'+aid,'posterShape':'poster','background':BASE+'/art/background/'+aid,'logo':BASE+'/art/logo/'+aid,'releaseInfo':str(m.get('releaseInfo','')),'metadataSource':m.get('metadataSource','https://v3-cinemeta.strem.io/'),'imdbRating':m.get('imdbRating'),'genres':m.get('genres',[]),'description':f"{description_label} ({display_kind}): {display_date} · {', '.join(e['platforms'])}\n\n"+(m.get('description') or e.get('description') or ''),'releaseDate':e['ottDate'],'releaseKind':e.get('releaseKind','digital'),'releaseStatus':'upcoming' if display_date>TODAY else 'available','releaseLabel':release_label,'releaseLabelDate':label_date,'originalReleaseDate':original_release_date,'availability':e.get('availability',[]),'physicalReleases':e.get('physicalReleases',[]),'ottDate':digital_date,'platforms':e['platforms'],'sources':e['sources'],'language':e['language'],'releaseDateBasis':e.get('releaseDateBasis','source release'),'latestEpisodeReleasedAt':episode_at,'hasNewEpisodes':new_episodes,'nextEpisodeReleaseAt':episode_badges.upcoming(m.get('videos',[]),NOW,m.get('seasons',[])) if e['type']=='series' else None})
 for cid,ms in catalogs.items():
  append_legacy_series(ms,old_catalogs.get(cid,[]),TODAY,metas)
  if cid.endswith('_series'):
   for item in ms:
    item['nextEpisodeReleaseAt']=episode_badges.upcoming(metas.get(alternate.key('series',item['id']),{}).get('videos',[]),NOW,metas.get(alternate.key('series',item['id']),{}).get('seasons',[]))
    item['latestEpisodeReleasedAt'],item['hasNewEpisodes']=episode_badges.latest(metas.get(alternate.key('series',item['id']),{}).get('videos',[]),NOW)
    if item['latestEpisodeReleasedAt'] and item['latestEpisodeReleasedAt'][:10]>(item.get('releaseDate') or ''):item['releaseDate']=item['latestEpisodeReleasedAt'][:10]
  ms.sort(key=lambda m:(bool(m.get('hasNewEpisodes')),catalog_sort_date(m),m['name']),reverse=True)
  if not ms and old_catalogs.get(cid):catalogs[cid]=old_catalogs[cid]
 if any(not catalogs[c] for c in catalogs):
  save('metadata.json',metas);save('unmatched.json',unmatched);raise RuntimeError('An empty catalog would be published; retaining last-good catalogs while metadata backfills')
 save('metadata.json',metas);save('catalogs.json',catalogs);save('unmatched.json',unmatched)
 status={'name':'Dobins Indian Catalog','policy':POLICY,'releasePolicy':physical.POLICY,'metadataPolicy':alternate.POLICY,'seriesPolicy':series_sources.POLICY,'updatedAt':NOW.isoformat(),'lastSuccessCycle':cycle(),'timezone':'Asia/Muscat','schedule':'Every two hours daily, including 00:00 (Asia/Muscat); checked every 30 minutes with retries','sources':health,'counts':{k:len(v) for k,v in catalogs.items()},'artworkPolicy':'RPDB posters first, high-resolution artwork fallbacks, original title logos with readable PNG fallback','pendingMatches':len(unmatched),'checkedCandidates':len(events),'errors':[]}
 save('status.json',status);print('SUCCESS',json.dumps(status),flush=True)
if __name__=='__main__':
 try:build()
 except Exception as e:
  s=load('status.json',{});s.update(lastAttemptAt=NOW.isoformat(),errors=[str(e)]);save('status.json',s);print('FAILED; last-good catalogs retained:',str(e),flush=True);raise
