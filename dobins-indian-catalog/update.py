"""IMDb-matched digital-release catalogs. Public sources only; no AI or paid API."""
# A maintenance commit also serves as a one-off deep-refresh trigger via Actions.
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
BASE=os.environ.get('ADDON_ORIGIN','https://dobins-indian-catalog.quickfield138.chatgpt.site');POLICY='confirmed-digital-imdb-v3'
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
def is_imdb_id(value):
 return bool(re.fullmatch(r'tt\d+',str(value or '')))
def _year_int(value):
 # Source feeds sometimes serialize missing years as the literal string 'None'.
 match=re.search(r'\b(?:19|20)\d{2}\b',str(value or '').strip())
 return int(match.group(0)) if match else 0
def original_language_matches(event,meta):
 original=str(meta.get('original_language') or meta.get('originalLanguage') or '').lower()
 expected=LANGS[event['language']]
 return not original or original in (expected,event['language'])
TYPE_OVERRIDES={'balbarbarik':'series','princeofmollywood':'series'}
LANGUAGE_OVERRIDES={'taarini':'marathi'}
VERIFIED_TMDB_OVERRIDES={
 'malayalam|series|patriotlegendshangout':{'id':320606,'name':'Patriot Legends Hangout'},
 'malayalam|movie|jennifer':{'id':1813865,'name':'Jennifer'}
}
VERIFIED_IMDB_OVERRIDES={
 'malayalam|series|princeofmollywood':{'id':'tt44686897','name':'Prince of Mollywood'},
 'malayalam|series|oruchiriiruchiribumperchiri3':{'id':'tt43511363','name':'Oru Chiri Iru Chiri Bumper Chiri 3'},
 'malayalam|series|kasaragodembassy':{'id':'tt40431801','name':'Kasargod Embassy'},
 'malayalam|movie|dna':{'id':'tt27470699','name':'DNA'},
 'telugu|movie|subinspectoryugandhar':{'id':'tt47421307','name':'Sub-Inspector Yugandhar'},
 'telugu|movie|bloodroses':{'id':'tt39440956','name':'Blood Roses'},
 'telugu|movie|vidrohi':{'id':'tt37937823','name':'Vidhrohi'},
 'hindi|movie|mirzapur':{'id':'tt34339725','name':'Mirzapur: The Movie'},
 'hindi|movie|vvaan':{'id':'tt34498564','name':'The Vvaan: Force of the Forrest'},
 'hindi|series|koffeewithkaran9':{'id':'tt0445883','name':'Koffee with Karan'}
}
def apply_verified_overrides(events):
 for event in events:
  event_name=norm(event['name'])
  if event_name in TYPE_OVERRIDES:event['type']=TYPE_OVERRIDES[event_name]
  if event_name in LANGUAGE_OVERRIDES:event['_languageMismatch']=LANGUAGE_OVERRIDES[event_name]
  verified=VERIFIED_IMDB_OVERRIDES.get(event['language']+'|'+event['type']+'|'+event_name)
  if verified:
   event['_verifiedImdbId']=verified['id'];event['_verifiedImdbName']=verified['name']
  tmdb=VERIFIED_TMDB_OVERRIDES.get(event['language']+'|'+event['type']+'|'+event_name)
  if tmdb:
   event.setdefault('sourceRecord',{})['tmdbId']=tmdb['id']
   try:verified_meta=alternate.tmdb(event,get,norm)
   except Exception as exc:
    print('VERIFIED TMDB LOOKUP ERROR',event.get('name'),type(exc).__name__,str(exc)[:160],flush=True);verified_meta=None
   if verified_meta and verified_meta.get('type')==event['type'] and (is_imdb_id(verified_meta.get('id')) or verified_meta.get('id')=='tmdb:'+str(tmdb['id'])):event['_verifiedMetadata']=verified_meta
 return events

