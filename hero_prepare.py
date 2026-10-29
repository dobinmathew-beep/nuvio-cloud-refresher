"""Fetch only the four IndianRegional movie catalogs; retain eight pinned originals."""
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
from concurrent.futures import ThreadPoolExecutor
import json,re,subprocess,hashlib,io
from PIL import Image,ImageOps
ROOT=Path(__file__).resolve().parents[3];HERE=Path(__file__).parent;HERO=HERE.parent
SOURCE='https://83e20802dcf1-indian-streams.baby-beamup.club'
CATS={'hindi':'hi','tamil':'ta','malayalam':'ml','telugu':'te'}
def get(url):
 p=subprocess.run(['curl','-fsSL','--retry','1','--connect-timeout','12','--max-time','50',url],capture_output=True)
 if p.returncode:raise RuntimeError(p.stderr.decode()[:180])
 return p.stdout

def prepare(lang):
 url=f'{SOURCE}/catalog/movie/{CATS[lang]}.json';feed=json.loads(get(url));original=[dict(m,pinned=True) for m in json.loads((HERO/'credits.json').read_text()) if m['language']==lang];pinned={m['id'] for m in original};all_pinned={m['id'] for m in json.loads((HERO/'credits.json').read_text())};recent=[]
 for m in feed.get('metas',[]):
  mid=m.get('id','').split('||',1)[0];name=m.get('name','').strip()
  if not re.fullmatch(r'tt\d+|tmdb:\d+',mid) or mid in pinned or m.get('type')!='movie' or not m.get('poster'):continue
  if re.search(r'OTT\s*Releases|Hindi\s*Dubbed|promo|unlock',name,re.I):continue
  if any(x['id']==mid for x in recent):continue
  poster=HERO/'posters'/(mid+'.jpg')
  try:
   if mid not in all_pinned or not poster.exists():
    raw=get(m['poster']);img=Image.open(io.BytesIO(raw)).convert('RGB');assert img.width>=100 and img.height>=140
    img=ImageOps.contain(img,(600,900),Image.Resampling.LANCZOS);tmp=poster.with_suffix('.'+lang+'.tmp');img.save(tmp,format='JPEG',quality=93,optimize=True);tmp.replace(poster)
  except Exception as e:
   if not poster.exists():raise RuntimeError(lang+': required top catalog poster unavailable for '+name+'; retaining last-good reel') from e
  year=re.search(r'\d{4}',str(m.get('releaseInfo','')))
  recent.append({'language':lang,'id':mid,'name':name,'year':int(year.group()) if year else None,'poster_source':m['poster'],'catalog_source':url,'pinned':False})
  if len(recent)==12:break
 if len(recent)!=12:raise RuntimeError(f'{lang}: only {len(recent)} valid recent movie posters; keeping last-good video')
 # Recent entries come first, then all eight original films in their existing order.
 movies=recent+original;signature=hashlib.sha256(('catalog-head-v2'+json.dumps(movies,sort_keys=True)).encode())
 for m in movies:signature.update((HERO/'posters'/(m['id']+'.jpg')).read_bytes())
 config={'language':lang,'catalog':CATS[lang],'source_url':url,'checked_at':datetime.now(ZoneInfo('Asia/Muscat')).isoformat(),'signature':signature.hexdigest(),'pinned_count':len(original),'recent_count':len(recent),'movies':movies}
 path=HERE/(lang+'.json');tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(config,indent=2));tmp.replace(path)
 print(lang,':',len(recent),'catalog movies +',len(original),'originals',flush=True)
 return config
if __name__=='__main__':
 with ThreadPoolExecutor(max_workers=4) as ex:list(ex.map(prepare,CATS))
