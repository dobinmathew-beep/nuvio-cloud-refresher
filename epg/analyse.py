import re,json,collections,unicodedata
from pathlib import Path
import xml.etree.ElementTree as E
from datetime import datetime,timezone
BASE=Path(__file__).resolve().parent/'inputs'
DB={c['id']:c for c in json.loads((BASE/'channels.json').read_text())}
NOW=datetime.now(timezone.utc)
def norm(s):
 s=unicodedata.normalize('NFKD',s).casefold().replace('&','and')
 return re.sub(r'[^a-z0-9]','',s)
def parse_date(s):return datetime.strptime(s.strip(),'%Y%m%d%H%M%S %z')
def clean_name(n,source):
 n=re.sub(r'^[A-Z]{2}\s*-\s*','',n)
 # Some suppliers append explicit ISO country suffixes to display names.
 n=re.sub(r'\.(in|ca|us|nl|sg|ae|uk|gb)$','',n,flags=re.I)
 return n.strip()
def targets():
 entries=[]
 lines=(BASE/'playlist.m3u').read_text().splitlines()
 for idx,l in enumerate(lines):
  if not l.startswith('#EXTINF'):continue
  cid=re.search(r'tvg-id="([^"]+)"',l).group(1)
  base,v=cid.split('@',1) if '@' in cid else (cid,'')
  c=DB.get(base,{'name':base.rsplit('.',1)[0],'alt_names':[],'country':base.rsplit('.',1)[-1].upper()})
  names=[c['name']]+c.get('alt_names',[])
  if v=='HD':names=[n if re.search(r'\bHD$',n,re.I) else n+' HD' for n in names]
  elif v not in ('SD','India','Main',''):names=[]
  entries.append({'id':cid,'base':base,'feed':v,'names':names,'canonical':c['name'],'country':c['country'],'label':l.rsplit(',',1)[-1],'metadata':l,'url':lines[idx+1] if idx+1<len(lines) else ''})
 return entries
ENTRIES=targets()
# Add explicit provider names from IPTV-org's channel mapping registry.
lookup={e['id'].casefold():e for e in ENTRIES}
registry_names=collections.defaultdict(set)
for mapping in BASE.glob('*.channels.xml'):
 for c in E.parse(mapping).getroot().findall('channel'):
  cid=c.get('xmltv_id','').casefold()
  if cid in lookup and (c.text or '').strip():registry_names[norm(c.text)].add(cid)
for mapping in BASE.glob('*.channels.xml'):
 for c in E.parse(mapping).getroot().findall('channel'):
  cid=c.get('xmltv_id','').casefold(); n=(c.text or '').strip()
  if cid in lookup and n and len(registry_names[norm(n)])==1:
   if n not in lookup[cid]['names']:lookup[cid]['names'].append(n)

# NCERT's official eVidya channel-details document identifies the numbered PM eVidya channels.
# Preserve each channel number; no substitution between classes.
for number in range(4,13):
 key=f'EVidya{number}.in@SD'.casefold()
 if key in lookup:lookup[key]['names'] += [f'PM e Vidya {number:02}',f'PM eVidya {number:02}',f'e-Vidya {number}']
def analyse():
 result={};counts={};allnames={}
 placeholder=re.compile(r'^(no (data|info|information|programme information|program information|epg)( available)?|information (not |un)available|program(me)? (information |info )?not available|to be announced|tba|no program(me)?s? available)$',re.I)
 for path in sorted(BASE.glob('*.xml')):
  source=path.name
  if source=='us.xml' or source.endswith('.channels.xml'):continue
  root=E.parse(path).getroot()
  ci={c.get('id'):c for c in root.findall('channel')}
  ni=collections.defaultdict(set);bi=collections.defaultdict(set)
  for sid,c in ci.items():
   bi[sid.casefold()].add(sid)
   for n in c.findall('display-name'):ni[norm(clean_name(n.text or '',source))].add(sid)
  # Source-specific domestic guides. International country sources only match their country.
  scountry=('US' if source=='us-filtered.xml' else source.split('.')[0].upper()) if source in ['ca.xml','us-filtered.xml','nl.xml','ae.xml','sg.xml','gb.xml'] else 'IN'
  cand={}
  for e in ENTRIES:
   ids=set();method=''
   if source=='samsung-in.xml':
    found={sid for sid in ci if sid and sid in e['metadata']+' '+e['url']}
    if len(found)==1:
     ids=found;method='exact Samsung station ID in playlist stream/logo metadata'
   if not ids and (e['feed'] in ('SD','Main','') or (e['feed']=='India' and scountry=='IN')):
    ids=bi.get(e['base'].casefold(),set());method='exact canonical ID (case-insensitive), default/national feed'
   if not ids and (e['country']==scountry or (e['country']=='UK' and scountry=='GB') or (e['feed']=='India' and scountry=='IN')):
    for n in e['names']:
     matches=ni.get(norm(n),set())
     if len(matches)==1:
      ids=matches;break
     elif len(matches)>1:
      ids=matches;break
    method='exact normalized canonical name, then aliases; HD and regional labels retained'
   if len(ids)==1:cand[e['id']]=(next(iter(ids)),method)
  wanted={v[0] for v in cand.values()};ps=collections.defaultdict(list);rejected=collections.Counter()
  # Repair only unambiguous punctuation/spacing differences between this supplier's channel IDs and programme references.
  cidnorm=collections.defaultdict(set)
  for sid in ci:cidnorm[norm(sid)].add(sid)
  repaired_refs=set()

  for p in root.findall('programme'):
   sid=p.get('channel')
   if sid not in wanted:
    possible=cidnorm.get(norm(sid or ''),set())
    if len(possible)==1 and next(iter(possible)) in wanted:
     repaired_refs.add((sid,next(iter(possible))));sid=next(iter(possible))
    else:continue
   try:
    st,en=parse_date(p.get('start','')),parse_date(p.get('stop',''))
    title=(p.findtext('title') or '').strip()
    if en<=st:rejected['invalid_interval']+=1;continue
    if en<=NOW or st>NOW.replace(year=NOW.year)+__import__('datetime').timedelta(days=8):continue
    if not title or placeholder.fullmatch(title):rejected['placeholder_or_empty']+=1;continue
    ps[sid].append((st,en,p))
   except (ValueError,TypeError):rejected['invalid_timestamp']+=1
  result[source]={'candidates':cand,'programmes':ps,'channels':ci,'rejected':dict(rejected),'repaired_references':sorted(repaired_refs)}
  matched=[cid for cid,(sid,m) in cand.items() if ps.get(sid)]
  counts[source]={'channels':len(ci),'candidate_ids':len(cand),'with_future_data':len(matched),'rejected':dict(rejected)}
  allnames[source]=list(ni)
  print(source,counts[source],flush=True)
 union={cid for s,d in result.items() for cid,(sid,m) in d['candidates'].items() if d['programmes'].get(sid)}
 missing=[e for e in ENTRIES if e['id'] not in union]
 (BASE/'unmatched.json').write_text(json.dumps(missing,indent=2))
 (BASE/'source_analysis.json').write_text(json.dumps(counts,indent=2))
 print('TOTAL',len(ENTRIES),'MATCHED',len(union),'MISSING',len(missing),flush=True)
 print('UNMATCHED SAMPLE',[(e['id'],e['canonical']) for e in missing[:70]],flush=True)
 return result
if __name__=='__main__':analyse()
