"""Render a plain GitHub status page and permanent daily check records. No secrets."""
import json, os, re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ZONE=ZoneInfo('Asia/Muscat')
REPO='https://github.com/dobinmathew-beep/nuvio-cloud-refresher'
WORKFLOWS={'media':'refresh.yml','addon':'dobins-indian-catalog.yml','epg':'india-epg.yml'}
LABELS={'fresh':'✅ Updated','refresh-in-progress':'🔄 Refresh running / queued',
 'catch-up-dispatched':'🔄 Retry requested','stale-retry-cooldown':'⚠️ Waiting for retry',
 'check-failed':'❌ Could not verify'}

def clean(value):
    text=str(value).replace('\n',' ').replace('\r',' ')
    text=re.sub(r'(?i)Bearer\s+\S+','Bearer [redacted]',text)
    text=re.sub(r'github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9_]+','[redacted]',text)
    return text[:1500]

def safe(value):
    return clean(value).replace('|',' / ').replace('<','&lt;').replace('>','&gt;').replace('[','\\[').replace(']','\\]')

def when(value):
    try:return datetime.fromisoformat(value.replace('Z','+00:00')).astimezone(ZONE).strftime('%d %b %Y, %H:%M')
    except (TypeError,ValueError,AttributeError):return 'Not recorded'

def summaries(states):
    media=states.get('media',{}); addon=states.get('addon',{}); epg=states.get('epg',{})
    # Only these public audit fields enter repository logs. Never serialize headers or credentials.
    allow={
     'media':('refresh_cycle','cycle','featuredVersion','backdrops','heroes'),
     'addon':('updatedAt','lastSuccessCycle','counts','pendingMatches','checkedCandidates','sources','errors'),
     'epg':('checked_utc','matched_ids','unresolved_ids','playlist_channel_ids','programmes','sources_with_parsed_guides','selected_source_counts','unresolved_reason_counts','channels_with_full_next24h','unmatched_ids','errors')}
    result={}
    for kind,data in [('media',media),('addon',addon),('epg',epg)]:
        result[kind]={k:data[k] for k in allow[kind] if k in data}
    # Exclude upstream URLs and arbitrary fields in nested source reports.
    result['addon']['sources']=[{k:s[k] for k in ('source','language','state','records','error') if k in s} for s in addon.get('sources',[])]
    return result

def redact(value):
    if isinstance(value,str):return clean(value)
    if isinstance(value,list):return [redact(x) for x in value]
    if isinstance(value,dict):return {k:redact(v) for k,v in value.items()}
    return value

def run_summary(run):
    return {k:run.get(k) for k in ('id','status','conclusion','event','created_at','updated_at','run_number')}

def run_link(run):
    ident=run.get('id')
    return f'[Open run and full logs]({REPO}/actions/runs/{int(ident)})' if isinstance(ident,int) else 'No run recorded'

def rows_for(entry):
    states=entry['details']; output=[]
    for row in entry['results']:
        kind=row['component'];data=states.get(kind,{})
        for name in (['Backdrops','Reels'] if kind=='media' else ['Addon'] if kind=='addon' else ['EPG']):
            status=LABELS.get(row['state'],row['state'])
            if kind=='media':
                key='backdrops' if name=='Backdrops' else 'heroes'
                complete=bool(data.get(key))
                cycle=data.get('refresh_cycle') or (data.get('cycle','')+'T06:00:00+04:00' if data.get('cycle') else '')
                verified=when(cycle) if complete else 'Not recorded'
                if key=='backdrops':
                    detail=f"{data.get(key,{}).get('statuses','?')} layouts; {data.get(key,{}).get('images','?')} image checks"
                else:
                    detail=f"{len(data.get(key,{}).get('languages',[]))} languages; {data.get(key,{}).get('films_per_language','?')} films per reel"
                if row['state']!='fresh' and complete:detail+='; this part verified, combined media cycle still pending'
            elif kind=='addon':
                verified=when(data.get('lastSuccessCycle'))
                detail=f"{sum(v for v in data.get('counts',{}).values() if isinstance(v,int))} catalog entries; {data.get('pendingMatches','?')} pending matches"
            else:
                verified=when(data.get('checked_utc'))
                matched=data.get('matched_ids','?');unmatched=data.get('unresolved_ids',data.get('unmatched_ids','not reported'))
                if isinstance(unmatched,(list,dict)):unmatched=len(unmatched)
                detail=f"{matched} / {data.get('playlist_channel_ids','?')} channel IDs with listings; {unmatched} unresolved; {data.get('programmes','?')} programmes."
            run=entry.get('runs',{}).get(kind,{})
            latest=safe(run.get('conclusion') or run.get('status') or 'unknown')+' · '+run_link(run)
            output.append((name,status,verified,detail,latest))
    return output

