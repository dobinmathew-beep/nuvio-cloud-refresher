import concurrent.futures as cf,datetime,json,re,subprocess,threading
from zoneinfo import ZoneInfo
B='https://dobin-nuvio-live-backdrops.quickfield138.chatgpt.site';S='https://83e20802dcf1-indian-streams.baby-beamup.club'
C={'hindi':'hi','tamil':'ta','malayalam':'ml','telugu':'te'}
A='wall cascade spotlight filmstrip gallery ribbon duo polaroid neon towers'.split();X=A+'mosaic fan orbit triptych cinema steps cross shelf widescreen diamond'.split()
D=datetime.datetime.now(ZoneInfo('Asia/Muscat')).date().isoformat();feeds={};errors=[];rows=[];lock=threading.Lock()
def get(u):
 p=subprocess.run(['curl','-fsSL','--connect-timeout','15','--max-time','100','-w','\n%{http_code} %{content_type}',u],capture_output=True)
 assert p.returncode==0,p.stderr.decode()[-200:]
 b,h=p.stdout.rsplit(b'\n',1);code,mime=h.decode().split(' ',1);assert code=='200',code
 return b,mime.split(';')[0]
def retry(f):
 for i in range(2):
  try:return f(),None
  except Exception as e:err=str(e) or type(e).__name__
 return None,err
def src(k):
 l,t=k;cat=C[l]+('_series' if t=='series' else '')
 def run():
  b,_=get(f'{S}/catalog/{t}/{cat}.json');ms=json.loads(b)['metas'];ids={m.get('id','').split('||')[0] for m in ms if m.get('type',t)==t and re.fullmatch(r'tt\d+|tmdb:\d+',m.get('id','').split('||')[0])};assert ids,'empty source';return ids
 v,e=retry(run)
 if e:errors.append({'source':cat,'error':e})
 else:feeds[k]=v
 print('SOURCE',cat,e or 'OK',flush=True)
def status(k):
 l,t,s=k
 def run():
  b,_=get(f'{B}/status/{l}/{t}/{s}.json?check=1');d=json.loads(b)
  for key,val in [('language',l),('kind',t),('style',s),('day',D)]:assert d.get(key)==val,f'{key}: {d.get(key)!r}, expected {val!r}'
  assert d.get('state') in ('live','cached'),str(d.get('state'))
  cat=C[l];exp=[cat,cat+'_series'] if t=='combined' else cat+('_series' if t=='series' else '')
  assert d.get('catalog')==exp,f'wrong catalog {d.get("catalog")}'
  assert d.get('hash') and d.get('bytes',0)>0,'missing artwork metadata'
  ms=d.get('movies',[]);assert ms,'empty titles';types=[]
  for m in ms:
   mid=m.get('id','').split('||')[0];assert re.fullmatch(r'tt\d+|tmdb:\d+',mid),'invalid/promotional ID '+mid
   assert not re.search(r'OTT\s*Releases|Hindi\s*Dubbed|unlock|promotional',m.get('name',''),re.I),'forbidden title'
   typ=m.get('type') if t=='combined' else ('movie' if t=='movies' else 'series');assert typ in ('movie','series'),'invalid type'
   if (l,typ) in feeds:assert mid in feeds[(l,typ)],f'{mid} outside approved catalog'
   types.append(typ)
  if t=='combined':assert len(types)>=2 and types==[('movie' if i%2==0 else 'series') for i in range(len(types))],'not interleaved'
  return {'key':'/'.join(k),'state':d['state'],'bytes':d['bytes'],'count':len(ms)}
 v,e=retry(run)
 with lock:
  if e:errors.append({'status':'/'.join(k),'error':e})
  rows.append(v)
  if len(rows)%20==0 or e:print('STATUS',len(rows),'/160',e or 'OK',flush=True)
def jpg(k):
 def run():
  b,m=get(f'{B}/backdrops/{k[0]}/{k[1]}/{k[2]}.jpg');assert m=='image/jpeg',m;assert b.startswith(b'\xff\xd8\xff') and len(b)>1000,'bad JPEG';return len(b)
 v,e=retry(run)
 if e:errors.append({'image':'/'.join(k),'error':e})
 print('JPEG','/'.join(k),e or 'OK',flush=True)
with cf.ThreadPoolExecutor(max_workers=4) as ex:list(ex.map(src,[(l,t) for l in C for t in ('movie','series')]))
keys=[(l,t,s) for l in C for t in ('movies','series','combined') for s in (X if t=='combined' else A)];assert len(keys)==160
with cf.ThreadPoolExecutor(max_workers=4) as ex:list(ex.map(status,keys))
imgs=[(l,t,'polaroid') for l in C for t in ('movies','series','combined')]+[(l,'combined','orbit') for l in C]
with cf.ThreadPoolExecutor(max_workers=4) as ex:list(ex.map(jpg,imgs))
print('SUMMARY',json.dumps({'day':D,'statuses':len(rows),'images':len(imgs),'states':{s:sum(1 for r in rows if r and r['state']==s) for s in ('live','cached')},'errors':errors}),flush=True)
