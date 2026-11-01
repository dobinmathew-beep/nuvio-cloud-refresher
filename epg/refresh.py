"""Fetch current sources and rebuild the EPG. No hosting changes, no credentials."""
import concurrent.futures,gzip,json,subprocess,sys,urllib.request,time
from pathlib import Path
ROOT=Path(__file__).resolve().parent
DATA=ROOT/'inputs';DATA.mkdir(exist_ok=True)
SOURCES={
 'playlist.m3u':'https://iptv-org.github.io/iptv/countries/in.m3u',
 'channels.json':'https://iptv-org.github.io/api/channels.json',
 'guide.xml':'https://iptv-epg.org/files/epg-in.xml',
 'pw.xml':'https://epg.pw/xmltv/epg_IN.xml.gz',
 'free-epg.xml':'https://www.free-epg.de/api/epg/in.xml.gz',
 'open-india.xml':'https://www.open-epg.com/files/india.xml.gz',
 'tvepg-jio.xml':'https://raw.githubusercontent.com/mitthu786/tvepg/main/jiotv/epg.xml.gz',
 'samsung-in.xml':'https://i.mjh.nz/SamsungTVPlus/in.xml.gz',
 'ca.xml':'https://iptv-epg.org/files/epg-ca.xml.gz',
}
for name in ['airtel','dishtv','jiotv','sundirectgo','yupptv','zee5']:
 SOURCES[name+'.xml']='https://raw.githubusercontent.com/jasonramg/iptv-epg/main/epg/'+name+'.xml.gz'
for name in ['dishtv.in','tataplay.com','jiotv.com','zee5.com']:
 SOURCES[name+'.channels.xml']='https://raw.githubusercontent.com/iptv-org/epg/master/sites/'+name+'/'+name+'.channels.xml'

def get(item):
 name,url=item
 for attempt in range(2):
  try:
   req=urllib.request.Request(url,headers={'User-Agent':'IndiaEPGRefresh/1.0'})
   with urllib.request.urlopen(req,timeout=45) as r:data=r.read(100000000)
   if url.endswith('.gz'):data=gzip.decompress(data)
   if name.endswith('.xml'):
    import xml.etree.ElementTree as E
    E.fromstring(data)
   elif name.endswith('.json'):json.loads(data)
   temp=DATA/(name+'.tmp');temp.write_bytes(data);temp.replace(DATA/name)
   print('Fetched',name,len(data),flush=True);return name,True
  except Exception as ex:
   if attempt==1:print('Unavailable',name,type(ex).__name__,flush=True);return name,False

if __name__=='__main__':
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:results=dict(pool.map(get,SOURCES.items()))
 if not results.get('playlist.m3u') or not results.get('channels.json'):
  raise SystemExit('Required current playlist/database unavailable. Existing hosted EPG retained.')
 # Remove failed optional fresh inputs so expired local copies never imply a successful fetch.
 for name,ok in results.items():
  if not ok:(DATA/name).unlink(missing_ok=True)
 (DATA/'source_urls.json').write_text(json.dumps(SOURCES,indent=2))
 (DATA/'fetch_status.json').write_text(json.dumps(results,indent=2))
 if not any(ok and name.endswith('.xml') and not name.endswith('.channels.xml') for name,ok in results.items()):
  raise SystemExit('No schedule sources available. Existing hosted EPG retained.')
 subprocess.run([sys.executable,str(ROOT/'build_expanded.py')],cwd=ROOT,check=True)
 print('Refresh ready in',ROOT/'output',flush=True)
