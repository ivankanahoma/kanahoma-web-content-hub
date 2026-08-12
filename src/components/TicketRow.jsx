import { useEffect, useState } from "react";
import {
  Copy,
  ExternalLink,
  Sparkles,
  User,
  UserCheck,
  UserPlus,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { invokeFunction } from "../lib/invoke";
import {
  COMPLEXITY_LABEL,
  DUE_KIND_LABEL,
  EFFORT_LABEL,
  STALLED_ACTIONS,
  dueParts,
  zendeskUrl,
} from "../lib/queue";
import { formatDate, formatDue, pluralDays } from "../lib/format";

function Pill({ icon: Icon, children, tone = "" }) {
  return (
    <span className={`pill ${tone}`}>
      {Icon && <Icon size={12} strokeWidth={2} />}
      {children}
    </span>
  );
}

export default function TicketRow({
  ticket, subdomain, canEdit, onChanged, expanded, onToggle, agents = [],
}) {
  const { commitment, sla } = dueParts(ticket);
  const due = commitment ? formatDue(commitment.hours) : null;
  const slaDue = !commitment && sla ? formatDue(sla.hours) : null;
  const stalled = STALLED_ACTIONS[ticket.stalled_action];
  const waitingOnUs = ticket.waiting_on === "us";

  const [draft, setDraft] = useState(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [etaValue, setEtaValue] = useState(ticket.eta_date ?? "");
  const [etaBusy, setEtaBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState(null);
  const [assignBusy, setAssignBusy] = useState(false);
  const [picking, setPicking] = useState(false);

  // Only fetch a stored draft once the row is actually opened.
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    supabase
      .from("ticket_drafts").select("*").eq("ticket_id", ticket.id).maybeSingle()
      .then(({ data }) => { if (!cancelled) setDraft(data ?? null); });
    return () => { cancelled = true; };
  }, [expanded, ticket.id]);

  useEffect(() => { setEtaValue(ticket.eta_date ?? ""); }, [ticket.eta_date]);

  async function generateDraft() {
    setDraftBusy(true);
    setProblem(null);
    try {
      const data = await invokeFunction("draft-reply", { ticket_id: ticket.id });
      setDraft({ ...data, generated_at: new Date().toISOString() });
    } catch (e) {
      setProblem(e.message);
    }
    setDraftBusy(false);
  }

  async function saveEta() {
    if (!etaValue) return;
    setEtaBusy(true);
    setProblem(null);
    const { error } = await supabase.from("ticket_etas").insert({
      ticket_id: ticket.id,
      eta_date: etaValue,
      is_fuzzy: false,
      source: "manual",
    });
    if (error) setProblem(error.message);
    else await onChanged?.();
    setEtaBusy(false);
  }

  /**
   * The one thing the hub writes back to Zendesk. Nothing is updated locally on the way
   * out: the queue reloads from what Zendesk actually accepted, so a refused change
   * cannot leave the row claiming an owner it does not have.
   */
  async function assignTo(value) {
    setAssignBusy(true);
    setProblem(null);
    try {
      setPicking(false);
      await invokeFunction("assign-ticket", {
        ticket_id: ticket.id,
        assignee_id: value === "" ? null : Number(value),
      });
      await onChanged?.();
    } catch (e) {
      setProblem(e.message);
    }
    setAssignBusy(false);
  }

  async function copyDraft() {
    await navigator.clipboard.writeText(draft.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <article
      className={[
        "ticket",
        expanded ? "expanded" : "",
        ticket.critical_impact
          ? "accent-critical"
          : (due?.overdue || slaDue?.overdue) ? "accent-overdue" : "",
      ].filter(Boolean).join(" ")}
    >
      <div
        className="ticket-head"
        onClick={onToggle}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <div className="ticket-main">
          <h3 className="ticket-title">
            <a
              className="ticket-id"
              href={zendeskUrl(subdomain, ticket.id)}
              target="_blank"
              rel="noreferrer noopener"
              // The row toggles on click, so the link has to stop the event reaching it.
              onClick={(e) => e.stopPropagation()}
              title="Open in Zendesk"
            >
              #{ticket.id}
            </a>
            {ticket.subject || "(no subject)"}
          </h3>

          {ticket.summary && <p className="ticket-summary">{ticket.summary}</p>}

          <div className="ticket-facts">
            {/* First in the row and the only solid dark chip, because "can I act on
                this right now?" is the question being scanned for. */}
            {waitingOnUs ? (
              <span className="waiting on-us">Waiting on us</span>
            ) : (
              <span className="waiting on-them">
                Waiting on them
                <span className="waiting-detail">
                  quiet {ticket.business_days_since_last_comment}d
                </span>
              </span>
            )}

            {/* No answered badge here on purpose: the waiting chip above already says it.
                It earns its place in Recent activity, which has no waiting chip. */}
            {ticket.critical_impact && <span className="tag critical">Critical</span>}
            {ticket.reopened && (
              <span
                className="tag reopened"
                title={`Solved and reopened ${ticket.reopens} ` +
                  `time${ticket.reopens === 1 ? "" : "s"}`}
              >
                Reopened
              </span>
            )}
            {ticket.is_vip && <span className="tag vip">VIP</span>}
            {stalled && (
              <span
                className={`tag ${ticket.stalled_action === "flag_george" ? "critical" : "warn"}`}
                title={stalled.hint}
              >
                {stalled.label}
              </span>
            )}
            {ticket.requested_pre_launch && (
              <span
                className="tag prelaunch"
                title="Filed before cui.edu went live on Aug 5, 2026"
              >
                Requested pre-launch
              </span>
            )}
            {ticket.complexity && (
              <span className="tag quiet">
                {COMPLEXITY_LABEL[ticket.complexity]} · {EFFORT_LABEL[ticket.effort]}
              </span>
            )}

            {/* The requester's name only earns a chip when it changes what you do. */}
            {ticket.is_vip && <Pill icon={User}>{ticket.requester_name || "unknown"}</Pill>}

            {/* Ownership sits in the row rather than behind an expand, because an
                unowned ticket is a thing to fix while scanning, not while reading. */}
            {picking ? (
              <select
                className="assignee-select inline"
                autoFocus
                value={ticket.assignee_id ?? ""}
                disabled={assignBusy}
                onClick={(e) => e.stopPropagation()}
                onBlur={() => setPicking(false)}
                onChange={(e) => { e.stopPropagation(); assignTo(e.target.value); }}
                aria-label="Assign this ticket"
              >
                <option value="">Unassigned</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            ) : canEdit ? (
              <button
                className={`pill as-button ${ticket.assignee_name ? "assignee" : "unassigned"}`}
                onClick={(e) => { e.stopPropagation(); setPicking(true); }}
                disabled={assignBusy}
                title="Assign this ticket in Zendesk"
              >
                {ticket.assignee_name ? <UserCheck size={12} strokeWidth={2} />
                                      : <UserPlus size={12} strokeWidth={2} />}
                {assignBusy ? "Saving…" : ticket.assignee_name ?? "Unassigned"}
              </button>
            ) : ticket.assignee_name ? (
              <Pill icon={UserCheck} tone="assignee">{ticket.assignee_name}</Pill>
            ) : (
              <Pill icon={UserPlus} tone="unassigned">Unassigned</Pill>
            )}
          </div>
        </div>

        {/* A date somebody named out loud outranks a clock the hub computed, so a
            commitment takes the strong block and the reply SLA drops to a footnote
            underneath it. Rendering both the same way made every unanswered ticket
            read as a broken promise. */}
        {(due || slaDue) && (
          <div className="ticket-rail">
            {due && (
              <div className={`ticket-due commitment ${due.overdue ? "overdue" : ""}`}>
                <span className="due-value">
                  {due.value}<span className="due-unit">{due.unit}</span>
                </span>
                <span className="due-state">{due.overdue ? "overdue" : "left"}</span>
                <span className="due-kind">{DUE_KIND_LABEL[commitment.kind]}</span>
                {commitment.date && (
                  <span className="due-date">{formatDate(commitment.date)}</span>
                )}
              </div>
            )}

            {due && sla && (
              <span className={`sla-note ${sla.hours < 0 ? "overdue" : ""}`}>
                first reply {sla.hours < 0 ? "overdue" : `in ${Math.round(sla.hours)}h`}
              </span>
            )}

            {slaDue && (
              <div className={`ticket-due sla ${slaDue.overdue ? "overdue" : ""}`}>
                <span className="due-value">
                  {slaDue.value}<span className="due-unit">{slaDue.unit}</span>
                </span>
                <span className="due-state">{slaDue.overdue ? "overdue" : "left"}</span>
                <span className="due-kind">first reply due</span>
              </div>
            )}
          </div>
        )}
      </div>

      {expanded && (
        <div className="ticket-detail">
          <dl>
            {ticket.critical_impact_reason && (
              <div className="wide">
                <dt>Why critical</dt>
                <dd>{ticket.critical_impact_reason}</dd>
              </div>
            )}

            {ticket.requester_deadline && (
              <div>
                <dt>Requester deadline</dt>
                <dd>
                  {formatDate(ticket.requester_deadline)}
                  {ticket.requester_deadline_fuzzy && " · approximate"}
                </dd>
              </div>
            )}

            <div>
              <dt>ETA we promised</dt>
              <dd>
                {ticket.eta_date
                  ? `${formatDate(ticket.eta_date)}${ticket.eta_is_fuzzy ? " · approximate" : ""}`
                  : "none"}
                {canEdit && (
                  <div className="eta-edit">
                    <input
                      type="date"
                      value={etaValue}
                      onChange={(e) => setEtaValue(e.target.value)}
                      aria-label="Set ETA"
                    />
                    <button
                      className="button ghost"
                      onClick={saveEta}
                      disabled={etaBusy || !etaValue || etaValue === ticket.eta_date}
                    >
                      {etaBusy ? "Saving…" : "Set"}
                    </button>
                  </div>
                )}
              </dd>
            </div>

            {ticket.tone_urgency_reason && (
              <div>
                <dt>Tone {ticket.tone_urgency}/3</dt>
                <dd>{ticket.tone_urgency_reason}</dd>
              </div>
            )}

            {stalled && (
              <div>
                <dt>{stalled.label}</dt>
                <dd>{stalled.hint}</dd>
              </div>
            )}

            <div>
              <dt>Requester</dt>
              <dd>{ticket.requester_name || "unknown"}</dd>
            </div>

            <div>
              <dt>Thread</dt>
              <dd>
                {ticket.status} · {pluralDays(ticket.age_days)} old ·{" "}
                {ticket.public_comment_count} public comments
                {ticket.reopens > 0 &&
                  ` · reopened ${ticket.reopens}×`}
                {ticket.trailing_agent_messages > 1 &&
                  ` · ${ticket.trailing_agent_messages} unanswered from us`}
              </dd>
            </div>

            {ticket.override_note && (
              <div className="wide">
                <dt>Note</dt>
                <dd>{ticket.override_note}</dd>
              </div>
            )}

          </dl>

          {draft && (
            <div className="draft">
              <span className="draft-label">Draft reply — edit before sending</span>
              <pre>{draft.body}</pre>
              <div className="ticket-actions">
                <button className="button ghost" onClick={copyDraft}>
                  <Copy size={14} /> {copied ? "Copied" : "Copy"}
                </button>
                <button className="button ghost" onClick={generateDraft} disabled={draftBusy}>
                  {draftBusy ? "Rewriting…" : "Rewrite"}
                </button>
              </div>
            </div>
          )}

          {problem && <p className="inline-error">{problem}</p>}

          <div className="ticket-actions">
            <a
              className="button"
              href={zendeskUrl(subdomain, ticket.id)}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open in Zendesk <ExternalLink size={14} />
            </a>
            {canEdit && !draft && (
              <button className="button ghost" onClick={generateDraft} disabled={draftBusy}>
                <Sparkles size={14} /> {draftBusy ? "Writing…" : "Draft a reply"}
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
