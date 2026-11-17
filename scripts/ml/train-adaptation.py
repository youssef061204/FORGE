import gzip,json,hashlib,time
from pathlib import Path
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from threadpoolctl import threadpool_limits
threadpool_limits(2)
root=Path(__file__).resolve().parents[2];out=root/"artifacts/ml";fresh=json.loads((out/"adaptation-dataset.json").read_text())
original=[json.loads(l) for l in gzip.open(out/"episodes.jsonl.gz","rt")]
rows=[r for e in original if e["split"]=="train" for r in e["rows"] if r["horizon"]==60]
x=np.array([r["x"] for r in rows]);y=np.array([r["y"][0] for r in rows])
added=[r for e in fresh["episodes"] if e["split"]=="train" for r in e["rows"]]
xx=np.r_[x,np.array([r["x"] for r in added])];yy=np.r_[y,[r["y"] for r in added]]
model=HistGradientBoostingRegressor(max_iter=70,max_leaf_nodes=15,min_samples_leaf=40,l2_regularization=3,early_stopping=False,random_state=778).fit(xx,yy,sample_weight=np.r_[np.ones(len(y)),np.full(len(added),8.)])
base=json.loads((root/"src/forge/forecast-model.json").read_text());old=base["models"][base["selection"][0]]["heads"][0]
def predict(head,x):
    result=np.full(len(x),head["base"])
    for tree in head["trees"]:
        nodes=np.zeros(len(x),int)
        for _ in range(64):
            leaf=np.array([bool(tree[n][5]) for n in nodes]);alive=np.where(~leaf)[0]
            if not len(alive):break
            for i in alive:
                n=tree[nodes[i]];nodes[i]=int(n[2] if x[i,int(n[0])]<=n[1] else n[3])
        result+=np.array([tree[n][4] for n in nodes])
    return np.maximum(0,result)
def export(model):
    return {"base":float(model._baseline_prediction[0,0]),"trees":[[[int(n["feature_idx"]),float(n["num_threshold"]),int(n["left"]),int(n["right"]),float(n["value"]),int(n["is_leaf"])] for n in t.nodes] for it in model._predictors for t in it]}
metrics={}
for split in ("validation","heldout"):
    rs=[r for e in fresh["episodes"] if e["split"]==split for r in e["rows"]];vx=np.array([r["x"] for r in rs]);vy=np.array([r["y"] for r in rs])
    before=predict(old,vx);after=np.maximum(0,model.predict(vx))
    metrics[split]={"episodes":sum(e["split"]==split for e in fresh["episodes"]),"rows":len(rs),"baseQueueMAE":float(np.mean(abs(before-vy))),"candidateQueueMAE":float(np.mean(abs(after-vy))),"interval95":float(np.quantile(abs(after-vy),.95,method="higher")) if split=="validation" else None}
validated=metrics["validation"]["candidateQueueMAE"]<=metrics["validation"]["baseQueueMAE"]*1.05
encoded=json.dumps({"version":"queue-adapted-2","head":export(model),"datasetHash":hashlib.sha256((out/"adaptation-dataset.json").read_bytes()).hexdigest(),"validated":validated,"interval95":metrics["validation"]["interval95"]},separators=(",",":"))
(root/"src/forge/adapted-model.json").write_text(encoded)
(out/"model-registry.json").write_text(json.dumps({"createdAt":time.time(),"candidateVersion":"queue-adapted-2","candidateHash":hashlib.sha256(encoded.encode()).hexdigest(),"trainingScope":"Original training episodes plus 32 fresh shift training episodes; no original shift/heldout labels used for retraining","states":["TRAINED"]+(["VALIDATED","SHADOW"] if validated else []),"validated":validated,"metrics":metrics,"promotion":"Explicit owner action only; forecasts have no broker authority"},indent=2))
print("Adaptation measured",metrics,"validated",validated,flush=True)
