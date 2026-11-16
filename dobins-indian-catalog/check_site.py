"""Read-only public catalog, snapshot provenance and Malayalam metadata audits."""
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlparse
from concurrent.futures import ThreadPoolExecutor
from difflib import SequenceMatcher
import os, json, subprocess, re, time

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
    item = max(dated, key=lambda x: str(x.get('latestEpisodeReleasedAt') or x.get('ottDate') or x.get('releaseDate') or ''))
    return {'id': item.get('id'), 'name': item.get('name'),
            'releaseDate': item.get('latestEpisodeReleasedAt') or item.get('ottDate') or item.get('releaseDate')}

def title_key(value):
    return re.sub(r'[^a-z0-9]+', '', str(value or '').lower().replace('&', 'and'))

try:
    local = json.loads((D / 'catalogs.json').read_text())
except Exception:
    local = {}
try:
    local_status = json.loads((D / 'status.json').read_text())
except Exception:
    local_status = {}

checks = []
data_health = {}
try:
    expected_counts = {key: len(rows) for key, rows in local.items() if isinstance(rows, list)}
    last_error = None
    for attempt in range(8):
        try:
            data_health = fetch_json(base + '/data-health.json')
            snapshots = data_health.get('snapshots', {})
            sources = {name: (snapshots.get(name) or {}).get('source') for name in
                       ('catalogs.json', 'status.json', 'metadata.json')}
            raw_ok = all(value == 'github_raw' for value in sources.values())
            status_ok = data_health.get('statusUpdatedAt') == local_status.get('updatedAt')
            counts_ok = data_health.get('catalogCounts') == expected_counts
            if raw_ok and status_ok and counts_ok:
                break
            last_error = 'Public service is still serving an older or fallback snapshot.'
        except Exception as error:
            last_error = str(error)[:180]
        if attempt < 7:
            time.sleep(10)
    state = 'ok' if raw_ok and status_ok and counts_ok else 'failed'
    checks.append({'path': '/data-health.json', 'state': state, 'snapshotSources': sources,
                   'statusTimestampMatches': status_ok, 'catalogCountsMatch': counts_ok,
                   'metadataRecords': data_health.get('metadataRecords'),
                   'error': None if state == 'ok' else last_error})
except Exception as error:
    checks.append({'path': '/data-health.json', 'state': 'failed', 'error': str(error)[:180]})

catalogs = []
for lang in ('ml', 'ta', 'te', 'hi'):
    for typ in ('movie', 'series'):
        cid = f'dobins_{lang}_{typ}'
        route = f'/install/ff/catalog/{typ}/{cid}.json'
        local_rows = local.get(cid, []) if isinstance(local.get(cid, []), list) else []
        local_ids = [str(x.get('id')) for x in local_rows if isinstance(x, dict) and x.get('id')]
        local_unique = set(local_ids)
        local_duplicates = sorted({x for x in local_ids if local_ids.count(x) > 1})
        local_invalid = len(local_rows) - len(local_ids)
        result = {
            'catalogId': cid, 'language': lang, 'type': typ, 'path': route,
            'localPublishedCount': len(local_rows), 'localUniqueIdCount': len(local_unique),
            'localDuplicateIdCount': len(local_duplicates), 'localInvalidIdCount': local_invalid,
            'localDuplicateIds': local_duplicates[:20]
        }
        try:
            all_metas, page_counts, seen_ids = [], [], set()
            endpoint_invalid = 0
            skip = 0
            for page_number in range(20):
                page_route = route if skip == 0 else route[:-5] + f'/skip={skip}.json'
                payload = fetch_json(base + page_route + ('&' if '?' in page_route else '?') + f'health_check={int(datetime.now(timezone.utc).timestamp())}-{page_number}')
                metas = payload.get('metas') if isinstance(payload, dict) else None
                if not isinstance(metas, list):
                    raise ValueError(f'Page {page_number + 1} did not return a metas array')
                page_counts.append(len(metas))
                for item in metas:
                    marker = item.get('id') if isinstance(item, dict) else None
                    if not marker:
                        endpoint_invalid += 1
                    elif marker not in seen_ids:
                        seen_ids.add(marker)
                        all_metas.append(item)
                if len(metas) < 50:
                    break
                skip += len(metas)
            else:
                raise ValueError('Pagination exceeded 20 pages; refusing an incomplete health result')
            if not all_metas:
                raise ValueError('Endpoint returned no metas')
            raw_count = sum(page_counts)
            endpoint_duplicates = raw_count - len(all_metas) - endpoint_invalid
            local_set = set(local_ids)
            missing_ids = sorted(local_set - seen_ids)
            extra_ids = sorted(seen_ids - local_set)
            result.update({
                'endpointRawCount': raw_count, 'endpointUniqueIdCount': len(all_metas),
                'endpointDuplicateIdCount': endpoint_duplicates,
                'endpointInvalidIdCount': endpoint_invalid, 'endpointPageCounts': page_counts,
                'endpointPageSize': 50, 'missingIds': missing_ids[:20], 'extraIds': extra_ids[:20],
                'endpointLatestEntry': latest_entry(all_metas), 'localLatestEntry': latest_entry(local_rows)
            })
            endpoint_latest = result['endpointLatestEntry']
            local_latest = result['localLatestEntry']
            latest_id_present = bool(local_latest and local_latest.get('id') in seen_ids)
            result['latestEntryMatches'] = (not local_rows) or bool(
                endpoint_latest and local_latest and latest_id_present and
                endpoint_latest.get('releaseDate') == local_latest.get('releaseDate')
            )
            if raw_count != len(local_rows):
                result['state'] = 'public_snapshot_count_mismatch'
            elif local_invalid or endpoint_invalid:
                result['state'] = 'invalid_catalog_ids'
            elif local_duplicates or endpoint_duplicates:
                result['state'] = 'duplicate_catalog_ids'
            elif missing_ids or extra_ids:
                result['state'] = 'catalog_id_set_mismatch'
            elif not result['latestEntryMatches']:
                result['state'] = 'latest_entry_mismatch'
            else:
                result['state'] = 'ok'
            result['check'] = 'ok'
        except Exception as error:
            result.update(state='failed', check='failed', error=str(error)[:240])
        catalogs.append(result)

