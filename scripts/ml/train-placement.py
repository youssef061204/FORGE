"""Train future local emergency-demand prediction on whole training episodes."""
import gzip,json,hashlib
from pathlib import Path
import numpy as np
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
from threadpoolctl import threadpool_limits
threadpool_limits(2)
root=Path(__file__).resolve().parents[2];out=root/"artifacts/ml"
columns=[8,21,25,26,15,16,13,4,3,12]
parts={}
for line in gzip.open(out/"episodes.jsonl.gz","rt"):
    e=json.loads(line);p=parts.setdefault(e["split"],{"x":[],"y":[],"ids":[]})
    for r in e["rows"]:
        if r["horizon"]==60:
            p["x"].append([r["x"][j] for j in columns]);p["y"].append(r["y"][8]);p["ids"].append(e["id"])
for p in parts.values():p["x"]=np.array(p["x"]);p["y"]=np.array(p["y"])
scaler=StandardScaler().fit(parts["train"]["x"]);best=None
for alpha in (1.,10.,100.):
    m=Ridge(alpha=alpha).fit(scaler.transform(parts["train"]["x"]),parts["train"]["y"])
    error=np.mean(abs(np.maximum(0,m.predict(scaler.transform(parts["validation"]["x"])))-parts["validation"]["y"]))
    if best is None or error<best[0]:best=(error,m,alpha)
m=best[1];metrics={}
for split,p in parts.items():
    pred=np.maximum(0,m.predict(scaler.transform(p["x"])))
    errors=abs(pred-p["y"]);episodes=np.unique(p["ids"]);ids=np.array(p["ids"])
    ep=np.array([errors[ids==e].mean() for e in episodes]);rng=np.random.default_rng(9042)
    ci=np.quantile(rng.choice(ep,(300,len(ep)),replace=True).mean(axis=1),[.025,.975])
    metrics[split]={"episodes":len(episodes),"rows":len(p["y"]),"learnedMAE":float(errors.mean()),"persistenceMAE":float(abs(p["x"][:,0]-p["y"]).mean()),"mae95CI":ci.tolist()}
data={"version":"placement-demand-1","trained":True,"columns":columns,"weights":(m.coef_/scaler.scale_).tolist(),"bias":float(m.intercept_-np.sum(m.coef_*scaler.mean_/scaler.scale_)),"alphaSelectedOnValidation":best[2],"datasetHash":json.loads((out/"dataset.json").read_text())["datasetHash"],"target":"Actual local exposed-person demand at +60 seconds","metrics":metrics}
encoded=json.dumps(data,separators=(",",":"))
(root/"src/forge/placement-model.json").write_text(encoded)
(out/"placement-training.json").write_text(json.dumps({**data,"modelHash":hashlib.sha256(encoded.encode()).hexdigest()},indent=2))
print("Placement model measured",metrics["heldout"],flush=True)
