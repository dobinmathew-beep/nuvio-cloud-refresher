"""Deterministic cloud refresh: no AI APIs, no paid services, no personal computer."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from refresh_watchdog import due
import re, hashlib, json, html, mimetypes, os, shutil, subprocess, sys, tarfile, time, urllib.request, urllib.error, urllib.parse

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
    # GitHub Releases occasionally returns transient 502/503/504 responses for
    # large renderer archives and media assets. Retry those responses with
    # curl's exponential backoff; keep each attempt bounded and never accept
    # an HTTP error page as a successful asset download.
    p=subprocess.run([
        'curl','--fail','--silent','--show-error','--location',
        '--retry','6','--retry-max-time','600','--retry-connrefused',
        '--connect-timeout','30','--max-time','300',url
    ],capture_output=True)
    if p.returncode:
        detail=p.stderr.decode(errors='replace')[-500:].strip()
        raise RuntimeError('Download failed after retry policy: '+url+' '+detail)
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

def push_state():
    # A watchdog or another workflow can advance main between checkout and push.
    # Rebase disjoint changes; never force-push or overwrite a conflict.
    for attempt in range(3):
        try:
            subprocess.run(['git','pull','--rebase','origin','main'],cwd=ROOT,check=True)
        except subprocess.CalledProcessError:
            subprocess.run(['git','rebase','--abort'],cwd=ROOT)
            raise RuntimeError('State conflict; rebase aborted and last-good remote files retained')
        if subprocess.run(['git','push','origin','HEAD:main'],cwd=ROOT).returncode==0:return
        time.sleep(5)
    raise RuntimeError('State push failed after three attempts; no force-push used')

def featured_movies():
    from featured import select_featured
    result=select_featured(STATE)
    # Publish the verified centre choices before asking the backdrop service to render.
    subprocess.run(['git','config','user.name','Nuvio refresh'],cwd=ROOT,check=True)
    subprocess.run(['git','config','user.email','nuvio-refresh@users.noreply.github.com'],cwd=ROOT,check=True)
    subprocess.run(['git','add','state/featured-movies.json','state/release-dates.json','state/catalog-pages.json'],cwd=ROOT,check=True)
    if subprocess.run(['git','diff','--cached','--quiet'],cwd=ROOT).returncode:
        subprocess.run(['git','commit','-m','Update IndianRegional catalog-head centre movies'],cwd=ROOT,check=True)
        push_state()
    # Allow the HTTP service to observe the new pointer before full verification.
    def probe(lang):
        try:
            d=json.loads(get('https://dobin-nuvio-live-backdrops.quickfield138.chatgpt.site/status/'+lang+'/movies/gallery.json?check=1'))
            return d.get('centerMovie',{}).get('id')==result['languages'][lang]['id'] and d.get('renderVersion')=='catalog-head-v2'
        except Exception:return False
    for attempt in range(30):
        with ThreadPoolExecutor(max_workers=4) as pool:ready=all(pool.map(probe,LANGS))
        if ready:break
        if attempt==29:raise RuntimeError('New confirmed centre selections are not yet visible; retained last-good images')
        time.sleep(10)
    return result

def build_hero_index(dist):
    """Regenerate the public gallery from the same verified daily metadata as the MP4s."""
    cards=[]
    for lang in LANGS:
        meta=json.loads((dist/'hero'/(lang+'-daily.json')).read_text())
        movies=meta.get('films',[])
        recent=[m for m in movies if not m.get('pinned')]
        originals=[m for m in movies if m.get('pinned')]
        names=' · '.join(html.escape(str(m.get('name','Untitled'))) for m in movies)
        checked=html.escape(str(meta.get('checked_at','Not recorded')))
        audio=html.escape(str(meta.get('audio','User-supplied soundtrack')))
        digest=str(meta.get('sha256') or sha((dist/'hero'/(lang+'.mp4')).read_bytes()))[:16]
        video=f'/hero/{lang}.mp4?v={digest}'
        poster=f'/hero/{lang}-daily.jpg?v={digest}'
        title=lang.capitalize()
        cards.append(f"""<article><video controls playsinline preload="metadata" poster="{poster}" src="{video}"></video><div><h2>{title}</h2><p>{len(recent)} current catalog films + {len(originals)} retained originals</p><p class="films">{names}</p><p class="song">♫ {audio}</p><a href="{video}" target="_blank">Open MP4 ↗</a><small>1280 × 720 · H.264/AAC · 30 fps · 50 seconds<br>Catalog checked: {checked}</small></div></article>""")
    page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate"><title>Nuvio · Colour Celluloid</title><style>*{box-sizing:border-box}body{background:#0b0c10;color:#eee;font:15px system-ui;margin:0}main{max-width:1200px;padding:40px 24px;margin:auto}h1{font-size:42px;letter-spacing:-2px;margin:8px 0}.eyebrow{color:#e5bf89;letter-spacing:3px;font-size:11px}p{color:#a3adbc;line-height:1.7}.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:32px}article{background:#131720;border:1px solid #2b3240;border-radius:14px;overflow:hidden}video{width:100%;aspect-ratio:16/9;display:block;background:#000}article>div{padding:22px}h2{margin:0}.films{font-size:12px}.song{font-size:13px}a{color:#b8c8dd;font-size:13px}small{display:block;margin-top:14px;color:#8b9bb0;line-height:1.6}@media(max-width:650px){.grid{grid-template-columns:1fr}h1{font-size:34px}}</style><main><div class="eyebrow">YOUR CINEMA, IN MOTION</div><h1>Cinema, refreshed.</h1><p>This gallery is rebuilt from the latest verified daily reel metadata whenever the refresher publishes. Each language card shows the current catalog selection and the matching MP4.</p><p>Four languages · 20 films per reel · 1280 × 720 · 16:9 · H.264 + AAC · 30 fps · 50 seconds.</p><section class="grid">''' + ''.join(cards) + '''</section><p>Film posters and music remain the work of their respective owners. <a href="music-credits.json">Music credits</a> · <a href="credits.json">Poster sources</a></p></main></html>'''
    target=dist/'hero'/'index.html'
    target.write_text(page)
    print('Hero gallery regenerated from current daily metadata:',len(cards),'languages',flush=True)

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
    # Use the versioned catalog-order selector; preserve renderer and audio envelopes.
    shutil.copy2(ROOT/'hero_prepare.py',render/'source/hero/daily/prepare.py')
    shutil.copy2(ROOT/'hero_render.py',render/'source/hero/daily/render.py')
    # Historical Hosanna comparison URLs remain fixed legacy artifacts.
    for command in [['source/hero/daily/prepare.py'],*[['source/hero/daily/render.py',lang] for lang in LANGS],['source/hero/daily/finalize.py']]:
        p=subprocess.run([sys.executable,*command],cwd=render,env={**os.environ,'OPENBLAS_NUM_THREADS':'1'})
        if p.returncode:raise RuntimeError('Hero updater failed; last-good public manifest retained')
    build_hero_index(dist)
    pinned=json.loads((render/'source/hero/credits.json').read_text());music=json.loads((render/'source/hero/daily/music.json').read_text())
    day=datetime.now(ZoneInfo('Asia/Muscat')).date().isoformat()
    for lang,cat in LANGS.items():
        m=json.loads((dist/'hero'/(lang+'-daily.json')).read_text());b=(dist/'hero'/(lang+'.mp4')).read_bytes()
        assert m.get('opening_version')==1 and m.get('opening_movie_id')==m['movies'][0]['id'] and m.get('opening_selection')=='catalog-order'
        assert m.get('selection_policy')=='imdb-catalog-order-v1' and all(re.fullmatch(r'tt\d+',x['id']) for x in m['movies'] if not x.get('pinned'))
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
    # Keep prior release assets until the workflow has committed state/media.json.
    # Pruning here is unsafe: a later git rebase/push failure would leave the
    # committed manifest pointing at assets that this run has already deleted.
    # A separate post-commit cleanup can be added once it is transaction-safe.
    return {'languages':list(LANGS),'checked_at':datetime.now(ZoneInfo('Asia/Muscat')).isoformat(),'films_per_language':20,'opening_version':1,'selection_policy':'imdb-catalog-order-v1'}

def main():
    now=datetime.now(ZoneInfo('Asia/Muscat'));target=due(now,'media');cycle=target.date().isoformat();refresh_cycle=target.isoformat()
    progress_path=STATE/'success.json';progress=json.loads(progress_path.read_text()) if progress_path.exists() else {}
    if progress.get('refresh_cycle',progress.get('cycle','')+'T06:00:00+04:00')!=refresh_cycle:progress={'cycle':cycle,'refresh_cycle':refresh_cycle}
    if progress.get('heroes',{}).get('opening_version')!=1 or progress.get('heroes',{}).get('selection_policy')!='imdb-catalog-order-v1':progress.pop('heroes',None)
    if (progress.get('backdrops') and progress.get('heroes') and progress.get('featuredVersion')==2
        and progress.get('featured_cycle')==refresh_cycle and set(progress.get('featured_ids',{}))==set(LANGS)):
        print('Current Muscat refresh cycle already verified; nothing to refresh.');return 0
    bootstrap();failed=[]
    # Refresh the live IndianRegional catalog head once per two-hour cycle.
    # Persist the IDs with the successful outputs so a retry does not repeatedly
    # query the source, and invalidate both media outputs if the head changed.
    if progress.get('featured_cycle')!=refresh_cycle or progress.get('featuredVersion')!=2:
        try:
            selected=featured_movies()
            selected_ids={lang:str(item.get('id','')) for lang,item in selected.get('languages',{}).items()}
            if set(selected_ids)!=set(LANGS) or not all(re.fullmatch(r'tt\d+',value) for value in selected_ids.values()):
                raise RuntimeError('Current IndianRegional head selection did not verify all four IMDb movie IDs')
            if selected_ids!=progress.get('featured_ids'):
                progress.pop('backdrops',None);progress.pop('heroes',None)
            progress['featuredVersion']=2
            progress['featured_cycle']=refresh_cycle
            progress['featured_ids']=selected_ids
        except Exception as e:
            atomic(STATE/'last-run.json',{'attempted_at':now.isoformat(),'cycle':cycle,'errors':['Current IndianRegional catalog-head selection: '+str(e)]})
            print('FAILED current catalog-head verification; retained last-good backdrops:',str(e),flush=True)
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


