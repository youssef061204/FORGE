import { createInterface } from "node:readline";

// No eval, dynamic imports, host commands or generated JS. The untrusted artifact is a bounded DSL.
const lines = createInterface({ input: process.stdin });
const pending = new Map();
let sequence = 0;
function send(value) {
  process.stdout.write(JSON.stringify(value) + "\n");
}
async function call(node, token) {
  const requestId = ++sequence;
  const result = new Promise((resolve, reject) =>
    pending.set(requestId, { resolve, reject }),
  );
  send({
    kind: "call",
    requestId,
    nodeId: node.id,
    operation: node.operation,
    token,
  });
  return result;
}
async function run({ nodes, token }) {
  const complete = new Set();
  for (let count = 0; count < nodes.length; count++) {
    const node = nodes.find(
      (n) => !complete.has(n.id) && n.dependsOn.every((id) => complete.has(id)),
    );
    if (!node) throw new Error("Invalid DAG");
    let lastError;
    for (let attempt = 0; attempt < node.maxAttempts; attempt++) {
      try {
        await call(node, token);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw lastError;
    complete.add(node.id);
  }
  send({ kind: "done" });
  lines.close();
}
lines.on("line", (line) => {
  try {
    const message = JSON.parse(line);
    if (message.kind === "start")
      run(message).catch((error) => {
        send({ kind: "error", error: error.message });
        lines.close();
      });
    else if (message.kind === "reply") {
      const handler = pending.get(message.requestId);
      pending.delete(message.requestId);
      if (!handler) return;
      if (message.error) handler.reject(new Error(message.error));
      else handler.resolve(message.value);
    }
  } catch {
    send({ kind: "error", error: "Invalid worker message" });
    lines.close();
  }
});
