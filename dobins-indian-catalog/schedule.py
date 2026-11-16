"""Cheap UTC/Muscat schedule gate, without third-party dependencies."""
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
import json, os

ZONE = ZoneInfo('Asia/Muscat')
RETRY_SOURCE_STATES = {'failed', 'partial', 'cached'}

def due(now):
    local = now.astimezone(ZONE)
    return local.replace(hour=(local.hour // 2) * 2, minute=0, second=0, microsecond=0).isoformat()

def needs_retry(status, health=None):
    if status.get('errors'):
        return True
    if any(item.get('state') in RETRY_SOURCE_STATES for item in status.get('sources', [])):
        return True
    # Keep working through unresolved title identities between normal two-hour
    # refreshes. This prevents a large pending backlog waiting an entire cycle.
    try:
        pending = int(status.get('pendingMatches', 0) or 0)
        last_retry = datetime.fromisoformat(status.get('lastMatchRetryAt') or status.get('updatedAt'))
        if pending and (datetime.now(ZONE) - last_retry.astimezone(ZONE)).total_seconds() >= 1800:
            return True
    except (TypeError, ValueError):
        if int(status.get('pendingMatches', 0) or 0):
            return True
    if health:
        summary = health.get('catalogSummary', {})
        if health.get('state') != 'ok' or summary.get('failed', 0) or summary.get('countMismatches', 0):
            return True
    return False

if __name__ == '__main__':
    data_dir = Path(__file__).resolve().parent / 'data'
    try:
        status = json.loads((data_dir / 'status.json').read_text())
    except Exception:
        status = {}
    try:
        health = json.loads((data_dir / 'catalog-health.json').read_text())
    except Exception:
        health = None
    wanted = due(datetime.now(ZONE))
    force = os.environ.get('GITHUB_EVENT_NAME') in ('push', 'workflow_dispatch')
    pending = force or status.get('lastSuccessCycle') != wanted or needs_retry(status, health)
    print('pending=' + ('true' if pending else 'false'))
    print('cycle=' + wanted)
