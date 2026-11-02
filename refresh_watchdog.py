"""Check two-hour refresh cycles and retry overdue workflows; callable by any scheduler."""
import base64, json, os, sys, urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ZONE = ZoneInfo('Asia/Muscat')
REPO = 'dobinmathew-beep/nuvio-cloud-refresher'
API = 'https://api.github.com/repos/'+REPO

def due(now, kind):
    # Muscat is UTC+04:00: even local hours also align with even UTC hours.
    local=now.astimezone(ZONE)
    return local.replace(hour=(local.hour//2)*2,minute=0,second=0,microsecond=0)

def fresh(state, kind, target):
    if kind=='media':
        return (state.get('refresh_cycle',state.get('cycle','')+'T06:00:00+04:00')==target.isoformat() and bool(state.get('backdrops'))
            and bool(state.get('heroes')) and state.get('featuredVersion')==2
            and state.get('heroes',{}).get('opening_version')==1
            and state.get('heroes',{}).get('selection_policy')=='imdb-catalog-order-v1')
    field='lastSuccessCycle' if kind=='addon' else 'checked_utc'
    try: checked=datetime.fromisoformat(state.get(field,''))
    except (TypeError,ValueError): return False
    return checked>=target and (not state.get('errors') if kind=='addon' else bool(state.get('matched_ids')))

def may_dispatch(runs, now):
    if any(r['status'] in ('queued','in_progress','waiting','pending','requested') for r in runs): return False
    return not runs or now-datetime.fromisoformat(runs[0]['created_at'].replace('Z','+00:00'))>=timedelta(minutes=10)

def request(url, method='GET', body=None):
    headers={'User-Agent':'NuvioRefreshWatchdog/1.0','Accept':'application/vnd.github+json','Cache-Control':'no-cache'}
    if url.startswith(API+'/'): headers['Authorization']='Bearer '+os.environ['GH_TOKEN']
    raw=None if body is None else json.dumps(body).encode()
    if raw is not None: headers['Content-Type']='application/json'
    req=urllib.request.Request(url,data=raw,method=method,headers=headers)
    with urllib.request.urlopen(req,timeout=45) as r:
        b=r.read();return json.loads(b) if b else None

def repository_json(path, ref='main'):
    d=request(API+'/contents/'+path+'?ref='+ref)
    return json.loads(base64.b64decode(d['content']))

def main():
    now=datetime.now(ZONE);results=[];errors=[]
    sources=[('media','refresh.yml',lambda:repository_json('state/success.json')),
        ('addon','dobins-indian-catalog.yml',lambda:repository_json('dobins-indian-catalog/data/status.json','dobins-catalog')),
        ('epg','india-epg.yml',lambda:request('https://dobin-india-epg-feed.quickfield138.chatgpt.site/status.json'))]
    for kind,workflow,read in sources:
        target=due(now,kind);row={'component':kind,'due':target.isoformat()}
        try:
            state=read()
            if fresh(state,kind,target): row['state']='fresh'
            else:
                runs=request(API+'/actions/workflows/'+workflow+'/runs?per_page=10')['workflow_runs']
                if may_dispatch(runs,now):
                    request(API+'/actions/workflows/'+workflow+'/dispatches','POST',{'ref':'main'})
                    row['state']='catch-up-dispatched'
                elif any(r['status']!='completed' for r in runs): row['state']='refresh-in-progress'
                else:
                    row['state']='stale-retry-cooldown'
                    errors.append(kind+': overdue; recent attempt has not produced a valid current cycle')
        except Exception as e:
            row['state']='check-failed';row['error']=type(e).__name__+': '+str(e);errors.append(kind+': '+row['error'])
        results.append(row)
    report={'checked_at':now.isoformat(),'results':results,'errors':errors}
    print(json.dumps(report,indent=2),flush=True)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'],'a') as f:
            f.write('Refresh watchdog\n\n| Component | Due (Muscat) | State |\n|---|---|---|\n')
            for r in results:f.write(f"| {r['component']} | {r['due']} | {r['state']} |\n")
    # A daily health checkpoint is useful history and ordinary repository activity.
    p=Path('state/watchdog.json')
    previous=json.loads(p.read_text()) if p.exists() else {}
    if previous.get('checked_at','')[:10]!=now.date().isoformat() or previous.get('results')!=results or previous.get('errors')!=errors:
        p.parent.mkdir(exist_ok=True);p.write_text(json.dumps(report,indent=2))
    return bool(errors)

if __name__=='__main__':sys.exit(main())
