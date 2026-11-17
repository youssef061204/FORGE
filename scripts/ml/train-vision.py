import os
os.environ.setdefault("OMP_NUM_THREADS","2")
import json,copy,hashlib,time
from pathlib import Path
from datetime import datetime,timezone
import numpy as np
from PIL import Image
import torch
from torch import nn
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import precision_recall_fscore_support,roc_auc_score,average_precision_score,brier_score_loss
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/"artifacts/ml"
torch.set_num_threads(2);torch.manual_seed(300);np.random.seed(300)
device="cuda" if torch.cuda.is_available() else "cpu"
dataset=json.loads((OUT/"vision-dataset.json").read_text())
rows=dataset["rows"]
images=np.asarray([np.asarray(Image.open(OUT/r["path"]).convert("RGB").resize((64,64),Image.Resampling.BILINEAR),dtype=np.float32)/127.5-1 for r in rows]).transpose(0,3,1,2)
labels=np.asarray([r["labels"] for r in rows],dtype=np.float32)
splits={s:np.asarray([i for i,r in enumerate(rows) if r["split"]==s]) for s in ("train","validation","heldout","shift","compositional")}
class CameraModel(nn.Module):
    def __init__(self):
        super().__init__();self.conv1=nn.Conv2d(3,8,3,stride=2,padding=1);self.conv2=nn.Conv2d(8,12,3,stride=2,padding=1);self.head=nn.Linear(12,4)
    def forward(self,x):
        x=torch.relu(self.conv1(x));x=torch.relu(self.conv2(x));return self.head(x.mean(dim=(2,3)))
model=CameraModel().to(device)
X=torch.tensor(images,device=device);Y=torch.tensor(labels,device=device)
train=splits["train"];validation=splits["validation"]
assert not {rows[i]["episode"] for i in train}&{rows[i]["episode"] for i in validation}
positives=labels[train].sum(axis=0)
loss_fn=nn.BCEWithLogitsLoss(pos_weight=torch.tensor(np.clip((len(train)-positives)/np.maximum(1,positives),1,10),device=device))
optimizer=torch.optim.AdamW(model.parameters(),lr=.002,weight_decay=.005)
best=float("inf");best_weights=None;stale=0;curve=[];start=time.perf_counter()
for epoch in range(60):
    model.train();order=np.random.permutation(train)
    for offset in range(0,len(order),64):
        batch=order[offset:offset+64]
        optimizer.zero_grad();pred=model(X[batch]);loss=loss_fn(pred,Y[batch]);loss.backward();optimizer.step()
    model.eval()
    with torch.no_grad(): validation_loss=float(loss_fn(model(X[validation]),Y[validation]))
    curve.append(validation_loss)
    if validation_loss<best-1e-4:best=validation_loss;best_weights=copy.deepcopy(model.state_dict());stale=0
    else:stale+=1
    if epoch%10==0:print("Vision epoch",epoch,"validation loss",validation_loss,flush=True)
    if stale>=9:break
model.load_state_dict(best_weights);model.eval()
with torch.no_grad():
    logits=model(X).cpu().numpy()
    obscured=X.clone();obscured[:,:,:32,:]=-.9
    obscured_logits=model(obscured).cpu().numpy()
calibrations=[];predictions=np.zeros_like(logits);obscured_predictions=np.zeros_like(logits)
for j in range(4):
    cal=LogisticRegression(C=1,max_iter=300).fit(logits[validation,j:j+1],labels[validation,j])
    predictions[:,j]=cal.predict_proba(logits[:,j:j+1])[:,1]
    obscured_predictions[:,j]=cal.predict_proba(obscured_logits[:,j:j+1])[:,1]
    calibrations.append({"weight":float(cal.coef_[0,0]),"bias":float(cal.intercept_[0])})
metrics={}
for split,indices in splits.items():
    entry={}
    for j,name in enumerate(dataset["labels"]):
        y=labels[indices,j];p=predictions[indices,j]
        precision,recall,f1,_=precision_recall_fscore_support(y,p>=.5,average="binary",zero_division=0)
        entry[name]={"precision":float(precision),"recall":float(recall),"f1":float(f1),"auroc":float(roc_auc_score(y,p)) if len(np.unique(y))>1 else None,"auprc":float(average_precision_score(y,p)) if y.sum() else None,"brier":float(brier_score_loss(y,p)),"positives":int(y.sum()),"frames":len(indices),"episodes":len({rows[i]["episode"] for i in indices})}
    metrics[split]=entry
weights={name:t.detach().cpu().numpy().tolist() for name,t in model.state_dict().items()}
bundle={"version":"camera-model-1","inputSize":64,"labels":dataset["labels"],"weights":weights,"calibration":calibrations,"datasetHash":dataset["datasetHash"]}
encoded=json.dumps(bundle,separators=(",",":"))
(ROOT/"src/forge/vision-model.json").write_text(encoded,encoding="utf-8")
torch.save({"weights":model.cpu().state_dict(),"datasetHash":dataset["datasetHash"]},OUT/"vision.pt")
evidence={"createdAt":datetime.now(timezone.utc).isoformat(),"datasetHash":dataset["datasetHash"],"modelHash":hashlib.sha256(encoded.encode()).hexdigest(),"architecture":"Two stride-2 convolution layers (3→8→12), spatial mean pooling, four output heads; rendered RGB pixels only.","device":device,"gpu":torch.cuda.get_device_name(0) if device=="cuda" else None,"durationSeconds":time.perf_counter()-start,"epochs":len(curve),"validationLoss":curve,"calibration":"Platt scaling, validation episodes only","metrics":metrics,"limitations":["Stylized simulator imagery, no real camera transfer claim.","Image-level detection rather than bounding-box localization or mAP.","Corrupted-camera fusion evaluation is separately reported."]}
(OUT/"vision.json").write_text(json.dumps(evidence,indent=2),encoding="utf-8")
(OUT/"vision-predictions.json").write_text(json.dumps({"datasetHash":dataset["datasetHash"],"predictions":predictions.tolist(),"obscured":obscured_predictions.tolist()}),encoding="utf-8")
print("Vision trained on",device,"held-out",metrics["heldout"],flush=True)
