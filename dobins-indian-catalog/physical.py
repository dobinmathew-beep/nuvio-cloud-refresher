"""Dated theatrical and physical releases from TMDB's public release tables."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from urllib.parse import urlencode
from bs4 import BeautifulSoup
import subprocess,re,os
import alternate

POLICY='theatrical-first-multipage-v3'
PRIORITY={'theatrical':0,'digital':1,'physical':2}

def merge_events(events,norm,today=None):
 today=today or datetime.now().date().isoformat()
 merged={}
 for event in events:
  e=dict(event);k=(e['language'],e['type'],norm(e['name']));kind=e.get('releaseKind','digital')
  availability=list(e.get('availability') or [])
  own={'kind':kind,'date':str(e.get('ottDate') or '')[:10],'platforms':e.get('platforms',[]),'sources':e.get('sources',[e.get('source')])}
  if own['date'] and not any(x.get('kind')==kind and x.get('date')==own['date'] for x in availability):availability.append(own)
  if k not in merged:
   merged[k]={**e,'releaseKind':kind,'availability':availability};continue
  old=merged[k];all_av=list(old.get('availability',[]))+[x for x in availability if x not in old.get('availability',[])]
  if e['type']=='series':
   pick_new=str(e.get('ottDate') or '')>str(old.get('ottDate') or '')
  else:
   new_kind=e.get('releaseKind','digital')
   old_kind=old.get('releaseKind','digital')
   new_date=str(e.get('ottDate') or '')[:10]
   old_date=str(old.get('ottDate') or '')[:10]
   new_priority=PRIORITY.get(new_kind,1)
   old_priority=PRIORITY.get(old_kind,1)
   if new_priority!=old_priority:
    pick_new=new_priority<old_priority
   elif new_kind=='digital':
    # For repeated OTT detections, keep the newest confirmed digital arrival.
    # Theatrical remains higher priority, and physical/theatrical events retain
    # their earliest confirmed release date.
    pick_new=new_date>old_date
   else:
    pick_new=new_date<old_date
  chosen={**(e if pick_new else old)}
  chosen['releaseKind']=kind if pick_new else old.get('releaseKind','digital')
  chosen['ottDate']=str(chosen.get('ottDate') or '')[:10]
  chosen['availability']=all_av
  chosen['sources']=list(dict.fromkeys(old.get('sources',[])+e.get('sources',[])))
  chosen['platforms']=list(dict.fromkeys(old.get('platforms',[])+e.get('platforms',[])))
  chosen['physicalReleases']=old.get('physicalReleases',[])+e.get('physicalReleases',[])
  chosen['theatricalReleases']=old.get('theatricalReleases',[])+e.get('theatricalReleases',[])
  if e.get('_verifiedMetadata'):chosen['_verifiedMetadata']=e['_verifiedMetadata']
  if not chosen.get('sourceRecord'):chosen['sourceRecord']=old.get('sourceRecord') or e.get('sourceRecord')
  merged[k]=chosen
 return list(merged.values())

def discover(code,today,release_type='5',max_pages=5):
 url='https://www.themoviedb.org/discover/movie/items'
 out={}
 for page in range(1,max_pages+1):
  form=urlencode({'with_original_language':code,'with_release_type':str(release_type),'release_date.lte':today,'sort_by':'release_date.desc','page':str(page),'include_adult':'false','region':'','language':'en-US'})
  html=subprocess.check_output(['curl','-fsSL','--retry','1','--connect-timeout','10','--max-time','40','--data',form,url]).decode('utf-8','replace')
  soup=BeautifulSoup(html,'html.parser')
  found=0
  for a in soup.select('a[href]'):
   match=re.match(r'/movie/(\d+)',a['href']);name=a.get_text(' ',strip=True)
   if match and name:out[match.group(1)]=name;found+=1
  if not found:break
 return out

def releases(html,today):
 soup=BeautifulSoup(html,'html.parser');found=[]
 for table in soup.select('table.releases'):
  heading=table.select_one('h2.release');country=heading.get_text(' ',strip=True) if heading else 'Unspecified';region=heading.get('id') if heading else None
  for row in table.select('tbody tr'):
   cells=[x.get_text(' ',strip=True) for x in row.select('td')]
   if len(cells)<5 or cells[2].lower()!='physical':continue
   try:day=datetime.strptime(cells[0],'%d/%m/%Y').date().isoformat()
   except ValueError:continue
   if day>today:continue
   note=cells[4]
   if not re.search(r'blu.?ray|\bdvd\b|uhd|4k',note,re.I):continue
   fmt='DVD / Blu-ray'
   if re.search(r'blu.?ray|uhd|4k',note,re.I):fmt='4K Blu-ray' if re.search(r'uhd|4k',note,re.I) else 'Blu-ray'
   if re.search(r'\bdvd\b',note,re.I):fmt='DVD / Blu-ray' if fmt!='DVD / Blu-ray' else 'DVD'
   found.append({'date':day,'format':fmt,'country':country,'region':region,'note':note})
 return sorted(found,key=lambda x:x['date'])

def theatrical_releases(html,today):
 soup=BeautifulSoup(html,'html.parser');found=[]
 for table in soup.select('table.releases'):
  heading=table.select_one('h2.release');country=heading.get_text(' ',strip=True) if heading else 'Unspecified';region=heading.get('id') if heading else None
  for row in table.select('tbody tr'):
   cells=[x.get_text(' ',strip=True) for x in row.select('td')]
   if len(cells)<5 or not cells[2].lower().startswith('theatrical'):continue
   try:day=datetime.strptime(cells[0],'%d/%m/%Y').date().isoformat()
   except ValueError:continue
   if day<=today:found.append({'date':day,'country':country,'region':region,'note':cells[4]})
 return sorted(found,key=lambda x:x['date'])

def collect(get,load,save,langs,today,now,norm):
 cache=load('physical.json',{'titles':{},'discovery':{}});titles=cache.setdefault('titles',{});discovery=cache.setdefault('discovery',{});candidates={};health=[]
 if cache.get('policy')!=POLICY:
  for value in titles.values():
   value.pop('checkedAt',None);value.pop('lastAttemptAt',None)
  cache['policy']=POLICY
 def listing(pair):
  lang,code=pair;result={};errors=[]
  for release_type,label in (('2','theatrical'),('3','theatrical'),('5','physical')):
   try:
    rows=discover(code,today,release_type)
    for tid,name in rows.items():
     result.setdefault(tid,{'name':name,'kinds':set()})['kinds'].add(label)
   except Exception as error:errors.append(label+': '+str(error))
  return lang,result,'; '.join(errors) if errors else None
 with ThreadPoolExecutor(max_workers=4) as pool:
  for lang,rows,error in pool.map(listing,langs.items()):
   if rows:
    discovery[lang]={'checkedAt':now.isoformat(),'titles':{tid:value['name'] for tid,value in rows.items()},'kinds':{tid:sorted(value['kinds']) for tid,value in rows.items()}}
   cached=discovery.get(lang,{})
   use=rows or {tid:{'name':name,'kinds':set(cached.get('kinds',{}).get(tid,['physical']))} for tid,name in cached.get('titles',{}).items()}
   for tid,value in use.items():candidates[lang+'|'+tid]=(lang,tid,value['name'])
   health.append({'source':'TMDB theatrical and physical releases','language':lang,'state':'live' if not error else 'cached' if use else 'failed','records':len(use),'theatricalCandidates':sum('theatrical' in value['kinds'] for value in use.values()),'physicalCandidates':sum('physical' in value['kinds'] for value in use.values()),**({'error':error} if error else {})})
 work=[]
 buckets={lang:[] for lang in langs}
 for key,(lang,tid,name) in candidates.items():
  old=titles.get(key,{});checked=old.get('lastAttemptAt') or old.get('checkedAt')
  retry_after=10800 if old.get('lastError') else 2592000
  if checked and (now-datetime.fromisoformat(checked)).total_seconds()<retry_after:continue
  buckets[lang].append((key,lang,tid,name))
 work=[rows[i] for i in range(max((len(rows) for rows in buckets.values()),default=0)) for rows in buckets.values() if i<len(rows)]
 def inspect(item):
  key,lang,tid,name=item;url='https://www.themoviedb.org/movie/'+tid+'/releases'
  try:
   html=get(url,False);editions=releases(html,today);theatrical=theatrical_releases(html,today)
   if not editions and not theatrical:return key,{'checkedAt':now.isoformat(),'editions':[],'theatrical':[],'events':[]}
   first=theatrical[0] if theatrical else editions[0]
   event={'name':name,'type':'movie','language':lang,'ottDate':first['date'],'sourceRecord':{'tmdbId':int(tid)}}
   meta=alternate.tmdb(event,get,norm)
   if not meta:raise ValueError('Theatrical/physical title identity could not be verified')
   events=[]
   if theatrical:
    first=theatrical[0]
    events.append({**event,'name':meta['name'],'poster':meta.get('poster'),'year':meta.get('releaseInfo') or None,'ottDate':first['date'],'platforms':['Theatrical · '+first['country']],'source':url,'sources':[url],'confirmed':True,'releaseKind':'theatrical','releaseDateBasis':'TMDB first theatrical release date','theatricalReleases':theatrical,'_verifiedMetadata':meta})
   if editions:
    first=editions[0]
    events.append({**event,'name':meta['name'],'poster':meta.get('poster'),'year':meta.get('releaseInfo') or None,'ottDate':first['date'],'platforms':[first['format']+' · '+first['country']],'source':url,'sources':[url],'confirmed':True,'releaseKind':'physical','releaseDateBasis':'TMDB physical release date','physicalReleases':editions,'_verifiedMetadata':meta})
   return key,{'checkedAt':now.isoformat(),'editions':editions,'theatrical':theatrical,'events':events}
  except Exception as error:
   old=titles.get(key,{});return key,{**old,'lastAttemptAt':now.isoformat(),'lastError':str(error)}
 with ThreadPoolExecutor(max_workers=4) as pool:
  for key,value in pool.map(inspect,work[:int(os.environ.get('MAX_PHYSICAL_CHECKS','240'))]):titles[key]=value
 save('physical.json',cache)
 events=[]
 for value in titles.values():
  stored=value.get('events') or ([value['event']] if value.get('event') else [])
  editions=[x for x in value.get('editions',[]) if re.search(r'blu.?ray|\bdvd\b|uhd|4k',x.get('note',''),re.I) and x['date']<=today]
  theatrical=[x for x in value.get('theatrical',[]) if x.get('date') and x['date']<=today]
  for event in stored:
   if event.get('releaseKind')=='physical':
    if not editions:continue
    first=editions[0];event={**event,'ottDate':first['date'],'physicalReleases':editions,'platforms':[first['format']+' · '+first['country']]}
   elif event.get('releaseKind')=='theatrical':
    if not theatrical:continue
    first=theatrical[0];event={**event,'ottDate':first['date'],'theatricalReleases':theatrical,'platforms':['Theatrical · '+first['country']]}
   events.append(event)
 return events,health


def catalog_release_date(item):
 """Canonical date used for every catalog's newest-first ordering."""
 if item.get('type')=='series' and item.get('latestEpisodeReleasedAt'):
  return str(item.get('latestEpisodeReleasedAt') or '')[:10]
 return str(item.get('releaseDate') or item.get('ottDate') or '')[:10]