malayalam_audit = {'state': 'skipped', 'checked': 0, 'passed': 0, 'failed': 0,
                   'missingOriginalLanguageField': 0, 'failures': []}
if os.environ.get('MALAYALAM_METADATA_AUDIT') == 'true':
    rows = [(typ, item) for typ in ('movie', 'series')
            for item in (local.get('dobins_ml_' + typ, []) or [])]
    def inspect_malayalam(pair):
        typ, item = pair
        mid = str(item.get('id') or '')
        if not (re.fullmatch(r'tt\d+', mid) or re.fullmatch(r'tmdb:\d+', mid)):
            return {'id': mid, 'name': item.get('name'), 'error': 'ID must be a verified IMDb tt-ID or TMDB ID'}
        try:
            payload = fetch_json(base + f'/meta/{typ}/{mid}.json?health_check={int(datetime.now(timezone.utc).timestamp())}')
            meta = payload.get('meta') if isinstance(payload, dict) else None
            if not isinstance(meta, dict):
                raise ValueError('Public metadata endpoint returned no metadata')
            if meta.get('id') != mid or meta.get('type') != typ:
                raise ValueError('Metadata ID/type does not match catalog entry')
            score = SequenceMatcher(None, title_key(item.get('name')), title_key(meta.get('name'))).ratio()
            if score < 0.80:
                raise ValueError(f'Metadata title mismatch ({score:.2f})')
            if not meta.get('poster'):
                raise ValueError('Metadata poster is missing')
            if not any(meta.get(key) for key in ('description', 'releaseInfo', 'genres', 'videos', 'seasons')):
                raise ValueError('Metadata details are missing')
            original = str(meta.get('original_language') or meta.get('originalLanguage') or '').lower()
            if original and original not in ('ml', 'malayalam'):
                raise ValueError(f'Original language mismatch: {original}')
            return {'id': mid, 'name': item.get('name'), 'ok': True,
                    'originalLanguage': original or None}
        except Exception as error:
            return {'id': mid, 'name': item.get('name'), 'error': str(error)[:180]}
    with ThreadPoolExecutor(max_workers=8) as pool:
        inspected = list(pool.map(inspect_malayalam, rows))
    failures = [x for x in inspected if not x.get('ok')]
    missing_language = sum(1 for x in inspected if x.get('ok') and not x.get('originalLanguage'))
    malayalam_audit = {
        'state': 'ok' if not failures else 'failed', 'checked': len(inspected),
        'passed': len(inspected) - len(failures), 'failed': len(failures),
        'missingOriginalLanguageField': missing_language, 'failures': failures[:30]
    }
    checks.append({'path': '/meta/* (Malayalam catalog audit)', 'state': malayalam_audit['state'],
                   'checked': malayalam_audit['checked'], 'passed': malayalam_audit['passed'],
                   'failed': malayalam_audit['failed'],
                   'missingOriginalLanguageField': missing_language})

for route in ['/manifest.json', '/support', '/health.json']:
    try:
        body = subprocess.check_output([
            'curl', '-fsSL', '--retry', '1', '--connect-timeout', '10',
            '--max-time', '35', base + route
        ])
        if route.endswith('.json'):
            obj = json.loads(body)
            if route == '/manifest.json':
                declared = obj.get('catalogs', [])
                assert obj.get('name') == 'The Great Indian Addon' and len(declared) == 8
                assert all(c.get('pageSize') == 50 and any(e.get('name') == 'skip' for e in c.get('extra', [])) for c in declared)
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
count_mismatches = sum(1 for x in catalogs if x.get('state') != 'ok')
result = {
    'checkedAt': datetime.now(timezone.utc).isoformat(), 'url': base,
    'state': 'ok' if all(x['state'] == 'ok' for x in checks) and catalog_failures == 0 and count_mismatches == 0 else 'degraded',
    'checks': checks, 'catalogs': catalogs, 'malayalamMetadataAudit': malayalam_audit,
    'catalogSummary': {
        'checked': len(catalogs), 'failed': catalog_failures,
        'possibleTruncationOrLag': sum(1 for x in catalogs if x.get('state') == 'public_snapshot_count_mismatch'),
        'countMismatches': count_mismatches,
        'firstPageSize50': [x['catalogId'] for x in catalogs if x.get('endpointPageCounts', [None])[0] == 50]
    },
    'method': 'read-only; compares raw and unique IDs and verifies Malayalam metadata without charging payments'
}
p = D / 'catalog-health.json'
t = p.with_suffix('.tmp')
t.write_text(json.dumps(result, indent=2))
t.replace(p)
print(json.dumps(result))
if any(x['state'] == 'failed' for x in checks) or catalog_failures or count_mismatches:
    raise SystemExit(1)
