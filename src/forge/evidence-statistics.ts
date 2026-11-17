export function failureInterval(failures: number, samples: number) {
  if (
    !Number.isInteger(samples) ||
    !Number.isInteger(failures) ||
    samples < 1 ||
    failures < 0 ||
    failures > samples
  )
    throw new Error("Invalid binomial counts");
  const z = 1.959963984540054,
    p = failures / samples,
    denominator = 1 + (z * z) / samples;
  const center = (p + (z * z) / (2 * samples)) / denominator;
  const radius =
    (z *
      Math.sqrt((p * (1 - p)) / samples + (z * z) / (4 * samples * samples))) /
    denominator;
  return {
    samples,
    failures,
    observedRate: p,
    lower: Math.max(0, center - radius),
    upper: Math.min(1, center + radius),
    confidence: 0.95,
    method: "Wilson interval; independent scenario sampling assumption",
    limitation:
      "Sample evidence is not a guarantee of safety outside the evaluated model and horizon.",
  };
}
