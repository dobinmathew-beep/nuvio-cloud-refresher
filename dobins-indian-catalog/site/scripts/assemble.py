from pathlib import Path
import json,base64
P=Path(__file__).resolve().parents[1];D=P/'worker/seed'
seed={n:json.loads((D/n).read_text()) for n in ['catalogs.json','metadata.json','status.json','matches.json','candidates.json','sources.json','unmatched.json','physical.json']}
icon=base64.b64encode((P/'worker/icon.png').read_bytes()).decode()
out='const PAGE='+json.dumps((P/'worker/page.html').read_text())+';\nconst SEED='+json.dumps(seed,ensure_ascii=False)+';\nconst ICON='+json.dumps(icon)+';\n'+(P/'worker/server.mjs').read_text()
(P/'worker/index.js').write_text(out)