def render_day(entries):
    lines=['# Daily refresh log — '+entries[-1]['checked_at'][:10],
     '', '[← Current status](../../DAILY_UPDATES.md) · [All dates](../README.md)',
     '', 'All times are Asia/Muscat (Oman). Records begin when this dashboard was installed; earlier checks are available in GitHub Actions.',
     '', '| Check time | Backdrops + reels | Addon | EPG | Check run |', '|---|---|---|---|---|']
    for e in reversed(entries):
        status={r['component']:LABELS.get(r['state'],r['state']) for r in e['results']}
        link=run_link({'id':e.get('watchdog_run_id')})
        lines.append('| '+' | '.join([when(e['checked_at']),status.get('media','Unknown'),status.get('addon','Unknown'),status.get('epg','Unknown'),link])+' |')
    lines+=['','## Details for each check','']
    for e in reversed(entries):
        lines+=['### '+when(e['checked_at']), '', f"Trigger: {safe(e.get('trigger','unknown'))}. Due cycle: {when(e['results'][0].get('due')) if e['results'] else 'unknown'}.", '', '| Output | Result | Last verified cycle / check | Details | Logs |','|---|---|---|---|---|']
        lines+=['| '+' | '.join([safe(n),s,v,safe(d),link])+' |' for n,s,v,d,link in rows_for(e)]
        for error in e.get('errors',[])+e.get('log_errors',[]):lines+=['', '**Issue:** '+safe(error)]
        for kind,run in e.get('runs',{}).items():
            lines+=['', f"{kind.capitalize()} attempt: **{safe(run.get('conclusion') or run.get('status') or 'unknown')}**; started {when(run.get('created_at'))}. {run_link(run)}."]
    return '\n'.join(lines)+'\n'

def write_report(report,states,runs,log_errors=None,root=Path('.')):
    root=Path(root); stamp=report['checked_at']; day=stamp[:10]
    entry={**report,'details':summaries(states),'runs':{k:run_summary(v[0]) for k,v in runs.items() if v},
      'watchdog_run_id':int(os.environ.get('GITHUB_RUN_ID','0')) or None,
      'trigger':os.environ.get('GITHUB_EVENT_NAME','local'), 'log_errors':log_errors or []}
    # Sanitize errors before persistent storage, too.
    entry['errors']=[clean(x) for x in entry.get('errors',[])]
    entry['log_errors']=[clean(x) for x in entry['log_errors']]
    entry=redact(entry)
    folder=root/'logs'/day;folder.mkdir(parents=True,exist_ok=True)
    path=folder/'checks.jsonl'
    entries=[json.loads(l) for l in path.read_text().splitlines() if l] if path.exists() else []
    key=(entry.get('watchdog_run_id'),stamp)
    entries=[e for e in entries if (e.get('watchdog_run_id'),e['checked_at'])!=key]+[entry]
    entries.sort(key=lambda e:e['checked_at'])
    path.write_text(''.join(json.dumps(e,ensure_ascii=False,separators=(',',':'))+'\n' for e in entries))
    (folder/'README.md').write_text(render_day(entries))
    days=sorted((root/'logs').glob('????-??-??/README.md'),reverse=True)
    (root/'logs'/'README.md').write_text('# Daily refresh history\n\n[← Current status](../DAILY_UPDATES.md)\n\n'+ '\n'.join(f'- [{p.parent.name}]({p.parent.name}/README.md) · [Machine-readable records]({p.parent.name}/checks.jsonl)' for p in days)+'\n')
    lines=['# Daily updates','', '**Backdrops · Reels · Addon · India EPG**', '',
      f"Last checked: **{when(stamp)} Oman time**. [This check’s logs]({REPO}/actions/runs/{entry['watchdog_run_id']})" if entry['watchdog_run_id'] else f'Last checked: **{when(stamp)} Oman time**.',
      '', '**Refresh checks:** every 30 minutes. Outputs refresh when their two-hour cycle is due. **Watchdog and retry checks:** every 30 minutes; no per-workflow or external 10-minute trigger.',
      '', '> This is the last saved check, not a live clock. If it is more than 45 minutes old, open Actions to investigate. GitHub and network delays remain possible.',
      '', '| Output | Status at last check | Last verified cycle / check (Oman) | Details | Latest attempt |','|---|---|---|---|---|']
    lines+=['| '+' | '.join([safe(n),s,v,safe(d),link])+' |' for n,s,v,d,link in rows_for(entry)]
    lines+=['', '✅ Updated = verified for the current two-hour cycle. 🔄 Running / retry requested = work is pending. ⚠️ / ❌ = attention or retry needed. The two media outputs share one workflow and both must pass before the combined cycle is complete.',
      '', 'A successful check can keep the same movies or listings when the source has not changed. EPG unresolved channels remain explicit; schedules are never invented.',
      '', '## Today and past days', '', f'- [Today’s detailed timeline](logs/{day}/README.md)', '- [Daily history — all saved dates](logs/README.md)',
      f'- [All GitHub runs and full logs]({REPO}/actions)',
      '', '## Issues at this check','']
    issues=entry.get('errors',[])+entry.get('log_errors',[])
    lines+=['- '+safe(x) for x in issues] if issues else ['No watchdog errors reported. Source coverage and unresolved items are shown separately above.']
    lines+=['', '## Useful links','', '- [Backdrops](https://dobin-nuvio-live-backdrops.quickfield138.chatgpt.site)', '- [Reels](https://dobin-nuvio-star-cards.quickfield138.chatgpt.site)', '- [Addon](https://the-great-indian-addon.vercel.app)', '- [EPG download](https://da.gd/mr8mVT)',
      '', 'Daily records are kept in this repository from dashboard installation onward, with every completed watchdog check, its outcome, public verification details, latest workflow attempts and links to full logs. GitHub controls retention of full Actions logs. No token or authentication header is recorded.',
      '', '[Repository home](README.md)']
    (root/'DAILY_UPDATES.md').write_text('\n'.join(lines)+'\n')
