#!/usr/bin/env python3
import csv,datetime as dt,gzip,hashlib,io,json,os,subprocess,sys,tempfile,time,urllib.parse,urllib.request,xml.etree.ElementTree as ET
from pathlib import Path
from zoneinfo import ZoneInfo
R=Path(__file__).resolve().parent; O=R/"verification"; O.mkdir(exist_ok=True)
T=dt.datetime.now(ZoneInfo("Asia/Muscat")).isoformat(); U="NuvioIndependentVerifier/1.0"
A=os.getenv("ADDON_BASE_URL","https://the-great-indian-addon.vercel.app").rstrip("/")
E="https://dobin-india-epg-feed.quickfield138.chatgpt.site"; B="https://dobin-nuvio-live-backdrops.quickfield138.chatgpt.site"; H="https://dobin-nuvio-star-cards.quickfield138.chatgpt.site"
def get(url,timeout=120):
 q=urllib.request.Request(url+("&" if "?" in url else "?")+"verify="+str(time.time_ns()),headers={"User-Agent":U,"Cache-Control":"no-cache"})
 with urllib.request.urlopen(q,timeout=timeout) as x:return x.status,dict(x.headers.items()),x.read()
def js(url):return json.loads(get(url)[2])
def addon():
 c=[]
 def check(label,fn):
  try:c.append({"name":label,"status":"pass","details":fn()})
  except Exception as e:c.append({"name":label,"status":"fail","error":str(e)[:700]})
 def manifest():
  m=js(A+"/manifest.json");assert m.get("name")=="The Great Indian Addon",m.get("name")
  assert len(m.get("catalogs",[]))==8,"expected eight catalogs"
  return {"name":m["name"],"catalogs":len(m["catalogs"])}
 check("public manifest",manifest)
 def cats():
  m=js(A+"/manifest.json");counts={}
  for x in m["catalogs"]:
   i,t=x.get("id"),x.get("type");assert i and t in ("movie","series"),str(x)
   d=js(A+"/install/ff/catalog/"+t+"/"+urllib.parse.quote(i,safe="")+".json")
   assert isinstance(d.get("metas"),list) and d["metas"],"empty catalog "+i
   counts[i]=len(d["metas"])
  assert len(counts)==8
  return {"catalogs":8,"entries":counts}
 check("all eight public catalog endpoints",cats)
 def health():
  h=js(A+"/health.json");v=h.get("checkout",{})
  assert isinstance(v.get("ready"),bool),"missing checkout readiness"
  if v.get("configured"):assert v["ready"]
  return {"checkout":v}
 check("public health endpoint",health)
 return {"status":"pass" if all(x["status"]=="pass" for x in c) else "fail","checked_at":T,"public_url":A,"checks":c}
def epg():
 c=[]
 try:
  s=js(E+"/status.json")
  for k in ("revision","checked_utc","matched_ids","playlist_channel_ids","unresolved_ids","programmes"):assert k in s,"missing "+k
  assert int(s["matched_ids"])>0 and int(s["programmes"])>0
  assert int(s["matched_ids"])+int(s["unresolved_ids"])==int(s["playlist_channel_ids"])
  when=dt.datetime.fromisoformat(s["checked_utc"].replace("Z","+00:00"));age=dt.datetime.now(dt.timezone.utc)-when.astimezone(dt.timezone.utc)
  assert dt.timedelta(hours=-1)<=age<=dt.timedelta(hours=36),"stale EPG "+str(age)
  c.append({"name":"public status and freshness","status":"pass","details":{k:s[k] for k in ("revision","checked_utc","matched_ids","playlist_channel_ids","unresolved_ids","programmes")}})
 except Exception as e:return {"status":"fail","checked_at":T,"public_url":E,"checks":[{"name":"status","status":"fail","error":str(e)[:700]}]}
 try:
  gz=get(E+"/India_EPG.xml.gz")[2];root=ET.fromstring(gzip.decompress(gz));assert root.tag=="tv"
  ch=root.findall("channel");pr=root.findall("programme");ids={x.get("id") for x in ch}
  assert len(ids)==len(ch)==int(s["matched_ids"]);assert len(pr)==int(s["programmes"])
  assert all(x.get("channel") in ids and x.findtext("title","").strip() for x in pr)
  c.append({"name":"published XMLTV","status":"pass","details":{"bytes":len(gz),"channels":len(ch),"programmes":len(pr)}})
 except Exception as e:c.append({"name":"published XMLTV","status":"fail","error":str(e)[:700]})
 for n in ("Channel_Matching_Report.csv","Unresolved_Channels.csv","Source_Crosscheck_Report.csv","Validation_Summary.json","Source_Health_Report.json"):
  try:
   b=get(E+"/"+urllib.parse.quote(n))[2]
   if n.endswith(".csv"):d={"rows":len(list(csv.DictReader(io.StringIO(b.decode("utf-8-sig")))))}
   else:d={"keys":list(json.loads(b))[:10]}
   assert next(iter(d.values())),"empty report"
   c.append({"name":n,"status":"pass","details":d})
  except Exception as e:c.append({"name":n,"status":"fail","error":str(e)[:500]})
 return {"status":"pass" if all(x["status"]=="pass" for x in c) else "fail","checked_at":T,"public_url":E,"checks":c}
