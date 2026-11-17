# Alexa+-style simulator scope

Checked on 2026-10-06 against the [official rules](https://amazonappdev2026.devpost.com/rules) and [organizer FAQ](https://amazonappdev2026.devpost.com/details/faqs): the self-hosted MCP route requires minimum `2025-11-25`; entrants may demonstrate their own web simulator. Amazon's SDK, MCP Toolkit, CLI and Web Simulator are partner preview tools unavailable through the hackathon. They are not required for this submission path.

FORGE's independently branded **Alexa+-style Agent Simulator** is a real browser MCP client. It initializes through Streamable HTTP, lists tools, calls forge.build, presents owner approval through a separate API, rediscovers the new tool, and calls it through MCP. It does not copy Amazon branding or claim certification, endorsement or a native device connection.

Verified sequence: T0 absence → proposal/tests → owner approval → T1 discovery → invocation → extension → rollback. `artifacts/http-proof.json` records protocol, tool lists, execution, compilation usage and real broker denial evidence, with `nativeAlexaClientVerified=false`. [Protocol evidence](MCP.md) · [Verification](VERIFICATION.md).

## Future native onboarding

Native integration would require authorized partner access, HTTPS, actual client authentication, separate owner identity, deployment, measured latency, and client-produced evidence. Amazon's [documented client lifecycle](https://www.developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-client-lifecycle.html) refreshes changed registrations through deployment; immediate native hot discovery is not claimed. Its older example protocol does not replace the hackathon's current minimum. These future requirements are outside the permitted self-hosted MCP plus simulator demonstration.
