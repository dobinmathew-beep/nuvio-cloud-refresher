"""Publish from this repository's trusted Actions workflow using GitHub OIDC."""
import base64, concurrent.futures, json, os, time, urllib.parse, urllib.request
from validate import local, validate, FILES, ROOT

BASE = 'https://dobin-india-epg-feed.quickfield138.chatgpt.site'
UA = 'Mozilla/5.0 (compatible; IndiaEPGUpdater/2.0)'

def get(path):
    req = urllib.request.Request(BASE+'/'+path+'?verify='+str(time.time_ns()), headers={'User-Agent':UA, 'Cache-Control':'no-cache'})
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read()

def identity():
    url = os.environ['ACTIONS_ID_TOKEN_REQUEST_URL']
    url += ('&' if '?' in url else '?') + urllib.parse.urlencode({'audience':BASE})
    req = urllib.request.Request(url, headers={'Authorization':'Bearer '+os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN']})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)['value']

def publish():
    files, ids, summary = local()
    old = json.loads(get('status.json'))
    assert summary['matched_ids'] >= old.get('matched_ids',0)*0.8, 'Coverage fell over 20%; last valid revision retained'
    payload = {'summary':summary, 'files':{n:base64.b64encode(b).decode() for n,b in files.items()}}
    req = urllib.request.Request(BASE+'/api/epg-update', data=json.dumps(payload).encode(), method='POST',
        headers={'Content-Type':'application/json','User-Agent':UA,'X-EPG-GitHub-Token':identity()})
    with urllib.request.urlopen(req, timeout=180) as r:
        result = json.load(r)
    assert result.get('ok') and result.get('updated_by') == 'github-actions'
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        public = dict(zip(FILES, pool.map(get, FILES)))
    status = json.loads(get('status.json'))
    assert status['revision'] == result['revision'], 'Public revision mismatch'
    for k in ['checked_utc','matched_ids','playlist_channel_ids','unresolved_ids','programmes']:
        assert status[k] == summary[k], k
    for name in FILES:
        assert public[name] == files[name], 'Public file mismatch: '+name
    validate(public, ids)
    req = urllib.request.Request('https://da.gd/mr8mVT', headers={'User-Agent':UA})
    with urllib.request.urlopen(req, timeout=90) as r:
        assert r.geturl() == BASE+'/India_EPG.xml.gz', 'Short link destination changed'
    (ROOT/'output/Published_Status.json').write_text(json.dumps(status,indent=2))
    print(json.dumps({'verified':True, **status}), flush=True)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'],'a') as f:
            f.write(f"Updated and verified [India EPG](https://da.gd/mr8mVT): **{summary['matched_ids']} / {summary['playlist_channel_ids']}** channel IDs; **{summary['unresolved_ids']} unresolved**; {summary['programmes']:,} programmes.\n\nSupplier schedules only; unresolved channels are never filled with guesses.\n")

if __name__ == '__main__':
    publish()
