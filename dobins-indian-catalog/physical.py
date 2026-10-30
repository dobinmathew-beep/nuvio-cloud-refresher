"""Dated, released physical editions from TMDB's public release tables."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timedelta,date
from urllib.parse import urlencode
from bs4 import BeautifulSoup
import subprocess,re,os
import alternate
POLICY='ott-or-confirmed-physical-v1'
def merge_events(events,norm):
 merged={}
 for event in events:
  e=dict(event);k=(e['language'],e['type'],norm(e['name']));kind=e.get('releaseKind','digital')
  availability={'kind':kind,'date':e['ottDate'],'platforms':e.get('platforms',[]),'sources':e.get('sources',[e.get('source')])}
  if k not in merged:merged[k]={**e,'releaseKind':kind,'availability':[availability]};continue
  old=merged[k];all_av=old['availability']+[availability]
  pick_new=(e['type']=='series' and e['ottDate']>old['ottDate']) or (e['type']=='movie' and e['ottDate']<old['ottDate'])
  chosen={**(e if pick_new else old)};chosen['releaseKind']=kind if pick_new else old['releaseKind'];chosen['availability']=all_av
  chosen['sources']=list(dict.fromkeys(old.get('sources',[])+e.get('sources',[])))
  chosen['platforms']=list(dict.fromkeys(old.get('platforms',[])+e.get('platforms',[])))
  chosen['physicalReleases']=old.get('physicalReleases',[])+e.get('physicalReleases',[])
  if e.get('_verifiedMetadata'):chosen['_verifiedMetadata']=e['_verifiedMetadata']
  if not chosen.get('sourceRecord'):chosen['sourceRecord']=old.get('sourceRecord') or e.get('sourceRecord')
  merged[k]=chosen
 return list(merged.values())
def discover(code,today):
 url='https://www.themoviedb.org/discover/movie/items'
 # This is the read-only form endpoint used by TMDB's public Discover page.
 form=urlencode({'with_original_language':code,'with_release_type':'5','release_date.lte':today,'sort_by':'release_date.desc','page':'1','include_adult':'false','region':'','language':'en-US'})
 html=subprocess.check_output(['curl','-fsSL','--retry','1','--connect-timeout','10','--max-time','40','--data',form,url]).decode('utf-8','replace')
 soup=BeautifulSoup(html,'html.parser');out={}
 for a in soup.select('a[href]'):
  match=re.match(r'/movie/(\d+)',a['href']);name=a.get_text(' ',strip=True)
  if match and name:out[match.group(1)]=name
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
def collect(get,load,save,langs,today,now,norm):
 cache=load('physical.json',{'titles':{},'discovery':{}});titles=cache.setdefault('titles',{});discovery=cache.setdefault('discovery',{});candidates={};health=[]
 def listing(pair):
  lang,code=pair
  try:
   rows=discover(code,today);return lang,rows,None
  except Exception as error:return lang,None,str(error)
 with ThreadPoolExecutor(max_workers=4) as pool:
  for lang,rows,error in pool.map(listing,langs.items()):
   if rows is not None:discovery[lang]={'checkedAt':now.isoformat(),'titles':rows}
   rows=rows if rows is not None else discovery.get(lang,{}).get('titles',{})
   for tid,name in rows.items():candidates[lang+'|'+tid]=(lang,tid,name)
   health.append({'source':'TMDB physical releases','language':lang,'state':'live' if not error else 'cached' if rows else 'failed','records':len(rows),**({'error':error} if error else {})})
 # Keep previously confirmed editions even when they leave the first discovery page.
 work=[]
 for key,(lang,tid,name) in candidates.items():
  old=titles.get(key,{});checked=old.get('lastAttemptAt') or old.get('checkedAt')
  if checked and (now-datetime.fromisoformat(checked)).total_seconds()<10800:continue
  work.append((key,lang,tid,name))
 def inspect(item):
  key,lang,tid,name=item;url='https://www.themoviedb.org/movie/'+tid+'/releases'
  try:
   editions=releases(get(url,False),today)
   if not editions:return key,{'checkedAt':now.isoformat(),'editions':[]}
   first=editions[0];event={'name':name,'type':'movie','language':lang,'ottDate':first['date'],'sourceRecord':{'tmdbId':int(tid)}}
   meta=alternate.tmdb(event,get,norm)
   if not meta:raise ValueError('Physical title identity could not be verified')
   event.update(name=meta['name'],poster=meta.get('poster'),year=meta.get('releaseInfo') or None,platforms=[first['format']+' · '+first['country']],source=url,sources=[url],confirmed=True,releaseKind='physical',physicalReleases=editions,_verifiedMetadata=meta)
   return key,{'checkedAt':now.isoformat(),'editions':editions,'event':event}
  except Exception as error:
   old=titles.get(key,{});return key,{**old,'lastAttemptAt':now.isoformat(),'lastError':str(error)}
 with ThreadPoolExecutor(max_workers=4) as pool:
  for key,value in pool.map(inspect,work[:int(os.environ.get('MAX_PHYSICAL_CHECKS','80'))]):titles[key]=value
 save('physical.json',cache)
 events=[]
 for value in titles.values():
  event=value.get('event');editions=[x for x in value.get('editions',[]) if re.search(r'blu.?ray|\bdvd\b|uhd|4k',x.get('note',''),re.I) and x['date']<=today]
  if not event or not editions:continue
  first=editions[0];event={**event,'ottDate':first['date'],'physicalReleases':editions,'platforms':[first['format']+' · '+first['country']]}
  events.append(event)
 return events,health
