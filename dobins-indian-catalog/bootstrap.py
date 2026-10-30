"""Restore the published initial dataset only for a new checkout without data."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import subprocess,json
ROOT=Path(__file__).resolve().parent;D=ROOT/'data';D.mkdir(exist_ok=True)
FILES=['catalogs.json','metadata.json','status.json','matches.json','candidates.json','sources.json','unmatched.json']
if not (D/'catalogs.json').exists():
 def one(name):
  b=subprocess.check_output(['curl','-fsSL','--retry','1','--connect-timeout','15','--max-time','120','https://dobins-indian-catalog.quickfield138.chatgpt.site/bootstrap/'+name]);obj=json.loads(b)
  if name=='catalogs.json':
   assert len(obj)==8 and all(obj.values())
   assert all(m['id'].startswith('tt') and m['type'] in ('movie','series') for ms in obj.values() for m in ms)
  p=D/name;t=p.with_suffix('.tmp');t.write_bytes(b);t.replace(p)
 with ThreadPoolExecutor(max_workers=4) as p:list(p.map(one,FILES))
 print('Published bootstrap verified; all eight catalogs restored.')
