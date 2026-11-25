"""Check two-hour refresh cycles and retry overdue workflows every 30 minutes."""
import base64, json, os, sys, urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ZONE = ZoneInfo('Asia/Muscat')
REPO = 'dobinmathew-beep/nuvio-cloud-refresher'
API = 'https://api.github.com/repos/'+REPO

def due(now, kind):
    # A cycle begins only at its actual two-hour boundary. Advancing early lets a
    # delayed runner dispatch work before the new cycle starts, so its timestamps
    # are inevitably stamped against the previous cycle.
    local=now.astimezone(ZONE)
    return local.replace(hour=(local.hour//2)*2,minute=0,second=0,microsecond=0)

def fresh(state, kind, target):
    if kind=='media':
        ids=state.get('featured_ids',{})
        current_ids=state.get('current_featured_ids',{})
        try: featured_checked=datetime.fromisoformat(state.get('current_featured_checked_at',''))
        except (TypeError,ValueError): return False
        valid_ids=(isinstance(ids,dict) and set(ids)=={'hindi','tamil','malayalam','telugu'}
            and all((str(v).startswith('tt') and str(v)[2:].isdigit()) or (str(v).startswith('tmdb:') and str(v)[5:].isdigit()) for v in ids.values())
            and isinstance(current_ids,dict) and set(current_ids)==set(ids) and current_ids==ids and featured_checked>=target)
        return (state.get('refresh_cycle',state.get('cycle','')+'T06:00:00+04:00')==target.isoformat() and bool(state.get('backdrops'))
            and bool(state.get('heroes')) and state.get('featuredVersion')==2
            and state.get('featured_cycle')==target.isoformat() and valid_ids
            and state.get('heroes',{}).get('opening_version')==1
            and state.get('heroes',{}).get('selection_policy')=='catalog-order-v3')
    field='lastSuccessCycle' if kind=='addon' else 'checked_utc'
    try: checked=datetime.fromisoformat(state.get(field,''))
    except (TypeError,ValueError): return False
    return checked>=target and (not state.get('errors') if kind=='addon' else bool(state.get('matched_ids')))

def may_dispatch(runs, now, target=None):
    if any(r['status'] in ('queued','in_progress','waiting','pending','requested') for r in runs): return False
    # A successful run created before this cycle's boundary could only have
    # processed the previous cycle. If the published state is still stale after
    # the boundary, allow an immediate catch-up instead of a 30-minute cooldown.
    if runs and target is not None:
        latest=runs[0]
        if latest.get('status')=='completed' and latest.get('conclusion')=='success':
            try: started=datetime.fromisoformat(latest['created_at'].replace('Z','+00:00'))
            except (TypeError,ValueError,KeyError): started=None
            if started is not None and started<target:return True
    return not runs or now-datetime.fromisoformat(runs[0]['created_at'].replace('Z','+00:00'))>=timedelta(minutes=30)

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
    now=datetime.now(ZONE);results=[];errors=[];warnings=[];states={};run_cache={};log_errors=[]
    def media_state():
        state=repository_json('state/success.json')
        featured=repository_json('state/featured-movies.json')
        languages=featured.get('languages',{}) if isinstance(featured,dict) else {}
        state['current_featured_ids']={lang:item.get('id') for lang,item in languages.items() if isinstance(item,dict)}
        state['current_featured_checked_at']=featured.get('checkedAt') if isinstance(featured,dict) else None
        return state
    sources=[('media','refresh.yml',media_state),
        ('addon','dobins-indian-catalog.yml',lambda:repository_json('dobins-indian-catalog/data/status.json','dobins-catalog')),
        ('epg','india-epg.yml',lambda:request('https://dobin-india-epg-feed.quickfield138.chatgpt.site/status.json'))]
    for kind,workflow,read in sources:
        target=due(now,kind);row={'component':kind,'due':target.isoformat()}
        try:
            state=read();states[kind]=state
            if fresh(state,kind,target): row['state']='fresh'
            else:
                runs=request(API+'/actions/workflows/'+workflow+'/runs?per_page=100')['workflow_runs'];run_cache[kind]=runs
                if may_dispatch(runs,now,target):
                    request(API+'/actions/workflows/'+workflow+'/dispatches','POST',{'ref':'main'})
                    # Refresh the run list after dispatch so the dashboard links to
                    # the newly queued retry, not the older completed attempt.
                    run_cache[kind]=request(API+'/actions/workflows/'+workflow+'/runs?per_page=10')['workflow_runs']
                    row['state']='catch-up-dispatched'
                elif any(r['status']!='completed' for r in runs): row['state']='refresh-in-progress'
                else:
                    row['state']='stale-retry-cooldown'
                    warnings.append(kind+': overdue; recent attempt has not produced a valid current cycle')
        except Exception as e:
            row['state']='check-failed';row['error']=type(e).__name__+': '+str(e);errors.append(kind+': '+row['error'])
        results.append(row)
    # Audit lookups must never prevent the refresh/retry decisions above.
    for kind,workflow,_ in sources:
        if kind not in run_cache:
            try:run_cache[kind]=request(API+'/actions/workflows/'+workflow+'/runs?per_page=100')['workflow_runs']
            except Exception as e:log_errors.append(kind+': latest run lookup failed: '+type(e).__name__)
    report={'checked_at':now.isoformat(),'results':results,'errors':errors,'warnings':warnings}
    try:
        from update_dashboard import write_report
        write_report(report,states,run_cache,log_errors)
    except Exception as e:
        errors.append('Dashboard update failed: '+type(e).__name__+': '+str(e))

    print(json.dumps(report,indent=2),flush=True)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'],'a') as f:
            f.write('Refresh watchdog\n\n| Component | Due (Muscat) | State |\n|---|---|---|\n')
            for r in results:f.write(f"| {r['component']} | {r['due']} | {r['state']} |\n")
    # Persist the exact check timestamp alongside the dashboard and daily history.
    p=Path('state/watchdog.json')
    p.parent.mkdir(exist_ok=True);p.write_text(json.dumps(report,indent=2))
    return bool(errors)

if __name__=='__main__':sys.exit(main())
