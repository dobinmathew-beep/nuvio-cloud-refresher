"""Verified public TMDB/TVmaze fallback; no API keys or guessed IMDb IDs."""
import json,re
from urllib.parse import quote,urlparse
from bs4 import BeautifulSoup
from rapidfuzz.fuzz import ratio

POLICY='tmdb-tvmaze-v1'
def key(typ,mid):return mid if mid.startswith('tt') else typ+'|'+mid
def artid(typ,mid):return mid if mid.startswith('tt') else typ+'~'+mid
def plain(name):
 name=re.sub(r'\s*\((?:series|web series|season\s*\d+)\)|\bseason\s*\d+','',name,flags=re.I).strip()
 if name.lower().startswith(('bigg boss','koffee with karan')):name=re.sub(r'\s+\d+(?::.*)?$','',name)
 return name
def tvmaze(e,get,norm):
 if e['type']!='series':return None
 name=plain(e['name']);rows=get('https://api.tvmaze.com/search/shows?q='+quote(name,safe=''));valid=[]
 for row in rows:
  s=row['show'];year=str(s.get('premiered') or '')[:4]
  if ratio(norm(name),norm(s['name']))<97 or str(s.get('language','')).lower()!=e['language']:continue
  if year and year>e['ottDate'][:4]:continue
  valid.append(s)
 if len(valid)!=1:return None
 s=valid[0];imdb=s.get('externals',{}).get('imdb');mid=imdb if re.fullmatch(r'tt\d+',str(imdb)) else 'tvmaze:'+str(s['id'])
 episodes=get('https://api.tvmaze.com/shows/'+str(s['id'])+'/episodes')
 videos=[{'id':mid+':'+str(x['season'])+':'+str(x['number']),'title':x['name'],'season':x['season'],'episode':x['number'],**({'released':x['airdate']+'T00:00:00.000Z'} if x.get('airdate') else {}),**({'thumbnail':x['image']['original']} if x.get('image') else {})} for x in episodes if isinstance(x.get('season'),int) and isinstance(x.get('number'),int)]
 return {'id':mid,'type':'series','name':s['name'],'poster':(s.get('image') or {}).get('original'),'description':BeautifulSoup(s.get('summary') or '', 'html.parser').get_text(' ',strip=True),'genres':s.get('genres',[]),'releaseInfo':str(s.get('premiered') or '')[:4],'videos':videos,'tvmaze_id':s['id'],'imdb_id':imdb,'metadataSource':s['url']}
def tmdb(e,get,norm):
 row=e.get('sourceRecord') or {};details=row.get('tmdbDetails') or {};tid=row.get('tmdbId') or details.get('tmdbId')
 if not str(tid).isdigit() or int(tid)<=0:return None
 typ=e['type'];url='https://www.themoviedb.org/'+('movie' if typ=='movie' else 'tv')+'/'+str(tid)
 soup=BeautifulSoup(get(url,False),'html.parser');expected='Movie' if typ=='movie' else 'TVSeries';obj=None
 for node in soup.select('script[type="application/ld+json"]'):
  raw=re.sub(r'/\*.*?\*/','',node.get_text(),flags=re.S).strip()
  try:value=json.loads(raw)
  except ValueError:continue
  for x in value if isinstance(value,list) else [value]:
   if isinstance(x,dict) and x.get('@type')==expected:obj=x;break
 if not obj or ratio(norm(plain(e['name'])),norm(obj.get('name','')))<97:return None
 canonical=urlparse(obj.get('url',''));category='movie' if typ=='movie' else 'tv'
 if canonical.hostname not in ('www.themoviedb.org','themoviedb.org') or not re.fullmatch('/'+category+'/'+str(tid)+r'(?:-[^/]*)?/?',canonical.path):return None
 date=next((x.get('startDate','') for x in obj.get('releasedEvent',[]) if isinstance(x,dict)),obj.get('startDate') or obj.get('datePublished',''))
 if date and date[:10]>e['ottDate']:return None
 if e.get('year') and date and date[:4]!=str(e['year']):return None
 imdb=next((re.search(r'tt\d+',a['href']).group() for a in soup.select('a[href]') if re.search(r'imdb\.com/title/tt\d+',a['href'])),None)
 mid=imdb or 'tmdb:'+str(tid)
 if not details and row.get('_id'):
  try:details=get('https://www.dailyott.in/api/movies/'+row['_id']+'/details').get('details') or {}
  except Exception:details={}
 images=[a.get('content','').replace('media.themoviedb.org','image.tmdb.org') for a in soup.select('meta[property="og:image"]')]
 poster=(obj.get('image') or row.get('posterUrl') or '').replace('/w500/','/w780/')
 return {'id':mid,'type':typ,'name':obj['name'],'poster':poster,'background':images[1] if len(images)>1 else None,'description':obj.get('description') or details.get('overview',''),'genres':obj.get('genre',details.get('genres',[])),'releaseInfo':date[:4] or str(details.get('releaseDate') or '')[:4],'cast':[x['name'] for x in details.get('cast',[]) if x.get('name')],'director':[details['director']] if details.get('director') else [],'runtime':str(details.get('runtime',''))+' min' if details.get('runtime') else None,'tmdb_id':int(tid),'imdb_id':imdb,'metadataSource':url}
def resolve(e,get,norm):
 for fn in [tvmaze,tmdb]:
  try:
   m=fn(e,get,norm)
   if m and m.get('poster'):return m
  except Exception:continue
 return None
