"""Optional authenticated local read-only CUDA field bridge. No program execution API."""
import os,json,time,threading,hmac
from pathlib import Path
from http.server import HTTPServer,BaseHTTPRequestHandler
os.environ.setdefault("OMP_NUM_THREADS","2")
import numpy as np,torch
from gpu_fields import simulate
root=Path(__file__).resolve().parents[2]
settings=dict(line.split("=",1) for line in (root/".env.gpu").read_text().splitlines() if "=" in line and not line.startswith("#"))
token=settings["FORGE_GPU_BRIDGE_TOKEN"];lock=threading.Lock();torch.set_num_threads(2)
columns=["elevation","fuel","water","fire","smoke","gas","damage"]
kinds={"flood":0,"wildfire":1,"earthquake":2,"tornado":3,"blackout":4,"storm":5,"gas":6,"traffic":7}
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def answer(self,status,value):
        raw=json.dumps(value,allow_nan=False).encode();self.send_response(status);self.send_header("Content-Type","application/json");self.send_header("Content-Length",str(len(raw)));self.end_headers();self.wfile.write(raw)
    def auth(self):return hmac.compare_digest(self.headers.get("Authorization",""),"Bearer "+token)
    def do_GET(self):
        if not self.auth():return self.answer(401,{"error":"Authenticated bridge required"})
        self.answer(200,{"cuda":torch.cuda.is_available(),"device":torch.cuda.get_device_name(0) if torch.cuda.is_available() else None})
    def do_POST(self):
        if not self.auth():return self.answer(401,{"error":"Authenticated bridge required"})
        if self.path!="/fields":return self.answer(404,{"error":"Unknown operation"})
        length=int(self.headers.get("Content-Length","0"))
        if length<=0 or length>160000:return self.answer(413,{"error":"Bounded field input required"})
        if not lock.acquire(False):return self.answer(409,{"error":"GPU field computation is busy"})
        try:
            if not torch.cuda.is_available():raise RuntimeError("CUDA unavailable; no GPU claim or silent CPU fallback")
            body=json.loads(self.rfile.read(length));batch=int(body["batch"]);seed=int(body["seed"])
            if batch not in (100,1000,2048):raise ValueError("Invalid batch")
            cells=np.array([[c[k] for k in columns] for c in body["terrain"]["cells"]],np.float32)
            weather=np.array([body["weather"][k] for k in ("rain","wind","direction")],np.float32)
            if cells.shape!=(560,7) or not np.isfinite(cells).all() or not np.isfinite(weather).all():raise ValueError("Invalid physical fields")
            hazards=body["hazards"][:16];hs=np.array([[kinds[h["kind"]],h["x"],h["y"],h["radius"],h["intensity"],h["age"]] for h in hazards],np.float32).reshape(-1,6)
            rng=np.random.default_rng(seed);mult=rng.uniform(.7,1.25,batch)
            device="cuda";initial=torch.tensor(cells,device=device).reshape(1,20,28,7).repeat(batch,1,1,1)
            w=torch.tensor(weather,device=device).reshape(1,3).repeat(batch,1);h=torch.tensor(hs,device=device).unsqueeze(0).repeat(batch,1,1)
            if len(hazards):h[:,:,4]=torch.clamp(h[:,:,4]*torch.tensor(mult,device=device)[:,None],.1,1)
            torch.cuda.reset_peak_memory_stats();torch.cuda.synchronize();start=time.perf_counter()
            with torch.inference_mode():future=simulate(initial,w,h)
            torch.cuda.synchronize();duration=(time.perf_counter()-start)*1000
            values=future.cpu().numpy();losses=np.mean((values[:,:,:,2]>.7)|(values[:,:,:,3]>.3)|(values[:,:,:,5]>.3),axis=(1,2));tail=float(np.quantile(losses,.95))
            result={"provider":"CUDA / PyTorch","device":torch.cuda.get_device_name(0),"batch":batch,"seed":seed,"horizonSeconds":120,"durationMs":duration,
              "peakAllocatedBytes":torch.cuda.max_memory_allocated(),"meanBadCellFraction":float(losses.mean()),"p95":tail,"p99":float(np.quantile(losses,.99)),
              "worst":float(losses.max()),"cvar95":float(losses[losses>=tail].mean()),"scope":"Hazard fields only; fixed hazard centers/radii and observed weather. Not full City or mission safety.",
              "observedFieldHash":body["observedFieldHash"],"authority":False}
            self.answer(200,result)
        except Exception as e:self.answer(400,{"error":str(e)})
        finally:lock.release()
HTTPServer((os.environ.get("FORGE_GPU_BIND_HOST","127.0.0.1"),3120),Handler).serve_forever()
