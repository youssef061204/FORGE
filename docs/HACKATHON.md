# Submission support

## Project description

FORGE is a self-hosted MCP server that safely grows its own toolset. A user describes a missing ability. FORGE resolves existing capabilities, compiles a constrained workflow and MCP tool contract, derives exact permissions, executes behavior and adversarial checks, and requests owner approval. Once installed, the new named tool appears through MCP tools/list and executes through tools/call with brokered permissions and an auditable trace. Extensions produce tested versions and request additional minimum access. Our independent Alexa+-style simulator is the real MCP client; official Amazon private preview tooling is not used.

## Track alignment

Primary: self-hosted MCP 2025-11-25 over Streamable HTTP, demonstrated in independent Studio and World clients. AWS supporting evidence: genuine Bedrock compilation, validated installation and MCP execution passed for both Internship Scout and Leaving Home using profile `forge` and region `ca-central-1`; see [executed verification](VERIFICATION.md). Other AWS adapters have contract tests but no live deployment proof. Open Source supporting component: MIT ForgeSpec schema/validator/contracts/example; publication and a contribution URL remain outstanding. No native Alexa connection or cloud deployment is claimed.

The organizer's [FAQ](https://amazonappdev2026.devpost.com/details/faqs) states that participants can build a self-hosted MCP server or Agent Skill and demonstrate through their own simulator; preview Alexa tools are unavailable to participants. Read the current [official rules](https://amazonappdev2026.devpost.com/rules) before submission. Track/mini-challenge eligibility and required publication/contribution evidence must be confirmed by the owner.

## Ready materials

README/setup/testing instructions, architecture, threat model, security boundaries, MCP discovery proof, frozen evaluation report, real friction log, MIT license, exported ForgeSpec schema/example, three-minute script and generated browser screenshots.

FORGE World is the main visual demo: an original five-room pixel-style apartment driven by real approved MCP execution. Show Leaving Home, the blocked delivery unlock attempt, night arrival, v1.1.0 and rollback. Studio preserves career and household generality. [175-second recording script](DEMO.md) · [World architecture and limits](WORLD.md).

## Outstanding submission steps

Create/push a public repository; owner review of license and submission text; record/edit/upload the demo video; complete Devpost fields; supply any mini-challenge-specific Builder/profile or open-source contribution evidence. Bedrock compilation has live evidence; optional supporting services remain undeployed. No repository publication or submission was performed automatically.

## Product feedback grounded in development

The friction log contains actual Next/SDK/dependency/preview issues. No fictional AWS or Alexa preview usage is included. Amazon now documents deployment-bound tool refresh. A useful product request is an authenticated discovery refresh mechanism after owner-approved capability installation, so operators can update tool registrations without a full add-on redeploy. This is a design recommendation based on the documented lifecycle, not an observed native client failure.
