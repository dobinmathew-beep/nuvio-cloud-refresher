"""Independent, paginated streaming-series discovery with durable verified backfill."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timedelta
from urllib.parse import urlencode
from bs4 import BeautifulSoup
import json,re,subprocess,os
import alternate
POLICY='multi-source-series-v1'
REGIONAL='https://83e20802dcf1-indian-streams.baby-beamup.club'
PROMO=re.compile(r'\b(trailer|teaser|hangout|press meet|grand launch|promotional|behind the scenes|making of)\b',re.I)
def day(value,today):
 s=str(value or '')[:10]
 try:datetime.strptime(s,'%Y-%m-%d')
 except ValueError:return None
 return s if s<=today else None
def latest_release(m,today,fallback=None):
 # Episode dates are release evidence; modification dates never affect ordering.
 dates=[d for d in [day(v.get('released') or v.get('airdate'),today) for v in m.get('videos',[])] if d]
 first=day(m.get('released') or m.get('premiered'),today)
 if dates:return max(dates),'episode'
 if first:return first,'premiere'
 return day(fallback,today),'premiere'
def tmdb_rows(html,today):
 soup=BeautifulSoup(html,'html.parser');out={}
 for card in soup.select('[data-object-id]'):
  a=card.select_one('a[href^="/tv/"] h2');date_node=card.select_one('.release_date');img=card.select_one('img.poster')
  if not a or not date_node:continue
  name=a.get_text(' ',strip=True);link=a.find_parent('a')['href'];mid=re.match(r'/tv/(\d+)',link)
  try:d=datetime.strptime(date_node.get_text(' ',strip=True),'%d %B %Y').date().isoformat()
  except ValueError:continue
  if not mid or d>today or PROMO.search(name):continue
  out[mid[1]]={'name':name,'date':d,'poster':img.get('src','').replace('media.themoviedb.org','image.tmdb.org') if img else None}
 return out

def tvmaze_meta(show,episodes):
 imdb=(show.get('externals') or {}).get('imdb');mid=imdb if re.fullmatch(r'tt\d+',str(imdb)) else 'tvmaze:'+str(show['id'])
 videos=[{'id':mid+':'+str(e['season'])+':'+str(e['number']),'title':e.get('name',''),'season':e['season'],'episode':e['number'],**({'released':e['airdate']+'T00:00:00.000Z'} if e.get('airdate') else {}),**({'thumbnail':e['image']['original']} if e.get('image') else {})} for e in episodes if isinstance(e.get('season'),int) and isinstance(e.get('number'),int)]
 return {'id':mid,'type':'series','name':show['name'],'poster':(show.get('image') or {}).get('original'),'description':BeautifulSoup(show.get('summary') or '','html.parser').get_text(' ',strip=True),'genres':show.get('genres',[]),'released':show.get('premiered'),'releaseInfo':str(show.get('premiered') or '')[:4],'videos':videos,'tvmaze_id':show['id'],'imdb_id':imdb,'metadataSource':show['url']}

def collect(get,load,save,langs,today,now,norm):
 cache=load('series-sources.json',{'discovery':{},'titles':{}});discovery=cache.setdefault('discovery',{});titles=cache.setdefault('titles',{});health=[];candidates={}
 def listing(lang):
  code=langs[lang];items={};states=[]
  # Read multiple pages; a short first page must not silently cap the catalog.
  seen=set();regional=[];regional_error=None
  for page in range(int(os.environ.get('SERIES_REGIONAL_PAGES','5'))):
   url=f'{REGIONAL}/catalog/series/{code}_series'+(f'/skip={page*20}' if page else '')+'.json'
   try:rows=get(url).get('metas',[])
   except Exception as e:regional_error=str(e);break
   fresh=[x for x in rows if x.get('id') not in seen];seen.update(x.get('id') for x in rows);regional.extend(fresh)
   if not fresh or len(rows)<20:break
  key='regional-'+lang
  if regional:discovery[key]=regional
  else:regional=discovery.get(key,[])
  states.append({'source':'IndianRegional series discovery','language':lang,'url':REGIONAL,'state':'cached' if regional_error and regional else 'failed' if regional_error else 'live','records':len(regional)})
  for m in regional:
   mid=str(m.get('id','')).split('||')[0]
   if not (re.fullmatch(r'tt\d+',mid) or re.fullmatch(r'tmdb:\d+',mid)) or not m.get('name') or PROMO.search(m['name']):continue
   items[lang+'|'+mid]={'language':lang,'name':m['name'],'id':mid,'poster':m.get('poster'),'source':f'{REGIONAL}/catalog/series/{code}_series.json','discoveryKind':'regional'}
  tmdb={};error=None
  for page in range(1,int(os.environ.get('SERIES_TMDB_PAGES','3'))+1):
   form=urlencode({'with_original_language':code,'sort_by':'first_air_date.desc','first_air_date.lte':today,'with_watch_monetization_types':'flatrate|free|ads','watch_region':'IN','page':page,'include_adult':'false','language':'en-US'})
   try:
    html=subprocess.check_output(['curl','-fsSL','--retry','1','--connect-timeout','10','--max-time','40','--data',form,'https://www.themoviedb.org/discover/tv/items']).decode('utf-8','replace');rows=tmdb_rows(html,today);tmdb.update(rows)
    if not rows:break
   except Exception as e:error=str(e);break
  key='tmdb-'+lang
  if tmdb:discovery[key]=tmdb
  else:tmdb=discovery.get(key,{})
  states.append({'source':'TMDB streaming-series discovery','language':lang,'url':'https://www.themoviedb.org/discover/tv','state':'cached' if error and tmdb else 'failed' if error else 'live','records':len(tmdb)})
  for tid,row in tmdb.items():items[lang+'|tmdb:'+tid]={'language':lang,'name':row['name'],'id':'tmdb:'+tid,'poster':row.get('poster'),'releaseDate':row['date'],'source':'https://www.themoviedb.org/tv/'+tid,'discoveryKind':'tmdb'}
  return items,states
 with ThreadPoolExecutor(max_workers=4) as pool:
  for rows,states in pool.map(listing,langs):candidates.update(rows);health.extend(states)
 # Independent continuing discovery from TVmaze's actual streaming episode schedule.
 schedules=[];schedule_error=False
 def schedule(offset):
  date=(datetime.fromisoformat(today)-timedelta(days=offset)).date().isoformat()
  try:return get('https://api.tvmaze.com/schedule/web?date='+date),False
  except Exception:return [],True
 with ThreadPoolExecutor(max_workers=4) as pool:
  for rows,error in pool.map(schedule,range(7)):schedules.extend(rows);schedule_error=schedule_error or error
 tv_count=0
 for ep in schedules:
  show=ep.get('_embedded',{}).get('show') or ep.get('show') or {};lang=str(show.get('language','')).lower()
  if lang not in langs or not show.get('webChannel') or not day(ep.get('airdate'),today) or PROMO.search(show.get('name','')):continue
  if show.get('type') not in ('Scripted','Animation','Documentary','Reality'):continue
  key=lang+'|tvmaze:'+str(show['id']);tv_count+=1
  candidates[key]={'language':lang,'id':'tvmaze:'+str(show['id']),'name':show['name'],'show':show,'releaseDate':ep['airdate'],'source':show['url'],'discoveryKind':'tvmaze'}
 health.append({'source':'TVmaze streaming episode schedule','url':'https://api.tvmaze.com/schedule/web','state':'partial' if schedule_error else 'live','records':tv_count})
 # Merge independently discovered aliases before expensive verification. Prefer
 # an explicit IMDb identity and keep both source links and dated evidence.
 grouped={}
 for key,item in candidates.items():
  group=(item['language'],norm(item['name']));old=grouped.get(group)
  if not old:grouped[group]=(key,dict(item));continue
  oldkey,olditem=old;prefer=item['id'].startswith('tt') and not olditem['id'].startswith('tt')
  chosen=dict(item if prefer else olditem);other=olditem if prefer else item
  chosen['additionalSources']=list(dict.fromkeys(chosen.get('additionalSources',[])+other.get('additionalSources',[])+[other['source']]))
  if other.get('releaseDate') and (not chosen.get('releaseDate') or other['releaseDate']>chosen['releaseDate']):chosen['releaseDate']=other['releaseDate']
  grouped[group]=(key if prefer else oldkey,chosen)
 candidates=dict(grouped.values())
 save('series-sources.json',cache)
 work=[]
 for key,item in candidates.items():
  old=titles.get(key,{});checked=old.get('checkedAt')
  if checked and old.get('policy')==POLICY and (now-datetime.fromisoformat(checked)).total_seconds()<21600 and old.get('event'):continue
  work.append((key,item))
 # Guarantee a turn for every language, with newest discovery entries first.
 buckets={l:sorted([x for x in work if x[1]['language']==l],key=lambda x:x[1].get('releaseDate') or '',reverse=True) for l in langs}
 work=[rows[i] for i in range(max(map(len,buckets.values()),default=0)) for rows in buckets.values() if i<len(rows)]
 def inspect(pair):
  key,item=pair;lang=item['language'];mid=item['id'];typ=item['discoveryKind'];e={'name':item['name'],'language':lang,'type':'series','ottDate':item.get('releaseDate') or today,'platforms':[],'sourceRecord':{'tmdbId':mid.split(':')[1]} if mid.startswith('tmdb:') else {}}
  try:
   if typ=='tvmaze':
    show=item['show'];episodes=get('https://api.tvmaze.com/shows/'+str(show['id'])+'/episodes');m=tvmaze_meta(show,episodes);released,basis=latest_release(m,today,item.get('releaseDate'));platforms=[show['webChannel']['name']]
   elif mid.startswith('tt'):
    m=get('https://v3-cinemeta.strem.io/meta/series/'+mid+'.json').get('meta',{})
    if m.get('id')!=mid or m.get('type')!='series' or not m.get('name'):raise ValueError('Series identity mismatch')
    released,basis=latest_release(m,today,item.get('releaseDate'));platforms=[]
    if item.get('releaseDate') and (not released or item['releaseDate']>released):released,basis=item['releaseDate'],'premiere'
    # Independent language/release confirmation also fixes festival dates (e.g. Pharma).
    try:
     rows=get('https://api.tvmaze.com/lookup/shows?imdb='+mid);verified_lang=str(rows.get('language','')).lower()
     if verified_lang in langs and verified_lang!=lang:raise ValueError('Original language mismatch')
     if rows.get('webChannel'):
      eps=get('https://api.tvmaze.com/shows/'+str(rows['id'])+'/episodes');vm=tvmaze_meta(rows,eps);r,b=latest_release(vm,today)
      if r:released,basis=r,b
      if vm.get('videos'):m['videos']=vm['videos']
      platforms=[rows['webChannel']['name']]
    except ValueError:raise
    except Exception:pass
   else:
    detail_url='https://www.themoviedb.org/tv/'+mid.split(':')[1];html=get(detail_url,False)
    m=alternate.tmdb(e,lambda url,json_data=True: html if url==detail_url and not json_data else get(url,json_data),norm)
    if not m:raise ValueError('TMDB series identity mismatch')
    soup=BeautifulSoup(html,'html.parser');original=next((x.get_text(' ',strip=True).replace('Original Language','').strip().lower() for x in soup.select('p') if x.get_text(' ',strip=True).startswith('Original Language')),None)
    if original and original!=lang:raise ValueError('Original language mismatch')
    if any(x.get_text(' ',strip=True) in ('Type Talk Show','Type News') for x in soup.select('p')):raise ValueError('Not an episodic streaming series')
    released,basis=latest_release(m,today,item.get('releaseDate'));platforms=[]
    # Resolve TMDB titles to the independently published IMDb mapping when possible.
    try:
     vm=alternate.tvmaze(e,get,norm)
     if vm and vm.get('imdb_id') and vm.get('poster'):
      m={**m,**vm};r,b=latest_release(vm,today)
      if r and (not released or r>released):released,basis=r,b
    except Exception:pass
   m['poster']=m.get('poster') or item.get('poster')
   if not released or not m.get('poster') or PROMO.search(m.get('name','')):raise ValueError('No confirmed released series with artwork')
   m['_partial']=False;m['_metadataCheckedAt']=now.isoformat();m['metadataSource']=m.get('metadataSource') or 'https://v3-cinemeta.strem.io/'
   e.update(name=m['name'],ottDate=released,year=None,poster=m['poster'],platforms=platforms,source=item['source'],sources=list(dict.fromkeys([item['source'],m['metadataSource']]+item.get('additionalSources',[]))),confirmed=True,releaseKind='digital',releaseDateBasis=basis,_verifiedMetadata=m)
   return key,{'checkedAt':now.isoformat(),'policy':POLICY,'event':e}
  except Exception as error:return key,{**titles.get(key,{}),'lastAttemptAt':now.isoformat(),'lastError':str(error)}
 max_checks=int(os.environ.get('MAX_SERIES_CHECKS','260'))
 with ThreadPoolExecutor(max_workers=4) as pool:
  for i,(key,value) in enumerate(pool.map(inspect,work[:max_checks]),1):
   titles[key]=value
   if i%20==0:save('series-sources.json',cache);print('SERIES VERIFIED',i,'/',min(len(work),max_checks),flush=True)
 save('series-sources.json',cache)
 events=[v['event'] for v in titles.values() if v.get('event') and day(v['event'].get('ottDate'),today)]
 health.append({'source':'Verified multi-source series backfill','policy':POLICY,'records':len(events),'counts':{l:sum(e['language']==l for e in events) for l in langs},'state':'live' if events else 'failed'})
 return events,health