def append_legacy_series(current,legacy,today,metadata_cache=None,require_metadata=False):
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
  if require_metadata and (not (is_imdb_id(oid) or re.fullmatch(r'tmdb:\d+',oid)) or alternate.key(typ,oid) not in metadata_cache):continue
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
def validate_malayalam_catalogs(catalogs,metadata):
 # Malayalam is held to an explicit identity/metadata gate: no TVmaze-only IDs,
 # no missing metadata records, and no title/type/ID contradictions.
 checked=0;errors=[];missing_language=0
 for typ in ('movie','series'):
  cid='dobins_ml_'+typ
  for item in catalogs.get(cid,[]):
   checked+=1;mid=str(item.get('id',''));name=str(item.get('name',''))
   if not (is_imdb_id(mid) or re.fullmatch(r'tmdb:\d+',mid)):
    errors.append({'catalog':cid,'name':name,'id':mid,'reason':'Malayalam entries require an IMDb or TMDB ID'});continue
   meta=metadata.get(alternate.key(typ,mid))
   if not isinstance(meta,dict) or meta.get('_partial'):
    errors.append({'catalog':cid,'name':name,'id':mid,'reason':'Complete metadata record is missing or partial'});continue
   if meta.get('id')!=mid or meta.get('type')!=typ:
    errors.append({'catalog':cid,'name':name,'id':mid,'reason':'Metadata ID/type mismatch'});continue
   if not meta.get('name') or ratio(norm(name),norm(meta.get('name','')))<80:
    errors.append({'catalog':cid,'name':name,'id':mid,'reason':'Metadata title does not match catalog title'});continue
   artwork=meta.get('artwork') or {}
   if not (meta.get('poster') or artwork.get('posters')):
    errors.append({'catalog':cid,'name':name,'id':mid,'reason':'Metadata poster is missing'});continue
   if not any(meta.get(k) for k in ('description','releaseInfo','genres','videos','seasons','cast','director')):
    errors.append({'catalog':cid,'name':name,'id':mid,'reason':'Metadata details are empty'});continue
   original=str(meta.get('original_language') or meta.get('originalLanguage') or '').lower()
   if original and original not in ('ml','malayalam'):
    errors.append({'catalog':cid,'name':name,'id':mid,'reason':'Metadata original language is '+original});continue
   if not original:missing_language+=1
 return {'checked':checked,'passed':checked-len(errors),'failed':len(errors),'missingOriginalLanguageField':missing_language,'policy':'IMDb-or-TMDB identity; exact ID/type; title and metadata integrity'},errors

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

# Upcoming calendar parsing supports reported entries and weekday-prefixed dates.
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

def candidate_cache_fresh(cache,now=NOW):
 try:return (now-datetime.fromisoformat(cache.get('_updatedAt',''))).total_seconds()<7200
 except (TypeError,ValueError):return False

def candidate_index():
 # The upstream catalog is paginated. Fetching only its first response silently
 # starves matching of newer titles beyond that page (and can look like a 50-item cap).
 cache=load('candidates.json',{});pool=[]
 if candidate_cache_fresh(cache) and os.environ.get('FORCE_CANDIDATE_REFRESH') != 'true':
  for key,rows in cache.items():
   if key=='_updatedAt':continue
   lang,typ=key.rsplit('-',1)
   pool.extend(dict(m,language=lang,type=typ) for m in rows if is_imdb_id(m.get('id','')) and m.get('name'))
  print('CANDIDATES cache hit',len(pool),'records',flush=True)
  return pool
 errors=[]
 def f(k):
  lang,typ=k;cat=LANGS[lang]+('_series' if typ=='series' else '')
  key=lang+'-'+typ;seen=set();all_rows=[];error=None
  pages=max(1,int(os.environ.get('CATALOG_CANDIDATE_PAGES','25')))
  for page in range(pages):
   url=f'https://83e20802dcf1-indian-streams.baby-beamup.club/catalog/{typ}/{cat}'+(f'/skip={page*20}' if page else '')+'.json'
   try:rows=get(url).get('metas',[])
   except Exception as exc:
    error=str(exc);break
   fresh=[m for m in rows if m.get('id') and m.get('id') not in seen]
   seen.update(m.get('id') for m in fresh);all_rows.extend(fresh)
   if not fresh or len(rows)<20:break
  previous=cache.get(key,[])
  if all_rows and error:
   merged={str(m.get('id')):m for m in previous if m.get('id')}
   merged.update({str(m.get('id')):m for m in all_rows if m.get('id')})
   all_rows=list(merged.values())
  elif not all_rows:
   all_rows=previous
  if all_rows:cache[key]=all_rows
  if error:errors.append(key)
  print('CANDIDATES',key,len(all_rows),'pages',page+1,'error',bool(error),flush=True)
  return [dict(m,language=lang,type=typ) for m in all_rows if is_imdb_id(m.get('id','')) and m.get('name')]
 with ThreadPoolExecutor(max_workers=4) as ex:
  for ms in ex.map(f,[(l,t) for l in LANGS for t in ('movie','series')]):pool.extend(ms)
 if not errors:cache['_updatedAt']=NOW.isoformat()
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
 # IMDb's public suggestion index is queried with title variants, not just one
 # literal string. This recovers season/episode suffixes and subtitle variants.
 raw=str(e.get('name','')).strip()
 base=re.sub(r'\s*\((?:Episode\s*\d+|Season\s*\d+|Series|Web Series)\)\s*',' ',raw,flags=re.I)
 base=re.sub(r'\bEpisode\s*\d+\b',' ',base,flags=re.I)
 base=re.sub(r'\bSeason\s*\d+\b',' ',base,flags=re.I)
 base=re.sub(r'\s+',' ',base).strip(' -:–—')
 variants=[]
 for value in (raw,base,re.sub(r'\s*[:–—-].*$','',base).strip()):
  value=value.strip()
  if value and norm(value) not in {norm(x) for x in variants}:variants.append(value)
 if e.get('type')=='series' and re.search(r'\s+\d+$',base):
  short=re.sub(r'\s+\d+$','',base).strip()
  if short and norm(short) not in {norm(x) for x in variants}:variants.append(short)
 options={}
 for query in variants[:3]:
  url='https://v3.sg.media-imdb.com/suggestion/x/'+quote(query,safe='')+'.json'
  try:data=get(url).get('d',[])
  except Exception:continue
  for x in data:
   mid=str(x.get('id',''))
   if not re.fullmatch(r'tt\d+',mid):continue
   qid=x.get('qid')
   typ='series' if qid in ('tvSeries','tvMiniSeries') else 'movie' if qid in ('movie','tvMovie','video') else None
   if typ!=e['type']:continue
   title=str(x.get('l','')).strip()
   if not title:continue
   score=ratio(norm(query),norm(title))
   year=_year_int(x.get('y'))
   expected_year=_year_int(e.get('year'))
   if expected_year and year and abs(year-expected_year)>1:continue
   # A title-only OTT date is not the original production year. Do not reject
   # an older series merely because a new season has a recent streaming date.
   threshold=94 if expected_year and year else 97
   if score<threshold:continue
   prior=options.get(mid)
   candidate={'id':mid,'name':title,'type':typ,'releaseInfo':str(year or ''),'poster':(x.get('i') or {}).get('imageUrl'),'_matchScore':score,'_query':query}
   if not prior or score>prior['_matchScore']:options[mid]=candidate
 if not options:return None
 ranked=sorted(options.values(),key=lambda x:(x['_matchScore'],bool(x.get('releaseInfo'))),reverse=True)
 if len(ranked)>1:
  gap=ranked[0]['_matchScore']-ranked[1]['_matchScore']
  if gap<5:return None
 best=ranked[0]
 if best['_matchScore']<97 and not _year_int(e.get('year')):return None
 best.pop('_matchScore',None);best.pop('_query',None)
 return best

