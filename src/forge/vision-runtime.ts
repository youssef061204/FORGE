import cameraModel from "./vision-model.json";
import fusionModel from "./fusion-model.json";
type Tensor = number[][][][];
const weights = cameraModel.weights as unknown as Record<
  string,
  Tensor | number[][] | number[]
>;
const sigmoid = (n: number) => 1 / (1 + Math.exp(-n));
/** Pixel tensor only. Structured simulator labels never enter the camera network. */
export function cameraPredict(rgb: ArrayLike<number>) {
  const started = performance.now();
  let data = new Float32Array(3 * 64 * 64);
  for (let i = 0; i < 64 * 64; i++)
    for (let c = 0; c < 3; c++) data[c * 4096 + i] = rgb[i * 4 + c] / 127.5 - 1;
  let size = 64,
    channels = 3;
  for (const layer of ["conv1", "conv2"]) {
    const w = weights[layer + ".weight"] as Tensor,
      bias = weights[layer + ".bias"] as number[];
    const next = size / 2,
      output = new Float32Array(w.length * next * next);
    for (let oc = 0; oc < w.length; oc++)
      for (let y = 0; y < next; y++)
        for (let x = 0; x < next; x++) {
          let sum = bias[oc];
          for (let ic = 0; ic < channels; ic++)
            for (let ky = 0; ky < 3; ky++)
              for (let kx = 0; kx < 3; kx++) {
                const iy = y * 2 + ky - 1,
                  ix = x * 2 + kx - 1;
                if (iy >= 0 && iy < size && ix >= 0 && ix < size)
                  sum +=
                    data[ic * size * size + iy * size + ix] * w[oc][ic][ky][kx];
              }
          output[oc * next * next + y * next + x] = Math.max(0, sum);
        }
    data = output;
    size = next;
    channels = w.length;
  }
  const mean = Array.from({ length: channels }, (_, c) => {
    let sum = 0;
    for (let i = 0; i < size * size; i++) sum += data[c * size * size + i];
    return sum / (size * size);
  });
  const head = weights["head.weight"] as number[][],
    bias = weights["head.bias"] as number[];
  const probabilities = head.map((row, j) => {
    const logit = row.reduce((s, w, i) => s + w * mean[i], bias[j]),
      cal = cameraModel.calibration[j];
    return sigmoid(logit * cal.weight + cal.bias);
  });
  return {
    probabilities,
    durationMs: performance.now() - started,
    version: cameraModel.version,
  };
}
export function fuseCamera(
  probabilities: number[],
  sensors: number[],
  cameraQuality = 1,
  sensorQuality = 1,
) {
  const features = [...probabilities, ...sensors, cameraQuality, sensorQuality];
  return fusionModel.weights.map((row, j) =>
    sigmoid(row.reduce((s, w, i) => s + w * features[i], fusionModel.bias[j])),
  );
}
export const cameraLabels = cameraModel.labels;
