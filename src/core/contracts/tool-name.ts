/** The MCP name of an installed tool: same rule on the server, in the tour and in docs. */
export function mcpToolName(title: string, id: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return `${slug || "tool"}_${id.replace(/[^a-z0-9]/gi, "").slice(-4).toLowerCase()}`;
}

export const STATIC_MCP_TOOLS = [
  { name: "forge_build", description: "Ask FORGE to build a missing tool from a plain-language request. Returns a review link; a person must approve it in FORGE before it can run." },
  { name: "forge_status", description: "Check the progress of a build started with forge_build." },
  { name: "forge_list", description: "List the tools this FORGE has installed, with what each may read and write." },
];
