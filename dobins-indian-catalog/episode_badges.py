"""Released-episode timestamps only; never infer new episodes from metadata updates."""
from datetime import datetime,timezone,timedelta
WINDOW_DAYS=7
def latest(videos,now):
 dates=[]
 for episode in videos or []:
  value=episode.get('released') or episode.get('airdate')
  if not value:continue
  try:
   dt=datetime.fromisoformat(str(value).replace('Z','+00:00'))
   if dt.tzinfo is None:dt=dt.replace(tzinfo=timezone.utc)
   if dt<=now:dates.append(dt)
  except (ValueError,TypeError):continue
 if not dates:return None,False
 date=max(dates);return date.isoformat(),now-date<=timedelta(days=WINDOW_DAYS)