def metadata(mid,typ,fallback):
 try:
  m=get(f'https://v3-cinemeta.strem.io/meta/{typ}/{mid}.json').get('meta',{})
  if m.get('id')!=mid or m.get('type')!=typ:raise ValueError('IMDb metadata mismatch')
  m['_metadataCheckedAt']=NOW.isoformat();m['_partial']=False;return m
 except Exception:return {'_metadataCheckedAt':NOW.isoformat(),'_partial':True,'id':mid,'type':typ,'name':fallback['name'],'poster':fallback.get('poster'),'releaseInfo':str(fallback.get('releaseInfo',''))}

def event_digital_date(event,today=TODAY):
 # Preserve the first verified digital/OTT arrival, separate from the canonical first release date.
 dates=[str(x.get('date'))[:10] for x in (event.get('availability') or []) if x.get('kind')=='digital' and x.get('date')]
 if event.get('releaseKind')=='digital' and event.get('ottDate'):dates.append(str(event['ottDate'])[:10])
 valid=[x for x in dates if re.fullmatch(r'\d{4}-\d{2}-\d{2}',x)]
 return min(valid) if valid else None
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
 theatrical=sorted(str(x.get('date') or '')[:10] for x in event.get('theatricalReleases',[]) if x.get('date'))
 original=theatrical[0] if theatrical else str(details.get('releaseDate') or meta.get('releaseDate') or '')[:10]
 if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',original):
  year=str(meta.get('releaseInfo') or source.get('year') or '')[:4]
  original=year if re.fullmatch(r'\d{4}',year) else None
 return label,original,label_date

