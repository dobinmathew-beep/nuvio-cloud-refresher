"""Restore/migrate the published seed atomically; never replace newer matching-policy data."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import subprocess,json,re,tempfile
ROOT=Path(__file__).resolve().parent;D=ROOT/'data';D.mkdir(exist_ok=True)
FILES=['catalogs.json','metadata.json','status.json','matches.json','candidates.json','sources.json','unmatched.json']
POLICY='tmdb-tvmaze-v1'
try:status=json.loads((D/'status.json').read_text())
except Exception:status={}
if not (D/'catalogs.json').exists() or status.get('metadataPolicy')!=POLICY:
 with tempfile.TemporaryDirectory() as staging:
  stage=Path(staging)
  def one(name):
   b=subprocess.check_output(['curl','-fsSL','--retry','1','--connect-timeout','15','--max-time','120','https://dobins-indian-catalog.quickfield138.chatgpt.site/bootstrap/'+name]);obj=json.loads(b);(stage/name).write_bytes(b);return name,obj
  with ThreadPoolExecutor(max_workers=4) as p:objects=dict(p.map(one,FILES))
  catalogs=objects['catalogs.json'];metadata=objects['metadata.json'];assert len(catalogs)==8 and all(catalogs.values())
  assert objects['status.json'].get('metadataPolicy')==POLICY,'Published migration snapshot is not ready; keep last-good data'
  for ms in catalogs.values():
   for m in ms:
    assert re.fullmatch(r'(?:tt\d+|(?:tmdb|tvmaze):\d+)',m['id']) and m['type'] in ('movie','series')
    key=m['id'] if m['id'].startswith('tt') else m['type']+'|'+m['id'];assert key in metadata
  # Validation completes before any committed snapshot is touched.
  for n in FILES:
   temp=D/(n+'.tmp');temp.write_bytes((stage/n).read_bytes());temp.replace(D/n)
 print('Published policy snapshot verified; all eight catalogs restored.')