def backdrops():
 try:
  p=subprocess.run([sys.executable,str(R/"verify_backdrops.py")],cwd=R,capture_output=True,text=True,timeout=1200)
  z=[x[8:] for x in p.stdout.splitlines() if x.startswith("SUMMARY ")]
  assert p.returncode==0 and z,(p.stderr or p.stdout)[-1200:]
  s=json.loads(z[-1]);assert s.get("statuses")==160 and s.get("images")==16 and not s.get("errors"),json.dumps(s.get("errors",[])[:5])
  return {"status":"pass","checked_at":T,"public_url":B,"details":s,"method":"160 public layout/status checks and 16 JPEG checks"}
 except Exception as e:return {"status":"fail","checked_at":T,"public_url":B,"error":str(e)[:1600]}
def reels():
 m=json.loads((R/"state/media.json").read_text());out=[]
 for lang in ("hindi","tamil","malayalam","telugu"):
  key="/hero/"+lang+".mp4"
  try:
   item=m[key];data=get(H+key,240)[2];digest=hashlib.sha256(data).hexdigest()
   assert b"ftyp" in data[:32] and len(data)>100000,"not a valid MP4 payload"
   assert digest==item["sha256"] and len(data)==int(item["bytes"]),"public bytes/hash differ from media manifest"
   with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
    f.write(data);f.flush()
    p=subprocess.run(["ffprobe","-v","error","-show_entries","format=duration:stream=codec_type,codec_name,width,height,sample_rate,channels","-of","json",f.name],capture_output=True,text=True,timeout=90)
    assert p.returncode==0,p.stderr[-500:];v=json.loads(p.stdout);ss=v.get("streams",[])
    assert any(x.get("codec_type")=="video" for x in ss) and any(x.get("codec_type")=="audio" for x in ss),"audio/video stream missing"
    duration=float(v["format"]["duration"]);assert 45<=duration<=55,"duration "+str(duration)
    p=subprocess.run(["ffmpeg","-v","error","-i",f.name,"-f","null","-"],capture_output=True,text=True,timeout=240)
    assert p.returncode==0,p.stderr[-700:]
   out.append({"language":lang,"status":"pass","bytes":len(data),"sha256":digest,"duration_seconds":round(duration,3),"streams":ss})
  except Exception as e:out.append({"language":lang,"status":"fail","error":str(e)[:900]})
 return {"status":"pass" if all(x["status"]=="pass" for x in out) else "fail","checked_at":T,"public_url":H,"reels":out,"method":"public MP4 download, manifest hash/size, ffprobe and full ffmpeg decode"}
def main():
 prior={}
 try:prior=json.loads((O/"latest.json").read_text())
 except Exception:pass
 outputs=prior.get("outputs",{})
 for n in ("addon","epg","backdrops","reels"):
  outputs.setdefault(n,{"status":"not_run","checked_at":None,"note":"Awaiting first independent check"})
 selected=[x.strip() for x in os.getenv("VERIFY_ONLY","").split(",") if x.strip()]
 if not selected:selected=["addon","epg","backdrops","reels"]
 funcs={"addon":addon,"epg":epg,"backdrops":backdrops,"reels":reels}
 for n in selected:
  if n not in funcs:raise SystemExit("Unknown VERIFY_ONLY target: "+n)
  try:outputs[n]=funcs[n]()
  except Exception as e:outputs[n]={"status":"fail","checked_at":T,"error":str(e)[:1200]}
 r={"schema_version":1,"checked_at":T,"timezone":"Asia/Muscat","verification_mode":"independent-public-output","outputs":outputs}
 passed=sum(outputs[n].get("status")=="pass" for n in ("addon","epg","backdrops","reels"))
 all_pass=all(outputs[n].get("status")=="pass" for n in ("addon","epg","backdrops","reels"))
 r["summary"]={"passed":passed,"total":4,"status":"pass" if all_pass else "fail"}
 (O/"latest.json").write_text(json.dumps(r,indent=2)+"\n")
 lines=["# Independent Nuvio output verification","",f"**Checked:** {T} (Oman time)",f"**Overall:** {passed}/4 outputs passed","","| Output | Result |","|---|---|"]
 for n in ("addon","epg","backdrops","reels"):lines.append(f"| {n.title()} | {r['outputs'][n].get('status','fail').upper()} |")
 for n in ("addon","epg","backdrops","reels"):
  x=r["outputs"][n];lines += ["",f"## {n.title()} — {x.get('status','fail').upper()}"]
  if "checks" in x:
   for y in x["checks"]:lines.append(f"- **{y['status'].upper()}** {y['name']}: {json.dumps(y.get('details',y.get('error','')),ensure_ascii=False)[:700]}")
  elif "reels" in x:
   for y in x["reels"]:lines.append(f"- **{y['status'].upper()}** {y['language']}: {json.dumps(y.get('error',y.get('duration_seconds')),ensure_ascii=False)[:700]}")
  else:lines.append(json.dumps(x.get("details",x.get("error")),indent=2)[:2400])
 (O/"latest.md").write_text("\n".join(lines)+"\n");print(json.dumps(r,indent=2),flush=True)
 if passed!=4:raise SystemExit(1)
if __name__=="__main__":main()
