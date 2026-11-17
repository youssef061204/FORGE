import type { Capability } from "@/forge/spec";

export function Workflow({ capability }: { capability: Capability }) {
  const levels = new Map<string, number>();
  const level = (id: string): number => {
    if (levels.has(id)) return levels.get(id)!;
    const node = capability.nodes.find((n) => n.id === id)!;
    const result = node.dependsOn.length
      ? Math.max(...node.dependsOn.map(level)) + 1
      : 0;
    levels.set(id, result);
    return result;
  };
  capability.nodes.forEach((n) => level(n.id));
  const max = Math.max(...levels.values());
  const position = (id: string) => {
    const depth = levels.get(id)!;
    const peers = capability.nodes.filter((n) => levels.get(n.id) === depth);
    return {
      x: 28 + depth * 154,
      y:
        135 +
        (peers.findIndex((n) => n.id === id) - (peers.length - 1) / 2) * 112,
    };
  };
  return (
    <div className="graph-canvas">
      <div className="canvas-label">
        <span className="live-dot" /> GENERATED WORKFLOW{" "}
        <span>{capability.nodes.length} nodes · acyclic</span>
      </div>
      <svg
        viewBox={`0 0 ${max * 154 + 194} 318`}
        role="img"
        aria-label={`${capability.name} workflow with ${capability.nodes.length} nodes`}
      >
        <defs>
          <marker
            id="arrow"
            markerWidth="6"
            markerHeight="6"
            refX="5"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L6,3 L0,6" fill="#69746e" />
          </marker>
        </defs>
        {capability.edges.map((edge) => {
          const a = position(edge.from),
            b = position(edge.to);
          return (
            <path
              key={`${edge.from}-${edge.to}`}
              d={`M${a.x + 128},${a.y + 35} C${a.x + 150},${a.y + 35} ${b.x - 22},${b.y + 35} ${b.x},${b.y + 35}`}
              stroke="#48504a"
              strokeWidth="1.5"
              fill="none"
              markerEnd="url(#arrow)"
            />
          );
        })}
        {capability.nodes.map((node, i) => {
          const p = position(node.id);
          const words = node.label.split(" ");
          const lines: string[] = [""];
          for (const word of words) {
            if (lines.at(-1)!.length + word.length > 19) lines.push(word);
            else lines[lines.length - 1] += `${lines.at(-1) ? " " : ""}${word}`;
          }
          return (
            <g key={node.id} transform={`translate(${p.x},${p.y})`}>
              <rect
                width="128"
                height="72"
                rx="9"
                fill="#1b211d"
                stroke={
                  node.operation === "threshold.check" ? "#b78e49" : "#3b443c"
                }
              />
              <text
                x="12"
                y="19"
                fontSize="9"
                fill="#b7a27b"
                fontFamily="monospace"
              >
                {String(i + 1).padStart(2, "0")} /{" "}
                {node.operation.split(".")[0].toUpperCase()}
              </text>
              {lines.slice(0, 2).map((line, j) => (
                <text
                  key={j}
                  x="12"
                  y={39 + j * 14}
                  fontSize="10"
                  fill="#e7e9e2"
                >
                  {line}
                </text>
              ))}
            </g>
          );
        })}
      </svg>
      <div className="canvas-footer">
        <span>ForgeSpec / 1.0</span>
        <span>Permission broker on every call ↗</span>
      </div>
    </div>
  );
}
