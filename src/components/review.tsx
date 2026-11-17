import {
  CheckCircle2,
  ShieldCheck,
  LockKeyhole,
  X,
  ArrowUpRight,
} from "lucide-react";
import { forbidden } from "@/forge/spec";
import type { Release, Execution } from "@/forge/records";
import { Workflow } from "./workflow";
export type ReviewTab =
  "Workflow" | "Tests" | "Permissions" | "ForgeSpec" | "Trace";
export const permissionLabels: Record<string, string> = {
  "public_web.read": "Read public job data",
  "personal_resume.read": "Read the demo resume",
  "documents.write": "Save cover-letter documents",
  "notifications.write": "Deliver simulator notifications",
};
export function CapabilityReview({
  release,
  tab,
  execution,
}: {
  release: Release;
  tab: ReviewTab;
  execution?: Execution;
}) {
  if (tab === "Workflow")
    return (
      <>
        <Workflow capability={release.definition} />
        <div className="build-details">
          <div>
            <span className="eyebrow">RESOLUTION</span>
            <strong>{release.resolution}</strong>
            <p>
              {release.resolution === "EXTEND"
                ? `Patching ${release.definition.parentVersion} → ${release.definition.version}`
                : "A new executable tool contract, built from trusted primitives."}
            </p>
          </div>
          <div>
            <span className="eyebrow">REUSE</span>
            <strong>
              {release.reuse?.reusedNodes.length ?? 0} nodes reused
            </strong>
            <p>
              {release.reuse?.newNodes ?? release.definition.nodes.length} new
              workflow nodes ·{" "}
              {release.reuse?.primitiveCount ?? release.definition.nodes.length}{" "}
              trusted primitives
            </p>
          </div>
        </div>
        {release.diff.addedPermissions.length > 0 && (
          <div className="info-strip">
            <LockKeyhole size={15} />{" "}
            {release.definition.parentVersion
              ? "Additional access requires your approval"
              : "Access is limited to the permissions you approve"}{" "}
            <ArrowUpRight size={15} />
          </div>
        )}
      </>
    );
  if (tab === "Tests")
    return (
      <div className="test-list">
        <div className="test-heading">
          <ShieldCheck size={23} />
          <div>
            <strong>
              {release.report.checks.filter((c) => c.passed).length} /{" "}
              {release.report.checks.length} checks passed
            </strong>
            <p>Executed against real runtime and broker boundaries.</p>
          </div>
        </div>
        {release.report.checks
          .filter((check) => check.evidence)
          .map((check) => (
            <div
              className="attack-evidence"
              key={check.name}
              data-testid="attack-evidence"
            >
              <span className="eyebrow">EXECUTED RED-TEAM PROBE</span>
              <blockquote>{check.evidence!.untrustedContent}</blockquote>
              <p>Attempted broker operation</p>
              <code>{check.evidence!.attemptedOperation}</code>
              <strong>{check.passed ? "BLOCKED" : "CHECK FAILED"}</strong>
              <p>
                {check.evidence!.error} · {check.evidence!.permissionDenials}{" "}
                recorded denial
              </p>
              <small>
                Hostile content executed as data. A separate adversarial probe
                attempted the forbidden operation against the same broker.
              </small>
            </div>
          ))}
        {release.report.checks.map((check) => (
          <details
            key={check.name}
            className={check.passed ? "check-row" : "check-row failed"}
          >
            <summary>
              <CheckCircle2 size={15} />
              <span>{check.name}</span>
              <small>
                {check.category === "security"
                  ? "RED TEAM"
                  : `${check.durationMs} ms`}
              </small>
            </summary>
            <p>{check.details}</p>
          </details>
        ))}
      </div>
    );
  if (tab === "Permissions")
    return (
      <div className="permissions">
        <h3>Just enough access.</h3>
        <p>
          Every permission is derived from the workflow and enforced by the
          broker. Notifications and documents are saved locally in this demo.
        </p>
        <span className="eyebrow">CAN</span>
        {release.definition.permissions.map((permission) => (
          <div className="permission-row" key={permission}>
            <CheckCircle2 size={16} />
            <div>
              {permissionLabels[permission] ?? permission}
              <code>{permission}</code>
            </div>
            {release.diff.addedPermissions.includes(permission) &&
              release.definition.parentVersion && (
                <span className="chip">NEW</span>
              )}
          </div>
        ))}
        <span className="eyebrow cannot">CANNOT</span>
        {forbidden.map((permission) => (
          <div className="denied-row" key={permission}>
            <X size={14} />
            <code>{permission}</code>
          </div>
        ))}
        <div className="info-strip">
          <LockKeyhole size={16} /> No raw credentials enter the execution
          worker.
        </div>
      </div>
    );
  if (tab === "ForgeSpec")
    return (
      <div className="artifact">
        <div className="artifact-bar">
          {release.definition.toolContract.name}.forgespec.json{" "}
          <span>SHA-256 {release.digest.slice(0, 12)}</span>
        </div>
        <pre>{release.artifacts.program}</pre>
      </div>
    );
  if (!execution)
    return (
      <div className="empty-tab">
        <span>01 / EXECUTE</span>
        <h3>The trace starts with a call.</h3>
        <p>
          Approve this tool, then invoke it through MCP to inspect the actual
          execution.
        </p>
      </div>
    );
  return (
    <div className="trace">
      <div className="trace-header">
        <span
          className={
            execution.status === "success" ? "status-pill" : "status-pill error"
          }
        >
          {execution.status}
        </span>
        <code>{execution.id.slice(0, 8)}</code>
        <span>
          {execution.latencyMs} ms · {execution.sandbox} sandbox
        </span>
      </div>
      {execution.trace.map((step, i) => (
        <div className="trace-row" key={`${step.nodeId}-${i}`}>
          <span className="trace-number">{String(i + 1).padStart(2, "0")}</span>
          <div>
            <strong>{step.operation}</strong>
            <p>
              {step.permission ?? "Pure computation"} · {step.status} ·{" "}
              {step.latencyMs} ms
              {step.attempts > 1 ? ` · attempt ${step.attempts}` : ""}
            </p>
            {step.error && <p className="error-text">{step.error}</p>}
          </div>
        </div>
      ))}
      <details>
        <summary>Inspect lifecycle events and selected version</summary>
        <p>
          {execution.capabilityId} · v{execution.version} · event{" "}
          {execution.eventId}
        </p>
        {execution.events?.map((event, i) => (
          <p key={i}>
            <code>
              {event.at} {event.event}
            </code>
            <br />
            {event.details}
          </p>
        ))}
      </details>
      <details>
        <summary>Inspect execution outputs</summary>
        <pre>{JSON.stringify(execution.outcome, null, 2)}</pre>
      </details>
    </div>
  );
}
