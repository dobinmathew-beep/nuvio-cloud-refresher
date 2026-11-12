from zoneinfo import ZoneInfo

ZONE = ZoneInfo('Asia/Muscat')

def service_day_is_current(day, started_at, finished_at):
    """Accept either side of a request that straddles Oman midnight."""
    allowed = {
        started_at.astimezone(ZONE).date().isoformat(),
        finished_at.astimezone(ZONE).date().isoformat(),
    }
    return day in allowed
