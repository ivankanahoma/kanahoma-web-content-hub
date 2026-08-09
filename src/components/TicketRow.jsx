import { useEffect, useState } from "react";
import {
  Clock,
  Copy,
  ExternalLink,
  PauseCircle,
  Sparkles,
  User,
  UserCheck,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import {
  COMPLEXITY_LABEL,
  DUE_KIND_LABEL,
  EFFORT_LABEL,
  STALLED_ACTIONS,
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
  ticket, subdomain, canEdit, onChanged, expanded, onToggle,
}) {
  const due = formatDue(ticket.hours_to_due);
  const stalled = STALLED_ACTIONS[ticket.stalled_action];
  const waitingOnUs = ticket.waiting_on === "us";

  const [draft, setDraft] = useState(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [etaValue, setEtaValue] = useState(ticket.eta_date ?? "");
  const [etaBusy, setEtaBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState(null);

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
    const { data, error } = await supabase.functions.invoke("draft-reply", {
      body: { ticket_id: ticket.id },
    });
    if (error || data?.error) setProblem(data?.error ?? error.message);
    else setDraft({ ...data, generated_at: new Date().toISOString() });
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
        ticket.critical_impact ? "accent-critical" : due?.overdue ? "accent-overdue" : "",
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
            {ticket.critical_impact && <span className="tag critical">Critical</span>}
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

            <Pill icon={User}>{ticket.requester_name || "unknown"}</Pill>
            <Pill icon={Clock}>{pluralDays(ticket.age_days)} old</Pill>

            {waitingOnUs ? (
              <Pill tone="on-us">waiting on us</Pill>
            ) : (
              <Pill icon={PauseCircle} tone="on-them">
                quiet {ticket.business_days_since_last_comment}d · waiting on them
              </Pill>
            )}

            {ticket.assignee_name && (
              <Pill icon={UserCheck} tone="assignee">{ticket.assignee_name}</Pill>
            )}
          </div>
        </div>

        {due && (
          <div className={`ticket-due ${due.overdue ? "overdue" : ""}`}>
            <span className="due-value">
              {due.value}<span className="due-unit">{due.unit}</span>
            </span>
            <span className="due-state">{due.overdue ? "overdue" : "left"}</span>
            <span className="due-kind">{DUE_KIND_LABEL[ticket.next_due_kind]}</span>
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
              <dt>Thread</dt>
              <dd>
                {ticket.status} · {ticket.public_comment_count} public comments
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
