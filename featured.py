"""Select confirmed released titles ONLY from the matching IndianRegional movie catalog."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import json,re,subprocess,os

SOURCE='https://83e20802dcf1-indian-streams.baby-beamup.club'
LANGS={'hindi':'hi','tamil':'ta','malayalam':'ml','telugu':'te'}

def get(url):
    p=subprocess.run(['curl','-fsSL','--retry','1','--connect-timeout','10','--max-time','25',url],capture_output=True)
    if p.returncode:raise RuntimeError('Metadata/catalog download failed')
    return json.loads(p.stdout)

def release_day(value):
    text=str(value or '')
    if not re.match(r'^\d{4}-\d{2}-\d{2}',text):return None
    try:return datetime.fromisoformat(text[:10]).date().isoformat()
    except ValueError:return None

def select_featured(state):
    state=Path(state);state.mkdir(parents=True,exist_ok=True)
    cache_file=state/'release-dates.json';cache=json.loads(cache_file.read_text()) if cache_file.exists() else {}
    now=datetime.now(timezone.utc);today=now.astimezone(ZoneInfo('Asia/Muscat')).date().isoformat();candidates={}
    pages_file=state/'catalog-pages.json';pages=json.loads(pages_file.read_text()) if pages_file.exists() else {}
    # Catalog pages are the sole membership source. Metadata below never adds a movie.
    for lang,cat in LANGS.items():
        found={}
        for skip in (0,20,40):
            path=f'{SOURCE}/catalog/movie/{cat}'+(f'/skip={skip}' if skip else '')+'.json'
            try:
                if os.environ.get('FEATURED_OFFLINE_CATALOG'):
                    if path not in pages:
                        if skip:break
                        raise RuntimeError('No cached primary catalog')
                    data={'metas':pages[path]['metas']}
                else:data=get(path)
                metas=data.get('metas',[]) if isinstance(data,dict) else []
                pages[path]={'checked_at':now.isoformat(),'metas':metas};pages_file.write_text(json.dumps(pages))
            except Exception:
                if path in pages:metas=pages[path]['metas']
                elif skip:break
                else:raise
            before=len(found)
            for m in metas:
                mid=str(m.get('id','')).split('||',1)[0]
                if m.get('type')!='movie' or not m.get('poster') or not re.fullmatch(r'tt\d+|tmdb:\d+',mid):continue
                if re.search(r'OTT\s*Releases|Hindi\s*Dubbed|promo|unlock',str(m.get('name','')),re.I):continue
                found.setdefault(mid,{**m,'id':mid,'catalog':cat,'catalog_source':path})
            if len(found)==before:break
        if not found:raise RuntimeError(lang+': no approved movie entries')
        candidates[lang]=list(found.values())
        print('CATALOG',lang,len(found),'approved movie IDs',flush=True)

    by_id={m['id']:m for values in candidates.values() for m in values}
    def metadata(pair):
        mid,m=pair;existing=cache.get(mid);age=(now-datetime.fromisoformat(existing['checked_at'])).total_seconds() if existing else 1e20
        if existing and (existing.get('released') or existing.get('lookupSucceeded')) and age<(3600 if existing.get('released') else 21600):return mid,existing
        direct=release_day(m.get('released') or m.get('releaseDate') or m.get('release_date'))
        result={'released':direct,'source':m['catalog_source'] if direct else None,'checked_at':now.isoformat()}
        if not direct and mid.startswith('tt') and not os.environ.get('FEATURED_OFFLINE_METADATA'):
            url='https://v3-cinemeta.strem.io/meta/movie/'+mid+'.json'
            try:
                meta=get(url).get('meta',{});date=release_day(meta.get('released'))
                if str(meta.get('id',meta.get('imdb_id','')))==mid and meta.get('type')=='movie':
                    result.update(released=date,source=url,lookupSucceeded=True)
            except Exception:
                if existing:return mid,existing
        return mid,result
    with ThreadPoolExecutor(max_workers=4) as pool:
        for n,(mid,result) in enumerate(pool.map(metadata,by_id.items()),1):
            cache[mid]=result
            if n%10==0:
                cache_file.write_text(json.dumps(cache,indent=2));print('RELEASE METADATA',n,'/',len(by_id),flush=True)
    cache_file.write_text(json.dumps(cache,indent=2))
    previous_path=state/'featured-movies.json';previous=json.loads(previous_path.read_text()) if previous_path.exists() else {}
    featured={};problems=[]
    for lang,items in candidates.items():
        eligible=[m for m in items if cache.get(m['id'],{}).get('released') and cache[m['id']]['released']<=today]
        if not eligible:
            old=previous.get('languages',{}).get(lang)
            if old and old['id'] in {m['id'] for m in items}:featured[lang]=old
            problems.append(lang+': no verifiable released movie; retained last confirmed selection if available')
            continue
        chosen=max(eligible,key=lambda m:cache[m['id']]['released']);meta=cache[chosen['id']]
        featured[lang]={'id':chosen['id'],'name':chosen['name'],'poster':chosen['poster'],'catalog':chosen['catalog'],'type':'movie','released':meta['released'],'releaseDateSource':meta['source'],'catalog_source':chosen['catalog_source'],'verifiedAt':meta['checked_at']}
        print('FEATURED',lang,chosen['name'],meta['released'],flush=True)
    if len(featured)!=4 or problems:raise RuntimeError('; '.join(problems))
    result={'version':1,'checkedAt':now.isoformat(),'selection':'newest confirmed release date not after today among approved catalog pages; upcoming and undated entries excluded','languages':featured,'warnings':problems}
    previous_path.write_text(json.dumps(result,indent=2))
    return result

if __name__=='__main__':
    import sys
    print(json.dumps(select_featured(Path(sys.argv[1] if len(sys.argv)>1 else 'state')),indent=2),flush=True)
