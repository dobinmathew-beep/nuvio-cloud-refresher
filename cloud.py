"""Deterministic cloud refresh: no AI APIs, no paid services, no personal computer."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import hashlib, json, mimetypes, os, shutil, subprocess, sys, tarfile, time, urllib.request, urllib.error, urllib.parse

ROOT=Path(__file__).resolve().parent
ORIGIN='https://dobin-nuvio-star-cards.quickfield138.chatgpt.site'
REPO=os.environ.get('GITHUB_REPOSITORY','dobinmathew-beep/nuvio-cloud-refresher')
API='https://api.github.com/repos/'+REPO
TOKEN=os.environ.get('GH_TOKEN','')
STATE=ROOT/'state';STATE.mkdir(exist_ok=True)
WORK=ROOT/'work';WORK.mkdir(exist_ok=True)
LANGS={'hindi':'hi','tamil':'ta','malayalam':'ml','telugu':'te'}

def sha(b):return hashlib.sha256(b).hexdigest()
def api(path,method='GET',payload=None,raw=None,mime='application/json'):
    data=raw if raw is not None else (json.dumps(payload).encode() if payload is not None else None)
    req=urllib.request.Request(path if path.startswith('https:') else API+path,data=data,method=method,
        headers={'Authorization':'Bearer '+TOKEN,'Accept':'application/vnd.github+json','Content-Type':mime,'User-Agent':'nuvio-cloud-refresher','X-GitHub-Api-Version':'2022-11-28'})
    with urllib.request.urlopen(req,timeout=240) as res:
        body=res.read();return json.loads(body) if body else None

def get(url):
    p=subprocess.run(['curl','-fsSL','--retry','1','--connect-timeout','15','--max-time','180',url],capture_output=True)
    if p.returncode:raise RuntimeError('Download failed: '+url+' '+p.stderr.decode()[-150:])
    return p.stdout

def release(tag):
    try:return api('/releases/tags/'+tag)
    except urllib.error.HTTPError as e:
        if e.code!=404:raise
    return api('/releases','POST',{'tag_name':tag,'name':'Nuvio generated website artifacts','body':'Generated media and rendering assets for this personal website. No AI is used.','draft':False,'prerelease':False})

def upload(rel,name,path,known):
    raw=path.read_bytes();digest=sha(raw)
    if name in known:
        return known[name]['browser_download_url']
    url=rel['upload_url'].split('{')[0]+'?name='+urllib.parse.quote(name)
    result=api(url,'POST',raw=raw,mime=mimetypes.guess_type(path.name)[0] or 'application/octet-stream')
    known[name]=result
    return result['browser_download_url']

def entries(rel):
    assets=[];page=1
    while True:
        batch=api('/releases/'+str(rel['id'])+'/assets?per_page=100&page='+str(page));assets.extend(batch)
        if len(batch)<100:break
        page+=1
    return {a['name']:a for a in assets}

def atomic(path,obj):
    path.parent.mkdir(parents=True,exist_ok=True);tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(obj,indent=2));tmp.replace(path)

def mime(path):
    return 'video/mp4' if path.endswith('.mp4') else 'application/json' if path.endswith('.json') else 'text/html; charset=utf-8' if path.endswith('.html') else mimetypes.guess_type(path)[0] or 'application/octet-stream'

def bootstrap():
    marker=STATE/'bootstrap.json'
    if marker.exists():return
    spec=json.loads((ROOT/'source-archive.json').read_text());archive=WORK/'renderer-source.tar.gz'
    rel=release('renderer-source');known=entries(rel)
    source_name='renderer-'+spec['sha256'][:20]+'.tar.gz'
    if source_name in known:
        data=get(known[source_name]['browser_download_url'])
    else:
        chunks=[get(ORIGIN+p['path']) for p in spec['parts']]
        for b,p in zip(chunks,spec['parts']):assert len(b)==p['bytes'] and sha(b)==p['sha256'],'Setup part mismatch'
        data=b''.join(chunks)
    assert sha(data)==spec['sha256'];archive.write_bytes(data)
    source_url=upload(rel,source_name,archive,known)
    static=release('legacy-site');known=entries(static)
    expected=json.loads((ROOT/'legacy-files.json').read_text());manifest={}
    html_seed=json.loads((ROOT/'legacy-html.json').read_text())
    def download(pair):
        path,m=pair;b=html_seed[path].encode() if path in html_seed else get(ORIGIN+path)
        assert len(b)==m['bytes'] and sha(b)==m['sha256'],path+' baseline changed'
        p=WORK/'legacy'/path.lstrip('/');p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
        return path,m,p
    with ThreadPoolExecutor(max_workers=4) as pool:
        for path,m,p in pool.map(download,expected.items()):
            name=m['sha256'][:24]+'-'+p.name
            url=upload(static,name,p,known)
            manifest[path]={**m,'url':url,'mime':mime(path)}
    atomic(STATE/'media.json',manifest)
    atomic(marker,{'source_url':source_url,'source_sha256':spec['sha256'],'created_at':datetime.now(ZoneInfo('Asia/Muscat')).isoformat()})
    print('Bootstrap verified:',len(manifest),'preserved URLs',flush=True)

def backdrop():
    p=subprocess.run([sys.executable,'-u',str(ROOT/'verify_backdrops.py')],capture_output=True,text=True)
    print(p.stdout,flush=True)
    lines=[x[8:] for x in p.stdout.splitlines() if x.startswith('SUMMARY ')]
    if p.returncode or not lines:raise RuntimeError('Backdrop verification did not finish: '+p.stderr[-300:])
    result=json.loads(lines[-1]);assert result['statuses']==160 and result['images']==16 and not result['errors'],str(result.get('errors'))
    return result

def featured_movies():
    from featured import select_featured
    result=select_featured(STATE)
    # Publish the verified centre choices before asking the backdrop service to render.
    subprocess.run(['git','config','user.name','Nuvio refresh'],cwd=ROOT,check=True)
    subprocess.run(['git','config','user.email','nuvio-refresh@users.noreply.github.com'],cwd=ROOT,check=True)
    subprocess.run(['git','add','state/featured-movies.json','state/release-dates.json','state/catalog-pages.json'],cwd=ROOT,check=True)
    if subprocess.run(['git','diff','--cached','--quiet'],cwd=ROOT).returncode:
        subprocess.run(['git','commit','-m','Update confirmed released centre movies'],cwd=ROOT,check=True)
        subprocess.run(['git','push'],cwd=ROOT,check=True)
    # Allow the HTTP service to observe the new pointer before full verification.
    def probe(lang):
        try:
            d=json.loads(get('https://dobin-nuvio-live-backdrops.quickfield138.chatgpt.site/status/'+lang+'/movies/gallery.json?check=1'))
            return d.get('centerMovie',{}).get('id')==result['languages'][lang]['id'] and d.get('renderVersion')=='released-centre-v1'
        except Exception:return False
    for attempt in range(9):
        with ThreadPoolExecutor(max_workers=4) as pool:ready=all(pool.map(probe,LANGS))
        if ready:break
        if attempt==8:raise RuntimeError('New confirmed centre selections are not yet visible; retained last-good images')
        time.sleep(10)
    return result

def heroes():
    boot=json.loads((STATE/'bootstrap.json').read_text());data=get(boot['source_url']);assert sha(data)==boot['source_sha256']
    archive=WORK/'source.tar.gz';archive.write_bytes(data);render=WORK/'render';render.mkdir(exist_ok=True)
    with tarfile.open(archive) as tf:tf.extractall(render,filter='data')
    manifest=json.loads((STATE/'media.json').read_text());dist=render/'dist';(dist/'hero').mkdir(parents=True,exist_ok=True)
    # Restore the last published validated media so unchanged renders and source outages retain it.
    needed=['/hero/index.html','/hero/daily-manifest.json','/hero/music-credits.json']
    for lang in LANGS:needed += ['/hero/'+lang+x for x in ('.mp4','-daily.jpg','-daily.json')]
    def restore(path):
        m=manifest[path];b=get(m['url']);assert sha(b)==m['sha256'];p=dist/path.lstrip('/');p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
    with ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(restore,needed))
    # Use the saved selection, renderer, audio envelopes and finalizer unchanged.
    # Historical Hosanna comparison URLs remain fixed legacy artifacts.
    for command in [['source/hero/daily/prepare.py'],*[['source/hero/daily/render.py',lang] for lang in LANGS],['source/hero/daily/finalize.py']]:
        p=subprocess.run([sys.executable,*command],cwd=render,env={**os.environ,'OPENBLAS_NUM_THREADS':'1'})
        if p.returncode:raise RuntimeError('Hero updater failed; last-good public manifest retained')
    pinned=json.loads((render/'source/hero/credits.json').read_text());music=json.loads((render/'source/hero/daily/music.json').read_text())
    day=datetime.now(ZoneInfo('Asia/Muscat')).date().isoformat()
    for lang,cat in LANGS.items():
        m=json.loads((dist/'hero'/(lang+'-daily.json')).read_text());b=(dist/'hero'/(lang+'.mp4')).read_bytes()
        assert m['catalog']==cat and m['pinned_count']==8 and m['recent_count']==12 and len(m['movies'])==20
        assert {x['id'] for x in pinned if x['language']==lang}<={x['id'] for x in m['movies']}
        assert m['audio']==music[lang] and m['duration_seconds']==50 and m['checked_at'].startswith(day)
        assert len(b)==m['bytes'] and sha(b)==m['sha256']
    rel=release('live-heroes');known=entries(rel);updated=dict(manifest)
    for path in needed:
        p=dist/path.lstrip('/');raw=p.read_bytes();digest=sha(raw);name=digest[:24]+'-'+p.name
        url=upload(rel,name,p,known)
        # Verify remote bytes before moving any public pointer.
        assert sha(get(url))==digest,'Published asset hash mismatch '+path
        updated[path]={'url':url,'sha256':digest,'bytes':len(raw),'mime':mime(path)}
    atomic(STATE/'media.json',updated)
    # Keep media bounded: current assets and the previous generation; never delete legacy URLs.
    keep={x['url'].rsplit('/',1)[-1] for x in [*manifest.values(),*updated.values()]}
    for name,a in known.items():
        if name not in keep:api('/releases/assets/'+str(a['id']),'DELETE')
    return {'languages':list(LANGS),'checked_at':datetime.now(ZoneInfo('Asia/Muscat')).isoformat(),'films_per_language':20}

def main():
    now=datetime.now(ZoneInfo('Asia/Muscat'));cycle=(now-timedelta(hours=6)).date().isoformat()
    progress_path=STATE/'success.json';progress=json.loads(progress_path.read_text()) if progress_path.exists() else {}
    if progress.get('cycle')!=cycle:progress={'cycle':cycle}
    if progress.get('backdrops') and progress.get('heroes') and progress.get('featuredVersion')==1:
        print('Current 06:00 Muscat cycle already verified; nothing to refresh.');return 0
    bootstrap();failed=[]
    if progress.get('featuredVersion')!=1:
        try:
            featured_movies();progress['featuredVersion']=1;progress.pop('backdrops',None)
        except Exception as e:
            atomic(STATE/'last-run.json',{'attempted_at':now.isoformat(),'cycle':cycle,'errors':['Centre release-date selection: '+str(e)]})
            print('FAILED centre release-date verification; retained last-good backdrops:',str(e),flush=True)
            return 1
    for key,fn in [('backdrops',backdrop),('heroes',heroes)]:
        if progress.get(key):continue
        try:progress[key]=fn();print(key,'verified',flush=True)
        except Exception as e:failed.append(key+': '+str(e));print('FAILED',failed[-1],flush=True)
        atomic(progress_path,progress)
    atomic(STATE/'last-run.json',{'attempted_at':now.isoformat(),'cycle':cycle,'errors':failed})
    return 1 if failed else 0

if __name__=='__main__':
    try:sys.exit(main())
    except Exception as e:print('Refresh incomplete; last-good media retained:',str(e),flush=True);sys.exit(1)
