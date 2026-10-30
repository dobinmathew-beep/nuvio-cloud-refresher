"""Select the first valid entry in each IndianRegional movie catalog's own order."""
from datetime import datetime, timezone
from pathlib import Path
import json,re,subprocess
SOURCE='https://83e20802dcf1-indian-streams.baby-beamup.club'
LANGS={'hindi':'hi','tamil':'ta','malayalam':'ml','telugu':'te'}
def get(url):
 p=subprocess.run(['curl','-fsSL','--retry','1','--connect-timeout','10','--max-time','40',url],capture_output=True)
 if p.returncode:raise RuntimeError('Catalog download failed; retaining last-good selection')
 return json.loads(p.stdout)
def valid(m,lang=None):
 mid=str(m.get('id','')).split('||',1)[0]
 return re.fullmatch(r'tt\d+',mid) and m.get('type')=='movie' and m.get('poster') and re.fullmatch(r'tt\d+|tmdb:\d+',mid) and not re.search(r'OTT\s*Releases|Hindi\s*Dubbed|promo|unlock',str(m.get('name','')),re.I)
def select_featured(state):
 state=Path(state);state.mkdir(parents=True,exist_ok=True)
 pages_file=state/'catalog-pages.json';pages=json.loads(pages_file.read_text()) if pages_file.exists() else {}
 now=datetime.now(timezone.utc).isoformat();languages={}
 # Fail atomically on source errors. Never substitute an unrelated date service or feed.
 for lang,cat in LANGS.items():
  url=f'{SOURCE}/catalog/movie/{cat}.json';data=get(url);metas=data.get('metas',[])
  chosen=next((m for m in metas if valid(m,lang)),None)
  if not chosen:raise RuntimeError(lang+': no valid catalog head; last-good selection retained')
  pages[url]={'checked_at':now,'metas':metas}
  languages[lang]={'id':str(chosen['id']).split('||',1)[0],'name':chosen['name'],'poster':chosen['poster'],'catalog':cat,'type':'movie','catalog_source':url,'selection':'catalog-order','catalogRank':0,'eligibility':'IMDb-linked movie','verifiedAt':now}
  print('FEATURED',lang,chosen['name'],'catalog head',flush=True)
 result={'version':2,'checkedAt':now,'selection':'first IMDb-linked movie in the matching IndianRegional catalog order; no external release-date filtering','languages':languages,'warnings':[]}
 pages_file.write_text(json.dumps(pages));(state/'featured-movies.json').write_text(json.dumps(result,indent=2))
 return result
if __name__=='__main__':
 import sys
 print(json.dumps(select_featured(Path(sys.argv[1] if len(sys.argv)>1 else 'state')),indent=2))
