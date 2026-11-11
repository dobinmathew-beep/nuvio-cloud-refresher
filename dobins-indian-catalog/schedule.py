"""Cheap UTC/Muscat schedule gate, without third-party dependencies."""
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
from pathlib import Path
import json,os
ZONE=ZoneInfo('Asia/Muscat')
def due(now):
 local=now.astimezone(ZONE)
 return local.replace(hour=(local.hour//2)*2,minute=0,second=0,microsecond=0).isoformat()

if __name__=='__main__':
 p=Path(__file__).resolve().parent/'data/status.json'
 try:s=json.loads(p.read_text())
 except Exception:s={}
 wanted=due(datetime.now(ZONE));force=os.environ.get('GITHUB_EVENT_NAME') in ('push','workflow_dispatch')
 pending=force or s.get('lastSuccessCycle')!=wanted or bool(s.get('errors'))
 print('pending='+('true' if pending else 'false'));print('cycle='+wanted)
