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

def upcoming(videos,now,season_dates=None):
 """Nearest explicitly dated future episode or season, excluding TBA/year-only dates."""
 dates=[]
 for item in list(videos or [])+list(season_dates or []):
  value=item.get('released') or item.get('airdate') or item.get('premiereDate')
  if not value or len(str(value))<10:continue
  try:
   dt=datetime.fromisoformat(str(value).replace('Z','+00:00'))
   if dt.tzinfo is None:dt=dt.replace(tzinfo=timezone.utc)
   if dt>now:dates.append(dt)
  except (ValueError,TypeError):continue
 return min(dates).isoformat() if dates else None
