import os
os.environ.setdefault("OMP_NUM_THREADS","2")
import json,hashlib,time
from pathlib import Path
from datetime import datetime,timezone
import numpy as np
import torch
from torch import nn
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/"artifacts/ml"
torch.manual_seed(504);np.random.seed(504);torch.set_num_threads(2)
device="cuda" if torch.cuda.is_available() else "cpu"
data=json.loads((OUT/"control-dataset.json").read_text())
train=[r for r in data["rows"] if r["split"]=="train"]
validation=[r for r in data["rows"] if r["split"]=="validation"]
assert not {r["episode"] for r in train}&{r["episode"] for r in validation}
def tensors(rows):
    return [torch.tensor(np.asarray([r[k] for r in rows]),dtype=torch.float32 if k not in ("action",) else torch.int64,device=device) for k in ("state","action","reward","next","done")]
S,A,R,N,D=tensors(train);VS,VA,VR,VN,VD=tensors(validation)
network=nn.Sequential(nn.Linear(6,12),nn.ReLU(),nn.Linear(12,2)).to(device)
target=nn.Sequential(nn.Linear(6,12),nn.ReLU(),nn.Linear(12,2)).to(device);target.load_state_dict(network.state_dict())
optimizer=torch.optim.Adam(network.parameters(),lr=.001)
curve=[];started=time.perf_counter()
# Genuine offline Double DQN: Bellman targets from actual simulation transitions.
# Fixed training schedule is chosen before held-out controller evaluation.
for step in range(3000):
    idx=torch.randint(0,len(train),(512,),device=device)
    with torch.no_grad():
        chosen=network(N[idx]).argmax(1)
        future=target(N[idx]).gather(1,chosen[:,None]).squeeze(1)
        expected=R[idx]+.9*(1-D[idx])*future
    predicted=network(S[idx]).gather(1,A[idx,None]).squeeze(1)
    loss=nn.functional.smooth_l1_loss(predicted,expected)
    optimizer.zero_grad();loss.backward();nn.utils.clip_grad_norm_(network.parameters(),5);optimizer.step()
    if(step+1)%100==0:target.load_state_dict(network.state_dict())
    if step%300==0:
        with torch.no_grad():
            future=target(VN).gather(1,network(VN).argmax(1)[:,None]).squeeze(1)
            validation_loss=float(nn.functional.smooth_l1_loss(network(VS).gather(1,VA[:,None]).squeeze(1),VR+.9*(1-VD)*future))
        curve.append({"step":step,"trainTDError":float(loss.detach()),"validationTDError":validation_loss})
        print("DQN step",step,"validation TD error",validation_loss,flush=True)
weights={name:t.detach().cpu().numpy().tolist() for name,t in network.state_dict().items()}
bundle={"version":"signal-dqn-1","datasetHash":data["datasetHash"],"inputs":["nsQueue/10","ewQueue/10","nsWait/120","ewWait/120","nsPhase","remaining/20"],"actions":["ns","ew"],"weights":weights}
encoded=json.dumps(bundle,separators=(",",":"))
(ROOT/"src/forge/rl-model.json").write_text(encoded,encoding="utf-8")
torch.save(network.cpu().state_dict(),OUT/"rl.pt")
(OUT/"rl-training.json").write_text(json.dumps({"createdAt":datetime.now(timezone.utc).isoformat(),"algorithm":"offline Double DQN","device":device,"gpu":torch.cuda.get_device_name(0) if device=="cuda" else None,"datasetHash":data["datasetHash"],"modelHash":hashlib.sha256(encoded.encode()).hexdigest(),"trainingTransitions":len(train),"validationTransitions":len(validation),"trainingEpisodes":80,"gamma":.9,"gradientSteps":3000,"durationSeconds":time.perf_counter()-started,"curve":curve,"heldoutPolicyPerformance":"Pending paired actual worker/broker evaluation; TD loss is not policy success."},indent=2),encoding="utf-8")
print("DQN training complete; deployment permission remains unchanged",flush=True)
