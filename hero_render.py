"""Daily 30fps movie reels with fixed public filenames and subpixel film motion."""
from pathlib import Path
import sys,json,math,hashlib,subprocess,struct,shutil,importlib.util
import numpy as np
from PIL import Image,ImageDraw,ImageFilter
HERE=Path(__file__).parent;HERO=HERE.parent;ROOT=HERO.parent.parent;OUT=ROOT/'dist/hero';WORK=ROOT/'work/daily-heroes';WORK.mkdir(parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location('original',HERO/'projector/render_projector_v19.py');old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
W,H,FPS,DURATION=1280,720,30,50
VERSION='catalog-head-opening-1'
MUSIC=json.loads((HERE/'music.json').read_text())
def mappings():
 us=np.linspace(0,1,401);tops=np.array([old.curve(float(u),0)[0] for u in us]);bots=np.array([old.curve(float(u),0)[1] for u in us]);centres=(tops+bots)/2;heights=np.linalg.norm(tops-bots,axis=1);coords=np.r_[0,np.cumsum(np.linalg.norm(np.diff(centres,axis=0),axis=1)/((heights[1:]+heights[:-1])/2)*344)]
 quads=[]
 for j in range(48):
  u0=j/48;u1=(j+1)/48;top0,bot0=old.curve(u0,0);top1,bot1=old.curve(u1,0);q=[top0,top1,bot1,bot0]
  x0=max(0,math.floor(min(x for x,y in q))-1);x1=min(W,math.ceil(max(x for x,y in q))+1);y0=max(0,math.floor(min(y for x,y in q))-1);y1=min(H,math.ceil(max(y for x,y in q))+1)
  if x1<=x0 or y1<=y0:continue
  sx=float(np.interp(u0,us,coords));ex=float(np.interp(u1,us,coords));dest=[(x-x0,y-y0) for x,y in q];src=[(sx,0),(ex,0),(ex,344),(sx,344)];a=[];b=[]
  for (x,y),(tx,ty) in zip(dest,src):a.extend([[x,y,1,0,0,0,-tx*x,-tx*y],[0,0,0,x,y,1,-ty*x,-ty*y]]);b.extend([tx,ty])
  coeff=np.linalg.solve(a,b);quads.append((u1,(x0,y0),(x1-x0,y1-y0),coeff))
 return quads
MAPS=mappings()
def opening_offset(count):
 # Place catalog movie zero in the large foreground panel at the start.
 us=np.linspace(0,1,401);tops=np.array([old.curve(float(u),0)[0] for u in us]);bots=np.array([old.curve(float(u),0)[1] for u in us]);centres=(tops+bots)/2
 heights=np.linalg.norm(tops-bots,axis=1);coords=np.r_[0,np.cumsum(np.linalg.norm(np.diff(centres,axis=0),axis=1)/((heights[1:]+heights[:-1])/2)*344)]
 return 228*count+114-float(np.interp(850,centres[:,0],coords))

def render(lang,preview=False,force=False):
 cfg=json.loads((HERE/(lang+'.json')).read_text());movies=cfg['movies'];count=len(movies);accent=old.THEMES[lang];music=MUSIC[lang];oldmeta=OUT/(lang+'-daily.json');signature=hashlib.sha256((VERSION+cfg['signature']+json.dumps(music,sort_keys=True)).encode()).hexdigest()
 if oldmeta.exists() and not force and not preview:
  meta=json.loads(oldmeta.read_text())
  if meta.get('render_signature')==signature and (OUT/(lang+'.mp4')).exists():
   meta['checked_at']=cfg['checked_at'];oldmeta.write_text(json.dumps(meta,indent=2));print(lang,'catalog unchanged; valid video retained',flush=True);return
 texture=Image.new('RGBA',(228*count*3,344))
 cards=[old.card(m,accent) for m in movies]
 for i in range(count*3):texture.paste(cards[i%count],(i*228,0))
 texture=texture.convert('RGBa');start_offset=opening_offset(count)
 body=Image.open(HERO/'projector/projector-body.png').convert('RGBA').resize((270,180),Image.Resampling.LANCZOS)
 rawreel=Image.open(HERO/'projector/reel.png').convert('RGBA').resize((280,280),Image.Resampling.LANCZOS)
 reels=[rawreel.rotate(k,Image.Resampling.BICUBIC).resize((71,82),Image.Resampling.LANCZOS) for k in range(360)]
 bg=Image.open(ROOT/'source/references'/(lang+'-dark.png')).convert('RGB').resize((W,H),Image.Resampling.LANCZOS);arr=np.asarray(bg,dtype=float)*.22;yy,xx=np.mgrid[:H,:W];glow=np.exp(-((xx-800)/510)**2-((yy-360)/270)**2)*.19
 for k in range(3):arr[:,:,k]+=glow*accent[k]
 base=Image.fromarray(np.uint8(np.clip(arr,0,255))).convert('RGBA');shadow=Image.new('RGBA',(W,H));ImageDraw.Draw(shadow).ellipse((0,420,292,465),fill=(0,0,0,160));base=Image.alpha_composite(base,shadow.filter(ImageFilter.GaussianBlur(16)))
 static=Image.new('RGBA',(W,H));bd=ImageDraw.Draw(static)
 for z in range(7,0,-1):
  spread=110+z*12;bd.polygon([(258,374),(1260,395-spread),(1280,395+spread)],fill=(255,215,143,int((9-z)*1.5)))
 static=static.filter(ImageFilter.GaussianBlur(12));static.alpha_composite(body,(0,260));ImageDraw.Draw(static).line([(241,264),(247,259),(253,253)],fill=(29,25,25),width=5)
 flare=Image.new('RGBA',(W,H));fd=ImageDraw.Draw(flare)
 for r in range(26,0,-3):fd.ellipse((258-r,374-r,258+r,374+r),fill=(255,206,118,max(0,60-r*2)))
 flare=flare.filter(ImageFilter.GaussianBlur(3))
 audio=WORK/(lang+'-audio.wav')
 if not preview:
  from audio import make_audio
  make_audio(lang,audio)
 tmp=WORK/(lang+'.mp4')
 if not preview:
  proc=subprocess.Popen(['ffmpeg','-y','-v','error','-f','rawvideo','-pix_fmt','rgb24','-s','1280x720','-r',str(FPS),'-i','pipe:0','-i',str(audio),'-vf','setsar=1','-c:v','libx264','-preset','slow','-crf','24','-pix_fmt','yuv420p','-profile:v','high','-level','3.1','-threads','2','-maxrate','1000k','-bufsize','2000k','-c:a','aac','-b:a','80k','-movflags','+faststart','-t',str(DURATION),str(tmp)],stdin=subprocess.PIPE)
 samples=[60,240,600,1080,1440] if preview else range(FPS*DURATION)
 for n in samples:
  t=n/FPS;scene=static.copy();angle=int(round(54*t))%360;scene.alpha_composite(reels[angle],(12,246));scene.alpha_composite(reels[(-angle+100)%360],(182,237))
  travel=start_offset+t/DURATION*(228*count)
  for u,pos,size,c in MAPS:
   a,b,d,e,f,g,h,k=c
   coeff=(a+travel*h,b+travel*k,d+travel,e,f,g,h,k)
   part=texture.transform(size,Image.Transform.PERSPECTIVE,coeff,Image.Resampling.BICUBIC)
   scene.alpha_composite(part.convert('RGBA'),pos)
  draw=ImageDraw.Draw(scene)
  for edge in [0,1]:draw.line([old.curve(float(u),0)[edge] for u in np.linspace(0,1,100)],fill=(*accent,150),width=2)
  scene=Image.alpha_composite(scene,flare)
  fade=float(old.smooth(t/.5)*old.smooth((DURATION-t)/.6))
  if fade<.999:scene.putalpha(scene.getchannel('A').point(lambda a:int(a*fade)))
  im=Image.alpha_composite(base,scene).convert('RGB')
  if preview or n==240:im.save(WORK/(lang+'-'+str(n)+'.jpg'),quality=94)
  if not preview:
   proc.stdin.write(im.tobytes())
   if n and n%300==0:print(lang,n,'/',FPS*DURATION,flush=True)
 if preview:return
 proc.stdin.close();assert proc.wait()==0
 # Validate before replacing the last-good public asset.
 probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(tmp)]));v=next(s for s in probe['streams'] if s['codec_type']=='video');a=next(s for s in probe['streams'] if s['codec_type']=='audio')
 assert v['codec_name']=='h264' and v['r_frame_rate']=='30/1' and v['width']==W and v['height']==H and v['sample_aspect_ratio']=='1:1';assert a['codec_name']=='aac' and a['channels']==2 and abs(float(probe['format']['duration'])-DURATION)<.1
 assert float(v['start_time'])==0 and float(a['start_time'])==0 and abs(float(v['duration'])-DURATION)<.001 and abs(float(a['duration'])-DURATION)<.001 and v['nb_frames']==str(FPS*DURATION)
 subprocess.run(['ffmpeg','-v','error','-i',str(tmp),'-f','null','-'],check=True)
 raw=tmp.read_bytes();pos=0;boxes=[]
 while pos<len(raw):size,kind=struct.unpack('>I4s',raw[pos:pos+8]);assert size>0;boxes.append(kind);pos+=size
 assert boxes.index(b'moov')<boxes.index(b'mdat')
 digest=hashlib.sha256(raw).hexdigest();dest=OUT/(lang+'.mp4');stage=dest.with_suffix('.tmp');shutil.copyfile(tmp,stage);stage.replace(dest);shutil.copyfile(WORK/(lang+'-240.jpg'),OUT/(lang+'-daily.jpg'))
 meta={**cfg,'url':'/hero/'+lang+'.mp4','poster':'/hero/'+lang+'-daily.jpg','file':lang+'.mp4','bytes':len(raw),'sha256':digest,'render_signature':signature,'fps':FPS,'duration_seconds':DURATION,'width':W,'height':H,'audio':music,'films':movies,'opening_movie_id':movies[0]['id'],'opening_selection':'catalog-order','opening_version':1}
 oldmeta.write_text(json.dumps(meta,indent=2));print('FINISHED',lang,len(movies),'films',len(raw),'bytes',flush=True)
if __name__=='__main__':
 langs=[x for x in sys.argv[1:] if not x.startswith('--')] or list(old.THEMES)
 for lang in langs:render(lang,'--preview' in sys.argv,'--force' in sys.argv)
