import json,time,hashlib
from pathlib import Path
import numpy as np,onnx,onnxruntime as ort
from onnx import helper,numpy_helper,TensorProto
root=Path(__file__).resolve().parents[2];bundle=json.loads((root/"src/forge/rl-model.json").read_text());w=bundle["weights"]
nodes=[];initial=[]
for i,key in enumerate(("0","2")):
    for name,value in ((f"w{i}",np.array(w[key+".weight"],dtype=np.float32).T),(f"b{i}",np.array(w[key+".bias"],dtype=np.float32))):
        initial.append(numpy_helper.from_array(value,name))
    nodes+=[helper.make_node("MatMul",["input" if i==0 else "hidden",f"w{i}"],[f"mm{i}"]),helper.make_node("Add",[f"mm{i}",f"b{i}"],["pre" if i==0 else "output"])]
    if i==0:nodes.append(helper.make_node("Relu",["pre"],["hidden"]))
graph=helper.make_graph(nodes,"FORGE bounded DQN",[helper.make_tensor_value_info("input",TensorProto.FLOAT,["batch",6])],[helper.make_tensor_value_info("output",TensorProto.FLOAT,["batch",2])],initial)
model=helper.make_model(graph,opset_imports=[helper.make_opsetid("",13)],ir_version=10);onnx.checker.check_model(model)
target=root/"artifacts/ml/controller.onnx";onnx.save(model,target)
session=ort.InferenceSession(str(target),providers=["CPUExecutionProvider"]);rng=np.random.default_rng(302)
cases=[]
for batch in (1,64,1024):
    x=rng.uniform(0,1,(batch,6)).astype(np.float32)
    def native():return np.maximum(0,x@np.array(w["0.weight"],np.float32).T+np.array(w["0.bias"],np.float32))@np.array(w["2.weight"],np.float32).T+np.array(w["2.bias"],np.float32)
    actual=session.run(None,{"input":x})[0];expected=native();error=float(np.max(np.abs(actual-expected)));assert error<1e-4
    timings={}
    for name,fn in (("numpy",native),("onnxRuntime",lambda:session.run(None,{"input":x}))):
        for _ in range(10):fn()
        samples=[]
        for _ in range(100):
            start=time.perf_counter();fn();samples.append((time.perf_counter()-start)*1000)
        timings[name]={"p50Ms":float(np.median(samples)),"p95Ms":float(np.quantile(samples,.95))}
    cases.append({"batch":batch,"maxAbsoluteError":error,"timings":timings})
(root/"artifacts/ml/onnx.json").write_text(json.dumps({"model":bundle["version"],"onnxHash":hashlib.sha256(target.read_bytes()).hexdigest(),"providers":ort.get_available_providers(),"cases":cases,"TensorRT":"UNVERIFIED: no TensorRT provider is installed; no acceleration claim","scope":"Exported real trained six-input/two-output DQN; forecast tree ensembles remain portable TypeScript."},indent=2))
print("ONNX export, parity and latency passed",flush=True)
