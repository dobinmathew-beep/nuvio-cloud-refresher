"""Validate the complete XMLTV and audit reports before and after publication."""
import csv, gzip, io, json, re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

FILES = ['India_EPG.xml.gz', 'Channel_Matching_Report.csv', 'Unresolved_Channels.csv',
         'Source_Crosscheck_Report.csv', 'Validation_Summary.json', 'Source_Health_Report.json']
ROOT = Path(__file__).resolve().parent
PLACEHOLDER = re.compile(r'^(no (data|info|information|programme information|program information|epg)( available)?|information (not |un)available|program(me)? (information |info )?not available|to be announced|tba|no program(me)?s? available)$', re.I)

def validate(files, playlist_ids):
    summary = json.loads(files['Validation_Summary.json'])
    checked = datetime.fromisoformat(summary['checked_utc'])
    now = datetime.now(timezone.utc)
    assert now - timedelta(hours=36) < checked < now + timedelta(minutes=10), 'Stale/future guide'
    root = ET.fromstring(gzip.decompress(files['India_EPG.xml.gz']))
    assert root.tag == 'tv'
    channels, programmes = root.findall('channel'), root.findall('programme')
    ids = {c.get('id') for c in channels}
    assert len(channels) == len(ids) == summary['matched_ids'] > 0
    assert len(programmes) == summary['programmes'] > 0
    current, future, ends = set(), set(), {}
    for p in programmes:
        cid = p.get('channel')
        assert cid in ids, 'Undeclared programme channel'
        start = datetime.strptime(p.get('start'), '%Y%m%d%H%M%S %z')
        stop = datetime.strptime(p.get('stop'), '%Y%m%d%H%M%S %z')
        assert stop > start and stop > checked, 'Invalid/expired interval at build time'
        assert start <= checked + timedelta(days=8), 'Implausible future programme'
        assert cid not in ends or start >= ends[cid], 'Overlapping programme'
        ends[cid] = stop
        title = (p.findtext('title') or '').strip()
        assert title and not PLACEHOLDER.fullmatch(title), 'Placeholder title'
        if stop > now: future.add(cid)
        if start <= checked < stop: current.add(cid)
    assert future == ids, 'Channel has no remaining usable schedule'
    rows = list(csv.DictReader(io.StringIO(files['Channel_Matching_Report.csv'].decode('utf-8-sig'))))
    unresolved = list(csv.DictReader(io.StringIO(files['Unresolved_Channels.csv'].decode('utf-8-sig'))))
    missing = {r['playlist_id'] for r in unresolved}
    assert len(unresolved) == len(missing) == summary['unresolved_ids']
    assert not ids & missing and ids | missing == playlist_ids
    assert len(rows) == len(playlist_ids) == summary['playlist_channel_ids']
    assert {r['playlist_id'] for r in rows} == playlist_ids
    assert {r['playlist_id'] for r in rows if int(r['programmes'])} == ids
    assert sum(int(r['programmes']) for r in rows) == len(programmes)
    cross = list(csv.DictReader(io.StringIO(files['Source_Crosscheck_Report.csv'].decode('utf-8-sig'))))
    evidence = {(r['playlist_id'], r['source'], r['source_id']) for r in cross}
    for r in rows:
        if int(r['programmes']):
            assert (r['playlist_id'], r['selected_source'], r['source_channel_id']) in evidence
    json.loads(files['Source_Health_Report.json'])
    assert len(current) == summary['channels_with_current_programme']
    return summary

def local():
    playlist = (ROOT/'inputs/playlist.m3u').read_text()
    ids = set(re.findall(r'tvg-id="([^"]+)"', playlist))
    files = {name: (ROOT/'output'/name).read_bytes() for name in FILES}
    return files, ids, validate(files, ids)

if __name__ == '__main__':
    _, _, s = local()
    print(json.dumps({k:s[k] for k in ['checked_utc','matched_ids','playlist_channel_ids','unresolved_ids','programmes']}))
