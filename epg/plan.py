"""Skip extra schedule ticks once today's verified EPG has been published."""
import json, os, sys, urllib.request
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from datetime import datetime
from zoneinfo import ZoneInfo
from refresh_watchdog import due, fresh

if __name__=='__main__':
    now=datetime.now(ZoneInfo('Asia/Muscat'))
    try:
        req=urllib.request.Request('https://dobin-india-epg-feed.quickfield138.chatgpt.site/status.json',headers={'User-Agent':'Mozilla/5.0 (compatible; IndiaEPGUpdater/2.0)','Cache-Control':'no-cache'})
        with urllib.request.urlopen(req,timeout=30) as r:state=json.load(r)
        done=fresh(state,'epg',due(now,'epg'))
    except Exception:done=False
    forced=os.environ.get('GITHUB_EVENT_NAME') in ('push','workflow_dispatch')
    print('pending='+('false' if done and not forced else 'true'))
