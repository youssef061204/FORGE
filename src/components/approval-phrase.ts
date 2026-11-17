const digits: Record<string, string> = {
  zero: "0",
  oh: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};
export function approvalCode(text: string): string | undefined {
  const phrase = text.toLowerCase().trim().replace(/[.,]/g, "");
  if (!phrase.startsWith("confirm ")) return undefined;
  const tokens = phrase
    .slice(8)
    .split(/[\s-]+/)
    .filter(Boolean);
  if (
    !tokens.length ||
    tokens.some((t) => !/^\d+$/.test(t) && !Object.hasOwn(digits, t))
  )
    return undefined;
  const code = tokens.map((t) => digits[t] ?? t).join("");
  return /^\d{6}$/.test(code) ? code : undefined;
}
