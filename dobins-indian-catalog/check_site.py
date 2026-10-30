"""Read-only site/checkout health probes. Never create or charge payment orders."""
from pathlib import Path
from datetime import datetime,timezone
from urllib.parse import urlparse
import os,json,subprocess
D=Path(__file__).resolve().parent/'data';D.mkdir(exist_ok=True)
base=os.environ.get('GRETA_PUBLIC_URL','https://the-great-indian-addon.vercel.app').rstrip('/')
if not base:
 print('Site health pending: GRETA_PUBLIC_URL has not been configured.');raise SystemExit(0)
u=urlparse(base)
if u.scheme!='https' or not u.netloc or u.username or u.password:raise SystemExit('GRETA_PUBLIC_URL must be a public HTTPS origin')
checks=[]
for route in ['/manifest.json','/support','/health.json']:
 try:
  b=subprocess.check_output(['curl','-fsSL','--retry','1','--connect-timeout','10','--max-time','35',base+route])
  if route.endswith('.json'):
   obj=json.loads(b)
   if route=='/manifest.json':assert obj.get('name')=='The Great Indian Addon' and len(obj.get('catalogs',[]))==8
   if route=='/health.json':
    assert isinstance(obj.get('checkout',{}).get('ready'),bool)
    if obj.get('checkout',{}).get('configured'):assert obj['checkout']['ready']
  elif route=='/support':assert b'The Great Indian Addon' in b and b'No recurring charge' in b
  checks.append({'path':route,'state':'ok'})
 except Exception:checks.append({'path':route,'state':'failed'})
result={'checkedAt':datetime.now(timezone.utc).isoformat(),'url':base,'state':'ok' if all(x['state']=='ok' for x in checks) else 'failed','checks':checks,'method':'read-only; no payment orders or charges'}
p=D/'payment-health.json';t=p.with_suffix('.tmp');t.write_text(json.dumps(result,indent=2));t.replace(p);print(json.dumps(result))
if result['state']=='failed':raise SystemExit(1)

