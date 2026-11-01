import collections,copy,csv,gzip,hashlib,json,re,sys
from pathlib import Path
from datetime import datetime,timedelta,timezone
import xml.etree.ElementTree as E
import analyse as a
BASE=a.BASE
OUT=Path(__file__).resolve().parent/'output'
OUT.mkdir(exist_ok=True)
URLS=json.loads((BASE/'source_urls.json').read_text())
URLS.update({'free-epg.xml':'https://www.free-epg.de/api/epg/in.xml.gz',
 'open-india.xml':'https://www.open-epg.com/files/india.xml.gz',
 'tvepg-jio.xml':'https://raw.githubusercontent.com/mitthu786/tvepg/main/jiotv/epg.xml.gz',
 'us-filtered.xml':'https://iptv-epg.org/files/epg-us.xml.gz'})
NOW=a.NOW
MUSCAT=timezone(timedelta(hours=4))
D=a.analyse()

def clean(ps):
 seen=set();out=[]; overlaps=0
 for st,en,p in sorted(ps,key=lambda x:(x[0],x[1])):
  key=(st,en,p.findtext('title',''))
  if key in seen:continue
  seen.add(key)
  if out and st<out[-1][1]:
   overlaps+=1;continue
  out.append((st,en,p))
 return out,overlaps

def coverage(ps):
 start=NOW;end=NOW+timedelta(hours=24)
 return sum(max(0,(min(en,end)-max(st,start)).total_seconds()) for st,en,p in ps)

epg=E.Element('tv',{'generator-info-name':'IPTV-org India mapped EPG; audited source schedules','date':NOW.strftime('%Y%m%d%H%M%S +0000')})
rows=[]; evidence=[];chosenstats=collections.Counter();dates=[];removed=0
for entry in a.ENTRIES:
 cid=entry['id']; choices=[];candidate_count=0
 for source,d in D.items():
  match=d['candidates'].get(cid)
  if not match:continue
  candidate_count+=1;sid,method=match
  ps,overlaps=clean(d['programmes'].get(sid,[]))
  if not ps:continue
  current=[p.findtext('title','') for st,en,p in ps if st<=NOW<en]
  # Require useful near-term coverage, favour coverage and horizon over an inflated row count.
  score=(bool(current),coverage(ps),max(en for st,en,p in ps),-overlaps,len(ps))
  choices.append((score,source,sid,method,ps,overlaps))
  evidence.append({'playlist_id':cid,'source':URLS.get(source,source),'source_id':sid,
                   'method':method,'future_programmes':len(ps),
                   'title_at_check_time':' | '.join(current),'coverage_next24h_minutes':round(coverage(ps)/60,1),
                   'last_stop':max(en for st,en,p in ps).astimezone(MUSCAT).isoformat(),
                   'overlapping_entries_excluded':overlaps})
 row={'playlist_id':cid,'name':entry['canonical'],'feed':entry['feed'],
      'status':'NO_CONFIDENT_IDENTITY_MATCH_IN_CHECKED_SOURCES' if not candidate_count else 'IDENTITY_FOUND_BUT_NO_USABLE_FUTURE_SCHEDULE',
      'identity_candidate_sources':candidate_count,'sources_with_future_schedules':len(choices),
      'selected_source':'','source_channel_id':'','matching_method':'','programmes':0,
      'current_programme':'','next24h_coverage_minutes':0,'schedule_start_muscat':'','schedule_end_muscat':'',
      'gaps_over15min':0,'overlaps_excluded':0}
 if choices:
  score,source,sid,method,ps,overlaps=max(choices,key=lambda x:x[0]);removed+=overlaps
  ch=E.SubElement(epg,'channel',id=cid);E.SubElement(ch,'display-name').text=entry['label']
  for st,en,p in ps:
   q=copy.deepcopy(p);q.set('channel',cid)
   q.set('start',st.astimezone(MUSCAT).strftime('%Y%m%d%H%M%S %z'))
   q.set('stop',en.astimezone(MUSCAT).strftime('%Y%m%d%H%M%S %z'))
   epg.append(q);dates.append((st,en))
  current=[p.findtext('title','') for st,en,p in ps if st<=NOW<en]
  row.update(status='MATCHED_FUTURE_SOURCE_SCHEDULE',selected_source=URLS.get(source,source),source_channel_id=sid,
             matching_method=method,programmes=len(ps),current_programme=' | '.join(current),
             next24h_coverage_minutes=round(coverage(ps)/60,1),
             schedule_start_muscat=min(st for st,en,p in ps).astimezone(MUSCAT).isoformat(),
             schedule_end_muscat=max(en for st,en,p in ps).astimezone(MUSCAT).isoformat(),
             gaps_over15min=sum((ps[i][0]-ps[i-1][1]).total_seconds()>900 for i in range(1,len(ps))),overlaps_excluded=overlaps)
  chosenstats[source]+=1
 rows.append(row)
