"""Read-only site and per-catalog freshness probes."""
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlparse
import os, json, subprocess

D = Path(__file__).resolve().parent / 'data'
D.mkdir(exist_ok=True)
base = os.environ.get('GRETA_PUBLIC_URL', 'https://the-great-indian-addon.vercel.app').rstrip('/')
if not base:
    print('Site health pending: GRETA_PUBLIC_URL has not been configured.')
    raise SystemExit(0)
u = urlparse(base)
if u.scheme != 'https' or not u.netloc or u.username or u.password:
    raise SystemExit('GRETA_PUBLIC_URL must be a public HTTPS origin')

def fetch_json(url):
    raw = subprocess.check_output([
        'curl', '-fsSL', '--retry', '1', '--connect-timeout', '10',
        '--max-time', '35', url
    ])
    return json.loads(raw)

def latest_entry(rows):
    dated = [x for x in rows if isinstance(x, dict) and
             (x.get('releaseDate') or x.get('ottDate') or x.get('latestEpisodeReleasedAt'))]
    if not dated:
        return None
    item = max(dated, key=lambda x: str(x.get('latestEpisodeReleasedAt') or x.get('releaseDate') or x.get('ottDate') or ''))
    return {
        'id': item.get('id'),
        'name': item.get('name'),
        'releaseDate': item.get('latestEpisodeReleasedAt') or item.get('releaseDate') or item.get('ottDate')
    }

try:
    local = json.loads((D / 'catalogs.json').read_text())
except Exception:
    local = {}

catalogs = []
for lang in ('ml', 'ta', 'te', 'hi'):
    for typ in ('movie', 'series'):
        cid = f'dobins_{lang}_{typ}'
        route = f'/install/ff/catalog/{typ}/{cid}.json'
        expected = len(local.get(cid, []))
        result = {
            'catalogId': cid, 'language': lang, 'type': typ,
            'path': route, 'localPublishedCount': expected
        }
        try:
            payload = fetch_json(base + route)
            metas = payload.get('metas') if isinstance(payload, dict) else None
            if not isinstance(metas, list) or not metas:
                raise ValueError('Endpoint returned no metas')
            result['endpointReturnedCount'] = len(metas)
            result['endpointLatestEntry'] = latest_entry(metas)
            result['localLatestEntry'] = latest_entry(local.get(cid, []))
            if expected and len(metas) < expected:
                result['state'] = 'possible_truncation_or_deployment_lag'
                result['missingFromResponse'] = expected - len(metas)
                result['exactly50Returned'] = len(metas) == 50
            elif expected and len(metas) > expected:
                result['state'] = 'endpoint_ahead_of_local_snapshot'
            else:
                result['state'] = 'ok'
            result['check'] = 'ok'
        except Exception as error:
            result.update(state='failed', check='failed', error=str(error)[:240])
        catalogs.append(result)

checks = []
for route in ['/manifest.json', '/support', '/health.json']:
    try:
        body = subprocess.check_output([
            'curl', '-fsSL', '--retry', '1', '--connect-timeout', '10',
            '--max-time', '35', base + route
        ])
        if route.endswith('.json'):
            obj = json.loads(body)
            if route == '/manifest.json':
                assert obj.get('name') == 'The Great Indian Addon' and len(obj.get('catalogs', [])) == 8
            if route == '/health.json':
                assert isinstance(obj.get('checkout', {}).get('ready'), bool)
                if obj.get('checkout', {}).get('configured'):
                    assert obj['checkout']['ready']
        elif route == '/support':
            assert b'The Great Indian Addon' in body and b'No recurring charge' in body
        checks.append({'path': route, 'state': 'ok'})
    except Exception as error:
        checks.append({'path': route, 'state': 'failed', 'error': str(error)[:180]})

catalog_failures = sum(1 for x in catalogs if x.get('check') != 'ok')
result = {
    'checkedAt': datetime.now(timezone.utc).isoformat(),
    'url': base,
    'state': 'ok' if all(x['state'] == 'ok' for x in checks) and catalog_failures == 0 else 'degraded',
    'checks': checks,
    'catalogs': catalogs,
    'catalogSummary': {
        'checked': len(catalogs),
        'failed': catalog_failures,
        'possibleTruncationOrLag': sum(1 for x in catalogs if x.get('state') == 'possible_truncation_or_deployment_lag'),
        'exactly50Returned': [x['catalogId'] for x in catalogs if x.get('exactly50Returned')]
    },
    'method': 'read-only; no payment orders or charges'
}
p = D / 'catalog-health.json'
t = p.with_suffix('.tmp')
t.write_text(json.dumps(result, indent=2))
t.replace(p)
print(json.dumps(result))
if any(x['state'] == 'failed' for x in checks) or catalog_failures:
    raise SystemExit(1)
