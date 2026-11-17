import json
from pathlib import Path
import numpy as np,torch
from torch import nn
from PIL import Image
root=Path(__file__).resolve().parents[2];out=root/"artifacts/ml"
bundle=json.loads((root/"src/forge/vision-model.json").read_text());dataset=json.loads((out/"vision-dataset.json").read_text())
class Camera(nn.Module):
    def __init__(self):
        super().__init__();self.conv1=nn.Conv2d(3,8,3,2,1);self.conv2=nn.Conv2d(8,12,3,2,1);self.head=nn.Linear(12,4)
    def forward(self,x):return self.head(torch.relu(self.conv2(torch.relu(self.conv1(x)))).mean(dim=(2,3)))
model=Camera();model.load_state_dict({k:torch.tensor(v) for k,v in bundle["weights"].items()});model.eval()
cases=[]
for row in [r for r in dataset["rows"] if r["split"]=="heldout"][::45][:4]:
    image=np.array(Image.open(out/row["path"]).convert("RGB").resize((64,64),Image.Resampling.BILINEAR))
    with torch.no_grad():logits=model(torch.tensor(image.astype(np.float32)/127.5-1).permute(2,0,1).unsqueeze(0)).numpy()[0]
    predicted=[float(1/(1+np.exp(-(float(logits[i])*c["weight"]+c["bias"])))) for i,c in enumerate(bundle["calibration"])]
    rgba=np.concatenate([image,np.full((64,64,1),255,np.uint8)],axis=2)
    cases.append({"path":row["path"],"rgba":rgba.reshape(-1).tolist(),"predicted":predicted})
(out/"vision-parity.json").write_text(json.dumps({"cases":cases,"preprocess":"Pillow bilinear fixed fixture; browser resizing is separately inspected"},separators=(",",":")))
