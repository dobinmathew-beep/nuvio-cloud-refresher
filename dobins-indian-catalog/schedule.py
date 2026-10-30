"""Cheap UTC/Muscat schedule gate, without third-party dependencies."""
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
from pathlib import Path
import json,os
ZONE=ZoneInfo('Asia/Muscat')
def due(now):
 dates=[]
 for delta in range(3):
  d=now.date()-timedelta(days=delta)
  for h in ([1,6,18] if d.weekday() in (3,4,5) else [6,18]):
   t=datetime.combine(d,datetime.min.time(),ZONE)+timedelta(hours=h)
   if t<=now:dates.append(t)
 return max(dates).isoformat()
if __name__=='__main__':
 p=Path(__file__).resolve().parent/'data/status.json'
 try:s=json.loads(p.read_text())
 except Exception:s={}
 wanted=due(datetime.now(ZONE));force=os.environ.get('GITHUB_EVENT_NAME') in ('push','workflow_dispatch')
 pending=force or s.get('lastSuccessCycle')!=wanted or bool(s.get('errors'))
 print('pending='+('true' if pending else 'false'));print('cycle='+wanted)