def catalog_sort_date(item):
 return physical.catalog_release_date(item)

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
 events,health=collect();series_events,series_health=series_sources.collect(get,load,save,LANGS,TODAY,NOW,norm);events.extend(series_events);health.extend(series_health);disc_events,disc_health=physical.collect(get,load,save,LANGS,TODAY,NOW,norm);events=physical.merge_events(events+disc_events,norm,TODAY);health.extend(disc_health)
 events=apply_verified_overrides(events)
 pool=candidate_index();matches=load('matches.json',{});metas=load('metadata.json',{});old_catalogs=load('catalogs.json',{});unmatched=[]
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
  if e.get('_languageMismatch'):continue
  verified=e.get('_verifiedMetadata')
  if not verified or verified.get('type')!='series' or not verified.get('id'):continue
  if e['language']=='malayalam' and not (is_imdb_id(verified['id']) or re.fullmatch(r'tmdb:\d+',str(verified['id']))):continue
  key=e['language']+'|series|'+norm(e['name']);mid=verified['id'];mk=alternate.key('series',mid)
  metas[mk]={**metas.get(mk,{}),**{k:v for k,v in verified.items() if v is not None},'_metadataCheckedAt':NOW.isoformat(),'_partial':False}
  matches[key]={'id':mid,'checkedAt':NOW.isoformat(),'alternatePolicy':alternate.POLICY,'method':verified.get('metadataSource','Verified series source')}
 budget=int(os.environ.get('MAX_NEW_MATCHES','600'));attempts=0;work=[]
 for e in ordered:
  if e.get('_languageMismatch'):continue
  key=e['language']+'|'+e['type']+'|'+norm(e['name']);cached=matches.get(key)
  if cached and alternate.key(e['type'],cached.get('id','')) in metas:
   checked=metas[alternate.key(e['type'],cached['id'])].get('_metadataCheckedAt')
   force_ml=e['language']=='malayalam' and os.environ.get('FORCE_MALAYALAM_REVALIDATION')=='true'
   if checked and (NOW-datetime.fromisoformat(checked)).total_seconds()<10800 and str(cached.get('id','')).startswith('tt') and not force_ml:continue
  # Revisit unmatched titles after a half-hour discovery retry; a later source page may now contain their IMDb identity.
  force_ml=e['language']=='malayalam' and os.environ.get('FORCE_MALAYALAM_REVALIDATION')=='true'
  if not force_ml and os.environ.get('FORCE_MATCH_RETRY') != 'true' and cached and cached.get('alternatePolicy')==alternate.POLICY and not cached.get('id') and not e.get('_verifiedMetadata') and not e.get('_verifiedImdbId') and (NOW-datetime.fromisoformat(cached['checkedAt'])).total_seconds()<1800:continue
  if attempts>=budget:continue
  work.append((key,e));attempts+=1
 resolve_errors=[]
 def resolve(pair):
  key,e=pair;existing=matches.get(key,{}).get('id') or e.get('_verifiedImdbId');mk=alternate.key(e['type'],existing or '')
  c=metas.get(mk) or ({'id':existing,'name':e.get('_verifiedImdbName',e['name']),'type':e['type']} if is_imdb_id(existing) else None) or select_candidate(e,pool) or e.get('_verifiedMetadata')
  suggested_candidate=None
  if not c:suggested_candidate=suggestion(e);c=suggested_candidate
  m=e.get('_verifiedMetadata') if c and e.get('_verifiedMetadata',{}).get('id')==c['id'] else None
  if c:
   mid=c['id'];previous=metas.get(alternate.key(e['type'],mid));checked=previous.get('_metadataCheckedAt') if previous else None
   force_ml=e['language']=='malayalam' and os.environ.get('FORCE_MALAYALAM_REVALIDATION')=='true'
   if previous and checked and (NOW-datetime.fromisoformat(checked)).total_seconds()<10800 and not force_ml:m=previous
   elif not m and mid.startswith('tt'):m=metadata(mid,e['type'],c)
   if m and m.get('_partial') and previous and not previous.get('_partial'):m=previous
   if m and (m.get('type')!=e['type'] or (not (e.get('_verifiedMetadata') or e.get('_verifiedImdbId')) and ratio(norm(alternate.plain(e['name'])),norm(m.get('name','')))<85)):m=None
  if not m or m.get('_partial') or not str(m.get('id','')).startswith('tt'):
   alt=alternate.resolve(e,get,norm)
   alt_id=str((alt or {}).get('id',''))
   alt_is_allowed=is_imdb_id(alt_id) or (e['language']=='malayalam' and bool(re.fullmatch(r'tmdb:\d+',alt_id)))
   if alt and alt_is_allowed:
    fresh=metadata(alt_id,e['type'],alt) if is_imdb_id(alt_id) else {**alt,'_partial':False}
    if fresh.get('_partial'):
     fresh={**alt,**fresh,'id':alt_id,'type':e['type'],'poster':fresh.get('poster') or alt.get('poster'),'metadataSource':alt.get('metadataSource','Verified metadata match'),'_partial':False}
    m=fresh
   else:
    suggested=None if norm(e.get('name',''))=='femaledog' else (suggested_candidate or suggestion(e))
    if suggested:
     fresh=metadata(suggested['id'],e['type'],suggested)
     if fresh.get('_partial'):
      fresh={**(alt or m or {}),**fresh,'id':suggested['id'],'type':e['type'],'poster':fresh.get('poster') or suggested.get('poster') or (alt or {}).get('poster'),'metadataSource':'Verified IMDb title/year match','_partial':False}
     m=fresh
    elif not m or m.get('_partial'):m=alt or m
  if m and not m.get('poster') and c and c.get('poster'):
   m['poster']=c['poster']
  if m and not str(m.get('id','')).startswith('tt'):
   alias=IMDB_ALIAS_BY_METADATA.get(alternate.key(e['type'],str(m.get('id',''))))
   if alias:
    previous=m;fresh=metadata(alias,e['type'],previous)
    if fresh.get('_partial'):
     fresh={**previous,**fresh,'id':alias,'type':e['type'],'poster':fresh.get('poster') or previous.get('poster'),'metadataSource':'Verified IMDb title match','_partial':False}
    else:fresh={**previous,**fresh,'id':alias,'type':e['type']}
    m=fresh
  if m and e['language']=='malayalam' and not (is_imdb_id(m.get('id')) or re.fullmatch(r'tmdb:\d+',str(m.get('id','')))):m=None
  if m and not original_language_matches(e,m):m=None
  if m and m.get('id') in DISPLAY_NAME_OVERRIDES:m['name']=DISPLAY_NAME_OVERRIDES[m['id']]
  if m and m.get('id') in IMDB_RATING_OVERRIDES:m['imdbRating']=IMDB_RATING_OVERRIDES[m['id']]
  if not m:return key,{'checkedAt':NOW.isoformat(),'alternatePolicy':alternate.POLICY,'reason':'No unambiguous IMDb, TMDB or TVmaze match'},None
  m['_metadataCheckedAt']=NOW.isoformat();m['_alternatePolicy']=alternate.POLICY
  return key,{'id':m['id'],'checkedAt':NOW.isoformat(),'alternatePolicy':alternate.POLICY,'method':m.get('metadataSource','IMDb-matched metadata')},m
 def safe_resolve(pair):
  try:return resolve(pair)
  except Exception as exc:
   key,e=pair
   message=f"{e.get('name','Unknown title')}: {type(exc).__name__}: {exc}"
   resolve_errors.append(message)
   print('RESOLVE ERROR',message,flush=True)
   return key,{'checkedAt':NOW.isoformat(),'alternatePolicy':alternate.POLICY,'reason':'Temporary resolver error; queued for retry'},None
 with ThreadPoolExecutor(max_workers=4) as ex:
  for n,(key,match,m) in enumerate(ex.map(safe_resolve,work),1):
   matches[key]=match
   if m:metas[alternate.key(m['type'],m['id'])]=m
   if n%10==0:save('matches.json',matches);save('metadata.json',metas);print('MATCHED',n,'/',len(work),flush=True)
 save('matches.json',matches)
 catalogs={f'dobins_{LANGS[l]}_{t}':[] for l in LANGS for t in ('movie','series')};seen={k:set() for k in catalogs}
 previous_ids={cid:{str(x.get('id')) for x in items} for cid,items in old_catalogs.items()}
 added_at=load('catalog-added.json',{})
 for e in ordered:
  if e.get('_languageMismatch'):continue
  key=e['language']+'|'+e['type']+'|'+norm(e['name']);match=matches.get(key,{});mid=match.get('id');cid=f'dobins_{LANGS[e["language"]]}_{e["type"]}'
  if e['language']=='malayalam' and mid and not (is_imdb_id(mid) or re.fullmatch(r'tmdb:\d+',str(mid))):
   unmatched.append({'name':e['name'],'language':e['language'],'type':e['type'],'ottDate':e['ottDate'],'reason':'Malayalam catalog requires a verified IMDb or TMDB ID','sources':list(dict.fromkeys(e.get('sources') or ([e.get('source')] if e.get('source') else []))),'platforms':e.get('platforms') or [],'detail':e.get('detail'),'sourceRecord':e.get('sourceRecord') or {}});continue
  if not mid or alternate.key(e['type'],mid) not in metas:
   unmatched.append({'name':e['name'],'language':e['language'],'type':e['type'],'ottDate':e['ottDate'],'reason':match.get('reason','Awaiting metadata backfill'),'sources':list(dict.fromkeys(e.get('sources') or ([e.get('source')] if e.get('source') else []))),'platforms':e.get('platforms') or [],'detail':e.get('detail'),'sourceRecord':e.get('sourceRecord') or {}});continue
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
  added_key=cid+'|'+str(mid)
  if e['type']=='movie' and e['ottDate']<=TODAY and str(mid) not in previous_ids.get(cid,set()) and added_key not in added_at:
   added_at[added_key]=NOW.isoformat()
  added_time=None
  if added_key in added_at:
   try:added_time=datetime.fromisoformat(added_at[added_key])
   except (TypeError,ValueError):added_time=None
  just_added=bool(e['type']=='movie' and added_time and NOW-added_time<=timedelta(days=14))
  tmdb_id=re.fullmatch(r'tmdb:(\d+)',str(mid))
  if just_added and is_imdb_id(mid):
   poster_url="https://great-indian-upcoming-posters.onrender.com/poster/"+mid+".jpg?badge=just-added"
  elif just_added and tmdb_id:
   poster_url="https://great-indian-upcoming-posters.onrender.com/poster/tmdb/"+tmdb_id.group(1)+".jpg?badge=just-added&type=movie"
  else:
   poster_url=BASE+'/art/poster/'+aid
  catalogs[cid].append({'id':mid,'type':e['type'],'name':m['name'],'poster':poster_url,'posterShape':'poster','background':BASE+'/art/background/'+aid,'logo':BASE+'/art/logo/'+aid,'releaseInfo':str(m.get('releaseInfo','')),'metadataSource':m.get('metadataSource','https://v3-cinemeta.strem.io/'),'imdbRating':m.get('imdbRating'),'genres':m.get('genres',[]),'description':f"{description_label} ({display_kind}): {display_date} · {', '.join(e['platforms'])}\n\n"+(m.get('description') or e.get('description') or ''),'releaseDate':e['ottDate'],'releaseKind':e.get('releaseKind','digital'),'releaseStatus':'upcoming' if display_date>TODAY else 'available','releaseLabel':release_label,'releaseLabelDate':label_date,'originalReleaseDate':original_release_date,'availability':e.get('availability',[]),'physicalReleases':e.get('physicalReleases',[]),'theatricalReleases':e.get('theatricalReleases',[]),'ottDate':digital_date,'platforms':e['platforms'],'sources':e['sources'],'language':e['language'],'releaseDateBasis':e.get('releaseDateBasis','source release'),'latestEpisodeReleasedAt':episode_at,'hasNewEpisodes':new_episodes,'nextEpisodeReleaseAt':episode_badges.upcoming(m.get('videos',[]),NOW,m.get('seasons',[])) if e['type']=='series' else None,'justAdded':just_added,'catalogAddedAt':added_at.get(added_key)})
 for cid,ms in catalogs.items():
  append_legacy_series(ms,old_catalogs.get(cid,[]),TODAY,metas,require_metadata=cid.startswith('dobins_ml_'))
  if cid.endswith('_series'):
   for item in ms:
    item['nextEpisodeReleaseAt']=episode_badges.upcoming(metas.get(alternate.key('series',item['id']),{}).get('videos',[]),NOW,metas.get(alternate.key('series',item['id']),{}).get('seasons',[]))
    item['latestEpisodeReleasedAt'],item['hasNewEpisodes']=episode_badges.latest(metas.get(alternate.key('series',item['id']),{}).get('videos',[]),NOW)
    if item['latestEpisodeReleasedAt'] and item['latestEpisodeReleasedAt'][:10]>(item.get('releaseDate') or ''):item['releaseDate']=item['latestEpisodeReleasedAt'][:10]
  ms.sort(key=lambda m:(catalog_sort_date(m),m['name']),reverse=True)
  if not ms and old_catalogs.get(cid):
   catalogs[cid]=old_catalogs[cid]
   catalogs[cid].sort(key=lambda m:(catalog_sort_date(m),m.get('name','')),reverse=True)
 save('catalog-added.json',added_at)
 sort_audit={}
 for cid,items in catalogs.items():
  dates=[catalog_sort_date(item) for item in items]
  sort_audit[cid]={'count':len(items),'sortedNewestToOldest':dates==sorted(dates,reverse=True),'newestDate':dates[0] if dates else None,'oldestDate':dates[-1] if dates else None}
  if not sort_audit[cid]['sortedNewestToOldest']:
   raise RuntimeError('Catalog ordering audit failed for '+cid)
 malayalam_audit,malayalam_errors=validate_malayalam_catalogs(catalogs,metas)
 if malayalam_errors:
  save('metadata.json',metas);save('unmatched.json',unmatched)
  print('MALAYALAM METADATA AUDIT FAILED',json.dumps(malayalam_errors[:20]),flush=True)
  raise RuntimeError('Malayalam metadata audit failed: %s of %s catalog entries failed; last-good catalogs retained' % (len(malayalam_errors),malayalam_audit['checked']))
 if any(not catalogs[c] for c in catalogs):
  save('metadata.json',metas);save('unmatched.json',unmatched);raise RuntimeError('An empty catalog would be published; retaining last-good catalogs while metadata backfills')
 # Audit recent releases from every active discovery source, not only OTTChecker.
 # This prevents a source-specific blind spot from making the audit look healthy
 # while DailyOTT, Cinebuds or another collector has detected the same release.
 catalog_ids={cid:{str(x.get('id')) for x in items} for cid,items in catalogs.items()}
 recent_start=(date.fromisoformat(TODAY)-timedelta(days=35)).isoformat()
 recent_release_items=[]
 for e in events:
  sources=e.get('sources') or ([e.get('source')] if e.get('source') else [])
  day=str(e.get('ottDate') or '')[:10]
  if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',day) or day<recent_start or day>TODAY:continue
  key=e['language']+'|'+e['type']+'|'+norm(e['name'])
  match=matches.get(key,{})
  mid=str(match.get('id') or e.get('_verifiedImdbId') or '')
  meta=metas.get(alternate.key(e['type'],mid),{}) if mid else {}
  original=str(meta.get('original_language') or meta.get('originalLanguage') or '').lower()
  expected=LANGS[e['language']]
  complete=bool(mid and meta.get('id')==mid and meta.get('type')==e['type'] and not meta.get('_partial') and meta.get('name') and meta.get('description') and meta.get('poster'))
  published=bool(mid and mid in catalog_ids.get(f"dobins_{expected}_{e['type']}",set()))
  state='language_mismatch' if original and original not in (expected,e['language']) else 'published' if published else 'matched_not_published' if complete else 'metadata_incomplete' if mid else 'unmatched'
  recent_release_items.append({'title':e['name'],'language':e['language'],'type':e['type'],'releaseDate':day,'id':mid or None,'matchState':state,'platforms':e.get('platforms') or [],'sources':list(dict.fromkeys(sources)),'detail':e.get('detail')})
 recent_counts={}
 for row in recent_release_items:recent_counts[row['matchState']]=recent_counts.get(row['matchState'],0)+1
 recent_release_audit={'windowDays':35,'source':'all active discovery sources (rolling 35-day window)','detected':len(recent_release_items),'byMatchState':recent_counts,'items':recent_release_items}
 save('recent-release-audit.json',recent_release_audit)
 blocked=[row for row in recent_release_items if row['matchState']=='matched_not_published']
 if blocked:
  save('metadata.json',metas);save('unmatched.json',unmatched)
  raise RuntimeError('Recent releases from active discovery sources resolved to complete metadata but were not published: '+', '.join(x['title'] for x in blocked[:10]))
 save('metadata.json',metas);save('catalogs.json',catalogs);save('unmatched.json',unmatched)
 # Publish a dedicated upcoming-release index only after a real IMDb ID and
 # complete metadata have been resolved. Unmatched source rows remain diagnostic
 # data in unmatched.json and can never leak into the user-facing upcoming feed.
 upcoming_by_id={}
 for cid,items in catalogs.items():
  for item in items:
   if item.get('releaseStatus')!='upcoming' or not is_imdb_id(item.get('id')):continue
   key=(item.get('language'),item.get('type'),item['id'])
   row=upcoming_by_id.setdefault(key,{'id':item['id'],'name':item['name'],'language':item['language'],'type':item['type'],'releaseDate':item.get('ottDate') or item.get('releaseDate'),'platforms':[],'sources':[],'catalog':cid})
   row['platforms']=list(dict.fromkeys(row['platforms']+item.get('platforms',[])))
   row['sources']=list(dict.fromkeys(row['sources']+item.get('sources',[])))
 upcoming_rows=sorted(upcoming_by_id.values(),key=lambda x:(x['releaseDate'] or '',x['language'],x['name']))
 save('upcoming.json',{'generatedAt':NOW.isoformat(),'policy':'confirmed-source-and-imdb-match-v1','count':len(upcoming_rows),'items':upcoming_rows})
 # Keep a full discovery ledger alongside the strict public feed. This makes
 # source coverage and unresolved titles visible without weakening publication
 # rules or assigning speculative IDs.
 catalog_ids={cid:{str(x.get('id')) for x in items} for cid,items in catalogs.items()}
 discovery={}
 for e in events:
  day=str(e.get('ottDate') or '')[:10]
  if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',day) or day<TODAY or e.get('releaseKind','digital')!='digital':continue
  lang=e.get('language');typ=e.get('type');name=str(e.get('name') or '').strip()
  if lang not in LANGS or typ not in ('movie','series') or not name:continue
  key=lang+'|'+typ+'|'+norm(name)
  match=matches.get(key,{})
  mid=str(match.get('id') or e.get('_verifiedImdbId') or '')
  meta=metas.get(alternate.key(typ,mid),{}) if mid else {}
  complete=bool(mid and meta.get('id')==mid and meta.get('type')==typ and not meta.get('_partial') and meta.get('name') and meta.get('poster') and meta.get('description'))
  cid=f'dobins_{LANGS[lang]}_{typ}'
  published=bool(mid and mid in catalog_ids.get(cid,set()))
  state='published' if published else 'matched_not_published' if complete else 'metadata_incomplete' if mid else 'unmatched'
  rowkey=(lang,typ,norm(name),day)
  if rowkey not in discovery:
   discovery[rowkey]={'title':name,'language':lang,'type':typ,'releaseDate':day,
    'platforms':list(dict.fromkeys(e.get('platforms') or [])),
    'sources':list(dict.fromkeys(e.get('sources') or ([e.get('source')] if e.get('source') else []))),
    'confirmed':bool(e.get('confirmed')),'releaseDateBasis':e.get('releaseDateBasis'),
    'detail':e.get('detail'),'matchId':mid or None,'matchState':state,
    'metadataComplete':complete,'metadataSource':meta.get('metadataSource') or match.get('method'),
    'metadataFields':{'poster':bool(meta.get('poster')),'description':bool(meta.get('description')),
     'genres':bool(meta.get('genres')),'releaseInfo':bool(meta.get('releaseInfo'))},
    'catalog':cid if published else None}
  else:
   prior=discovery[rowkey]
   prior['sources']=list(dict.fromkeys(prior['sources']+(e.get('sources') or ([e.get('source')] if e.get('source') else []))))
   prior['platforms']=list(dict.fromkeys(prior['platforms']+(e.get('platforms') or [])))
   prior['confirmed']=prior['confirmed'] or bool(e.get('confirmed'))
   if not prior.get('detail') and e.get('detail'):prior['detail']=e['detail']
   if prior['matchState']!='published' and state=='published':
    prior.update(matchId=mid,matchState=state,metadataComplete=complete,metadataSource=meta.get('metadataSource') or match.get('method'),catalog=cid)
 discovery_rows=sorted(discovery.values(),key=lambda x:(x['releaseDate'],x['language'],x['type'],x['title']))
 discovery_counts={'total':len(discovery_rows),'byLanguage':{},'byType':{},'byMatchState':{},'bySource':{}}
 for row in discovery_rows:
  for field,value in [('byLanguage',row['language']),('byType',row['type']),('byMatchState',row['matchState'])]:
   discovery_counts[field][value]=discovery_counts[field].get(value,0)+1
  for source in row['sources']:discovery_counts['bySource'][source]=discovery_counts['bySource'].get(source,0)+1
 source_coverage=next((x.get('languageCoverage') for x in health if x.get('source')=='Per-language source coverage'),{})
 if not source_coverage:
  source_coverage={language:{'checkedSources':0,'healthySources':0,'failedSources':0,'sourcesWithRecords':0,'detectedRecords':0,'coverageStatus':'degraded','sources':[]} for language in LANGS}
 coverage_degraded=[language for language,summary in source_coverage.items() if summary.get('healthySources',0)<2 or summary.get('sourcesWithRecords',0)<2 or summary.get('sourcesWithMovieRecords',0)<2 or summary.get('sourcesWithSeriesRecords',0)<2]
 if coverage_degraded:
  health.append({'source':'Minimum independent source coverage','url':'internal://source-coverage-gate','state':'partial','records':0,
                 'error':'Fewer than two healthy independent publisher domains with actual title detections for: '+', '.join(coverage_degraded)})
 malayalam_review=[x for x in unmatched if x.get('language')=='malayalam']
 malayalam_review_counts={'total':len(malayalam_review),'byType':{}}
 for row in malayalam_review:malayalam_review_counts['byType'][row['type']]=malayalam_review_counts['byType'].get(row['type'],0)+1
 save('upcoming-discovery.json',{'generatedAt':NOW.isoformat(),'policy':'source-ledger-v1; unverified candidates are diagnostic only and are never published to upcoming.json','counts':discovery_counts,'items':discovery_rows,'malayalamReview':{'policy':'Unmatched Malayalam source detections are held out until an unambiguous IMDb or TMDB identity and complete metadata are verified.','counts':malayalam_review_counts,'items':malayalam_review},'sourceHealth':health,'sourceCoverage':source_coverage,'coveragePolicy':'Each language requires at least two healthy independent publisher domains with actual movie and series detections; failed feeds remain visible and trigger retry.'})
 upcoming_source_summary={}
 for item in upcoming_rows:
  for source in item['sources']:
   row=upcoming_source_summary.setdefault(source,{'matchedTitles':0,'imdbIds':[]})
   row['matchedTitles']+=1;row['imdbIds'].append(item['id'])
 freshness={}
 pending_by_catalog={cid:0 for cid in catalogs}
 checked_by_catalog={cid:0 for cid in catalogs}
 for item in unmatched:
  cid=f"dobins_{LANGS[item['language']]}_{item['type']}"
  if cid in pending_by_catalog:pending_by_catalog[cid]+=1
 for event in events:
  cid=f"dobins_{LANGS[event['language']]}_{event['type']}"
  if cid in checked_by_catalog:checked_by_catalog[cid]+=1
 for cid,items in catalogs.items():
  latest=max(items,key=lambda x:str(x.get('latestEpisodeReleasedAt') or x.get('ottDate') or x.get('releaseDate') or ''),default=None)
  freshness[cid]={'count':len(items),'generatedAt':NOW.isoformat(),'latestEntry':None if not latest else {'id':latest.get('id'),'name':latest.get('name'),'releaseDate':latest.get('latestEpisodeReleasedAt') or latest.get('ottDate') or latest.get('releaseDate'),'hasNewEpisodes':latest.get('hasNewEpisodes',False)}}
 status={'name':'Dobins Indian Catalog','policy':POLICY,'releasePolicy':physical.POLICY,'metadataPolicy':alternate.POLICY,'seriesPolicy':series_sources.POLICY,'updatedAt':NOW.isoformat(),'lastMatchRetryAt':NOW.isoformat(),'lastSuccessCycle':cycle(),'timezone':'Asia/Muscat','schedule':'Every two hours daily, including 00:00 (Asia/Muscat); checked every 30 minutes with retries','sources':health,'counts':{k:len(v) for k,v in catalogs.items()},'catalogFreshness':freshness,'pendingMatchesByCatalog':pending_by_catalog,'checkedCandidatesByCatalog':checked_by_catalog,'artworkPolicy':'BetterPosters proxy for Just Added and upcoming date badges; RPDB/source artwork fallbacks; original title logos with readable PNG fallback','catalogSortAudit':sort_audit,'movieSortPolicy':'Earliest verified release date wins: theatrical, then digital/OTT, then physical; catalog arrays newest-to-oldest.','pendingMatches':len(unmatched),'checkedCandidates':len(events),'malayalamMetadataAudit':malayalam_audit,'upcoming':{'matchedTitles':len(upcoming_rows),'bySource':upcoming_source_summary,'policy':'Only confirmed upcoming titles with a validated IMDb tt-ID are published.'},'upcomingDiscovery':{**discovery_counts,'malayalamReviewCount':malayalam_review_counts['total']},'recentReleaseAudit':recent_release_audit,'sourceCoverage':source_coverage,'coveragePolicy':'Each language requires at least two healthy independent publisher domains; failed feeds remain visible and trigger retry.','errors':resolve_errors}
 save('status.json',status);print('SUCCESS',json.dumps(status),flush=True)
if __name__=='__main__':
 try:build()
 except Exception as e:
  s=load('status.json',{});s.update(lastAttemptAt=NOW.isoformat(),errors=[str(e)]);save('status.json',s);print('FAILED; last-good catalogs retained:',str(e),flush=True);raise
