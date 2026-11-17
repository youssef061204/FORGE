import os
os.environ.setdefault("OMP_NUM_THREADS","2")
os.environ.setdefault("OPENBLAS_NUM_THREADS","2")
import json,hashlib
from pathlib import Path
from datetime import datetime,timezone
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import precision_recall_fscore_support,brier_score_loss
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/"artifacts/ml"
dataset=json.loads((OUT/"vision-dataset.json").read_text());rows=dataset["rows"]
vision=json.loads((OUT/"vision-predictions.json").read_text())
assert vision["datasetHash"]==dataset["datasetHash"]
camera=np.asarray(vision["predictions"]);obscured=np.asarray(vision["obscured"])
sensors=np.asarray([r["sensors"] for r in rows]);labels=np.asarray([r["labels"] for r in rows])
def features(indices,fault):
    c=camera[indices].copy();s=sensors[indices].copy()
    cq=np.ones((len(indices),1));sq=np.ones((len(indices),1))
    if fault in ("obscured","combined"):c=obscured[indices];cq[:]=.35
    if fault=="missing":s[:]=0;sq[:]=0
    if fault in ("spoof","combined"):s=1-s;sq[:]=.25
    if fault=="delayed":
        for k,i in enumerate(indices):
            earlier=[j for j,r in enumerate(rows) if r["episode"]==rows[i]["episode"] and r["camera"]==rows[i]["camera"] and r["seconds"]<rows[i]["seconds"]]
            if earlier:s[k]=sensors[earlier[0]]
        sq[:]=.5
    return np.column_stack([c,s,cq,sq])
parts={s:np.asarray([i for i,r in enumerate(rows) if r["split"]==s]) for s in ("train","validation","heldout","shift","compositional")}
train=parts["train"]
faults=("clean","obscured","missing","spoof","delayed")
training=np.concatenate([features(train,f) for f in faults])
training_y=np.tile(labels[train],(len(faults),1))
models=[];sensor_models=[]
for j in range(4):
    models.append(LogisticRegression(C=.3,max_iter=600).fit(training,training_y[:,j]))
    sensor_models.append(LogisticRegression(C=.3,max_iter=600).fit(sensors[train],labels[train,j]))
def measure(y,p):
    precision,recall,f1,_=precision_recall_fscore_support(y,p>=.5,average="binary",zero_division=0)
    return {"precision":float(precision),"recall":float(recall),"f1":float(f1),"brier":float(brier_score_loss(y,p)),"positives":int(y.sum()),"samples":len(y)}
results={}
for split in ("heldout","shift","compositional"):
    idx=parts[split];entry={}
    for fault in (*faults,"combined"):
        x=features(idx,fault);entry[fault]={}
        for j,name in enumerate(dataset["labels"]):
            entry[fault][name]={"camera":measure(labels[idx,j],x[:,j]),"sensor":measure(labels[idx,j],sensor_models[j].predict_proba(x[:,4:8])[:,1]),"fusion":measure(labels[idx,j],models[j].predict_proba(x)[:,1])}
    results[split]=entry
bundle={"version":"fusion-model-1","datasetHash":dataset["datasetHash"],"labels":dataset["labels"],"weights":[m.coef_[0].tolist() for m in models],"bias":[float(m.intercept_[0]) for m in models]}
encoded=json.dumps(bundle,separators=(",",":"))
(ROOT/"src/forge/fusion-model.json").write_text(encoded,encoding="utf-8")
(OUT/"sensor-fusion.json").write_text(json.dumps({"createdAt":datetime.now(timezone.utc).isoformat(),"datasetHash":dataset["datasetHash"],"modelHash":hashlib.sha256(encoded.encode()).hexdigest(),"trainingFaults":faults,"unseenFault":"combined","qualitySignals":"Known missing, stale or camera-mask flags in controlled benchmark, not an omniscient detector of arbitrary attacks","results":results},indent=2),encoding="utf-8")
print("Sensor fusion evaluated on held-out corruption modes",flush=True)
