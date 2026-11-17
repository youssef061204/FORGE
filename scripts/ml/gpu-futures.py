import os
os.environ.setdefault("OMP_NUM_THREADS","2")
import argparse,json,time,math,gc,hashlib,subprocess
from pathlib import Path
from datetime import datetime,timezone
import numpy as np
import torch
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/"artifacts/ml"
parser=argparse.ArgumentParser(description="Benchmark local CPU/CUDA hazard-field futures")
parser.add_argument("--output",help="Relative JSON report path inside artifacts/ml (default: artifacts/ml/gpu-futures.json)")
args=parser.parse_args()
output_path=OUT/"gpu-futures.json"
if args.output is not None:
    requested=Path(args.output)
    if requested.is_absolute():parser.error("--output must be a relative path inside artifacts/ml")
    output_path=(ROOT/requested).resolve()
    try:output_path.relative_to(OUT.resolve())
    except ValueError:parser.error("--output must resolve inside artifacts/ml")
    if output_path.suffix.lower()!=".json":parser.error("--output must name a .json file")
input_path=OUT/"gpu-input.json"
if not input_path.exists():raise RuntimeError("Run scripts/ml/prepare-gpu.ts before the GPU benchmark")
provenance={
    name:{"path":path.relative_to(ROOT).as_posix(),"sha256":hashlib.sha256(path.read_bytes()).hexdigest()}
    for name,path in (("input",input_path),("benchmark",Path(__file__).resolve()),("fieldImplementation",ROOT/"scripts/ml/gpu_fields.py"))
}
data=json.loads(input_path.read_text());torch.set_num_threads(2)
columns=["elevation","fuel","water","fire","smoke","gas","damage"]
kind_ids={"flood":0,"wildfire":1,"earthquake":2,"tornado":3,"blackout":4,"storm":5,"gas":6,"traffic":7}
def inputs(batch,device,randomized=False):
    samples=[data["samples"][i%len(data["samples"])] for i in range(batch)]
    cells=torch.tensor([[[c[k] for k in columns] for c in s["initial"]["cells"]] for s in samples],dtype=torch.float32,device=device).reshape(batch,20,28,7)
    weather=torch.tensor([[s["initial"]["weather"][k] for k in ("rain","wind","direction")] for s in samples],dtype=torch.float32,device=device)
    hazards=torch.tensor([[[kind_ids[h["kind"]],h["x"],h["y"],h["radius"],h["intensity"],h["age"]] for h in s["initial"]["hazards"]] for s in samples],dtype=torch.float32,device=device)
    if randomized:
        rng=np.random.default_rng(904)
        multipliers=torch.tensor(rng.uniform(.7,1.25,batch),dtype=torch.float32,device=device)
        hazards[:,:,4]=torch.clamp(hazards[:,:,4]*multipliers[:,None],.1,1)
    return cells,weather,hazards
from gpu_fields import simulate
with torch.inference_mode():
    reference=simulate(*inputs(8,"cpu")).numpy().reshape(8,560,7)
    expected=np.asarray([[[c[k] for k in columns] for c in s["expected"]] for s in data["samples"]])
    cpu_error=float(np.max(np.abs(reference-expected)))
    if cpu_error>2e-5:raise RuntimeError("Vectorized/TypeScript field parity failed: "+str(cpu_error))
    cuda=torch.cuda.is_available()
    gpu_error=None
    if cuda:
        actual=simulate(*inputs(8,"cuda"));torch.cuda.synchronize()
        gpu_error=float(np.max(np.abs(actual.cpu().numpy().reshape(8,560,7)-expected)))
        if gpu_error>2e-5:raise RuntimeError("GPU/TypeScript parity failed: "+str(gpu_error))
    benches=[]
    last=None
    for batch in (16,64,128,256,512,1024,2048):
        entry={"batch":batch,"horizonSeconds":120,"dtSeconds":2}
        for device in ("cpu","cuda") if cuda else ("cpu",):
            initial=inputs(batch,device,True)
            if device=="cuda":torch.cuda.reset_peak_memory_stats();torch.cuda.synchronize()
            timings=[]
            for repeat in range(3):
                start=time.perf_counter();last=simulate(*initial)
                if device=="cuda":torch.cuda.synchronize()
                timings.append(time.perf_counter()-start)
            median=float(np.median(timings))
            utilization=None
            if device=="cuda":
                try:
                    reading=subprocess.run(["nvidia-smi","--query-gpu=utilization.gpu,memory.used","--format=csv,noheader,nounits"],capture_output=True,text=True,timeout=3,check=True).stdout.strip().splitlines()[0].split(",")
                    utilization={"gpuPercent":float(reading[0]),"usedMiB":float(reading[1]),"method":"One post-batch nvidia-smi spot reading; not steady-state utilization"}
                except (OSError,subprocess.SubprocessError,ValueError,IndexError):pass
            entry[device]={"seconds":median,"fieldFuturesPerSecond":batch/median,"repeats":timings,"peakAllocatedBytes":torch.cuda.max_memory_allocated() if device=="cuda" else None,"utilization":utilization}
            if device=="cpu" and cuda:del last;gc.collect()
        if cuda:entry["speedup"]=entry["cpu"]["seconds"]/entry["cuda"]["seconds"]
        benches.append(entry);print("Measured batched hazard-field futures",entry,flush=True)
    if cuda:values=last.cpu().numpy()
    else:values=last.numpy()
    losses=np.mean((values[:,:,:,2]>.7)|(values[:,:,:,3]>.3)|(values[:,:,:,5]>.3),axis=(1,2))
    tail=np.quantile(losses,.95)
    mc={"fieldFutures":len(losses),"seed":904,"target":"Fraction of field cells with >0.7m water, >0.3 fire or >0.3 gas; not a full City mission score","mean":float(np.mean(losses)),"median":float(np.median(losses)),"p90":float(np.quantile(losses,.9)),"p95":float(tail),"p99":float(np.quantile(losses,.99)),"worst":float(np.max(losses)),"cvar95":float(np.mean(losses[losses>=tail])),"badCellProbability":float(np.mean(losses>0))}
report={"createdAt":datetime.now(timezone.utc).isoformat(),"status":"VERIFIED" if cuda else "GPU_UNAVAILABLE","torch":torch.__version__,"cudaRuntime":torch.version.cuda,"gpu":torch.cuda.get_device_name(0) if cuda else None,"component":"Physical hazard-field transition, matched against TypeScript reference; full worker/broker City Futures remain separate.","profile":data["profile"],"provenance":provenance,"parity":{"cpuMaxError":cpu_error,"gpuMaxError":gpu_error},"benchmarks":benches,"monteCarlo":mc,"customKernel":"Not implemented; vectorized PyTorch is the measured optimization. No custom CUDA/TensorRT claim.","limitations":["Partial field acceleration, not whole City execution.","Vehicle routes, physical grid, worker and permission broker are not GPU-vectorized.","GPU availability on this Windows host does not establish CUDA support in the submission container."]}
output_path.parent.mkdir(parents=True,exist_ok=True)
output_path.write_text(json.dumps(report,indent=2),encoding="utf-8")
