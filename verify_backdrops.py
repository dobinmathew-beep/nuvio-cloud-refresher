import concurrent.futures as cf,datetime,json,re,subprocess,threading
from pathlib import Path
from featured import first_valid
from zoneinfo import ZoneInfo
B='https://dobin-nuvio-live-backdrops.quickfield138.chatgpt.site';S='https://83e20802dcf1-indian-streams.baby-beamup.club'
C={'hindi':'hi','tamil':'ta','malayalam':'ml','telugu':'te'}
A='wall cascade spotlight filmstrip gallery ribbon duo polaroid neon towers'.split();X=A+'mosaic fan orbit triptych cinema steps cross shelf widescreen diamond'.split()
D=datetime.datetime.now(ZoneInfo('Asia/Muscat')).date().isoformat();feeds={};errors=[];rows=[];lock=threading.Lock()

def service_day_is_current(day, started_at, finished_at):
    """Accept either side of a request that straddles Oman midnight."""
    allowed={started_at.astimezone(ZoneInfo('Asia/Muscat')).date().isoformat(),
             finished_at.astimezone(ZoneInfo('Asia/Muscat')).date().isoformat()}
    return day in allowed
FEATURED=json.loads((Path(__file__).resolve().parent/'state/featured-movies.json').read_text())['languages'];HEADS={}
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
  ids=set()
  for skip in ((0,20,40) if t=='movie' else (0,)):
   try:
    b,_=get(f'{S}/catalog/{t}/{cat}'+(f'/skip={skip}' if skip else '')+'.json');data=json.loads(b);ms=data.get('metas',[]) if isinstance(data,dict) else []
   except Exception:
    if skip:break
    raise
   if t=='movie' and skip==0:
    head=first_valid(ms,l)
    assert head,f'{cat}: no valid first/current IndianRegional movie'
    HEADS[l]=str(head.get('id','')).split('||',1)[0]
   ids.update(m.get('id','').split('||')[0] for m in ms if m.get('type',t)==t and re.fullmatch(r'tt\d+|tmdb:\d+',m.get('id','').split('||')[0]))
  assert ids,'empty source';return ids
 v,e=retry(run)
 if e:errors.append({'source':cat,'error':e})
 else:feeds[k]=v
 print('SOURCE',cat,e or 'OK',flush=True)
def status(k):
 l,t,s=k
 def run():
  started_at=datetime.datetime.now(ZoneInfo('Asia/Muscat'))
  b,_=get(f'{B}/status/{l}/{t}/{s}.json?check=1')
  finished_at=datetime.datetime.now(ZoneInfo('Asia/Muscat'));d=json.loads(b)
  for key,val in [('language',l),('kind',t),('style',s)]:assert d.get(key)==val,f'{key}: {d.get(key)!r}, expected {val!r}'
  assert service_day_is_current(d.get('day'),started_at,finished_at),f"day: {d.get('day')!r}, expected Oman date at request start/end ({started_at.date()} / {finished_at.date()})"
  assert d.get('state') in ('live','cached'),str(d.get('state'))
  cat=C[l];exp=[cat,cat+'_series'] if t=='combined' else cat+('_series' if t=='series' else '')
  assert d.get('catalog')==exp,f'wrong catalog {d.get("catalog")}'
  assert d.get('hash') and d.get('bytes',0)>0,'missing artwork metadata'
  if t in ('movies','combined'):
   lead=FEATURED[l];center=d.get('centerMovie',{});head=HEADS.get(l)
   assert head,'live IndianRegional catalog head was not independently checked'
   assert lead.get('id')==head,f'saved featured selection is stale: {lead.get("id")} != current catalog head {head}'
   assert d.get('renderVersion')=='catalog-head-v2','old centre selection version'
   assert center.get('id')==head and center.get('selection')=='catalog-order' and center.get('catalogRank')==0,'incorrect current catalog-head centre movie'
   assert isinstance(d.get('centerSlot'),int),'missing centre panel metadata'
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
print('SUMMARY',json.dumps({'day':D,'statuses':len(rows),'images':len(imgs),'states':{s:sum(1 for r in rows if r and r['state']==s) for s in ('live','cached')},'errors':errors,'catalogHeads':HEADS}),flush=True)