ids={c.get('id') for c in epg.findall('channel')};expected={e['id'] for e in a.ENTRIES}
assert len(rows)==len(expected) and len(rows)>0
assert len(ids)==sum(bool(r['programmes']) for r in rows)
assert ids<=expected
assert all(p.get('channel') in ids for p in epg.findall('programme'))
assert all(a.parse_date(p.get('stop'))>a.parse_date(p.get('start')) for p in epg.findall('programme'))
assert all(a.parse_date(p.get('stop'))>NOW for p in epg.findall('programme'))
payload=E.tostring(epg,encoding='utf-8',xml_declaration=True)
E.fromstring(payload);gz=gzip.compress(payload);assert gzip.decompress(gz)==payload
(BASE/'India_EPG.xml').write_bytes(payload)
(OUT/'India_EPG.xml.gz').write_bytes(gz)
def csvwrite(name,data):
 with (OUT/name).open('w',newline='',encoding='utf-8-sig') as f:
  w=csv.DictWriter(f,fieldnames=list(data[0]));w.writeheader();w.writerows(data)
csvwrite('Channel_Matching_Report.csv',rows)
csvwrite('Source_Crosscheck_Report.csv',evidence)
csvwrite('Unresolved_Channels.csv',[r for r in rows if not r['programmes']])
summary={'checked_utc':NOW.isoformat(),'playlist_url':'https://iptv-org.github.io/iptv/countries/in.m3u',
 'playlist_sha256':hashlib.sha256((BASE/'playlist.m3u').read_bytes()).hexdigest(),
 'playlist_channel_ids':len(rows),'matched_ids':len(ids),'unresolved_ids':len(rows)-len(ids),
 'programmes':len(epg.findall('programme')),'sources_with_parsed_guides':len(D),
 'selected_source_counts':dict(chosenstats),'unresolved_reason_counts':dict(collections.Counter(r['status'] for r in rows if not r['programmes'])),
 'channels_with_current_programme':sum(bool(r['current_programme']) for r in rows),
 'channels_with_full_next24h':sum(r['next24h_coverage_minutes']>=1439 for r in rows),
 'earliest_programme_start':min(st for st,en in dates).isoformat(),'last_programme_stop':max(en for st,en in dates).isoformat(),
 'source_overlaps_removed':removed,'channels_with_source_gaps':sum(r['gaps_over15min']>0 for r in rows),
 'source_rejected_entries':{s:d['rejected'] for s,d in D.items()},
 'source_punctuation_reference_repairs':{s:d.get('repaired_references',[]) for s,d in D.items()},
 'blocked_or_missing_feeds':{'https://epgshare01.online/epgshare01/epg_ripper_IN1.xml.gz':'HTTP 403',
  'https://raw.githubusercontent.com/epgshare01/share01/master/epg_ripper_IN1.xml.gz':'HTTP 404',
  'https://jtbsclassic.dpdns.org/epg/':'HTTP 403'},
 'limitations':['Programme titles/times are supplier-derived, not verified against live broadcasts.',
 'Only confident identities with usable future programmes count as covered.',
 'Blank/No Data placeholders and expired programmes excluded.',
 'One source per channel selected; no inter-provider filling of time gaps.',
 'HD/regional/digital feeds remain separate unless registry or station-ID evidence supports a match.',
 'The hosted feed is refreshed daily by GitHub Actions; upstream coverage can vary.']}
(OUT/'Validation_Summary.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
print('FINAL_SUMMARY',json.dumps({k:v for k,v in summary.items() if k not in ['source_punctuation_reference_repairs','source_rejected_entries']},indent=2),flush=True)
(BASE/'final_rows.json').write_text(json.dumps(rows,indent=2),encoding='utf-8')

(OUT/'Source_Health_Report.json').write_text((BASE/'source_analysis.json').read_text(),encoding='utf-8')
