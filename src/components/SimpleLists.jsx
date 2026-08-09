import { useMemo, useState } from "react";
import { ExternalLink, Star, Trash2, UserCheck } from "lucide-react";
import { zendeskUrl } from "../lib/queue";
import { formatDate } from "../lib/format";

export function SectionIntro({ section }) {
  if (!section?.blurb) return null;
  return <p className="section-intro">{section.blurb}</p>;
}

export function RecentlyResolved({ rows, subdomain }) {
  if (!rows?.length) return <div className="state">Nothing resolved in the last 7 days.</div>;
  return (
    <div className="plain-list">
      {rows.map((r) => (
        <div className="plain-row" key={r.id}>
          <span className="id">#{r.id}</span>
          <span className="grow">{r.subject || "(no subject)"}</span>
          <span className="muted">{r.requester_name}</span>
          <span className="pill">
            <UserCheck size={12} strokeWidth={2} />
            {r.assignee_name ?? "unassigned"}
          </span>
          <span className="muted">{formatDate(r.solved_at)}</span>
          <a href={zendeskUrl(subdomain, r.id)} target="_blank" rel="noreferrer noopener">
            <ExternalLink size={14} />
          </a>
        </div>
      ))}
    </div>
  );
}

export function SpamList({ rows, subdomain }) {
  if (!rows?.length) return <div className="state">Nothing filtered out right now.</div>;
  return (
    <div className="plain-list">
      {rows.map((r) => (
        <div className="plain-row" key={r.id}>
          <span className="id">#{r.id}</span>
          <span className="grow">{r.subject || "(no subject)"}</span>
          <span className="muted">{r.requester_email}</span>
          <span className="muted">{formatDate(r.zendesk_created_at)}</span>
          <a href={zendeskUrl(subdomain, r.id)} target="_blank" rel="noreferrer noopener">
            <ExternalLink size={14} />
          </a>
        </div>
      ))}
    </div>
  );
}

/** VIP is a hub-side judgement, so it is edited here rather than mirrored from Zendesk. */
export function Requesters({ rows, canEdit, onToggleVip, busyId }) {
  const [term, setTerm] = useState("");

  const shown = useMemo(() => {
    const needle = term.trim().toLowerCase();
    const filtered = needle
      ? rows.filter((r) =>
          [r.name, r.email].filter(Boolean).some((f) => f.toLowerCase().includes(needle)))
      : rows;

    return [...filtered].sort((a, b) => {
      if (a.is_vip !== b.is_vip) return a.is_vip ? -1 : 1;
      return (a.name ?? "").localeCompare(b.name ?? "");
    });
  }, [rows, term]);

  return (
    <>
      <div className="list-toolbar">
        <input
          className="search"
          placeholder="Search name or email…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        <span className="count-note">
          {shown.length} of {rows.length}
          {rows.some((r) => r.is_vip) &&
            ` · ${rows.filter((r) => r.is_vip).length} VIP`}
        </span>
      </div>

      {!shown.length ? (
        <div className="state">No requesters match that search.</div>
      ) : (
        <div className="plain-list">
          {shown.map((r) => (
            <div className={`plain-row ${r.is_vip ? "starred" : ""}`} key={r.id}>
              <button
                className="star"
                onClick={() => onToggleVip(r)}
                disabled={!canEdit || busyId === r.id}
                title={
                  canEdit
                    ? (r.is_vip ? "Remove VIP" : "Mark as VIP")
                    : "Only admins and managers can change this"
                }
                aria-pressed={r.is_vip}
                aria-label={r.is_vip ? `Remove VIP from ${r.name}` : `Mark ${r.name} as VIP`}
              >
                <Star size={15} fill={r.is_vip ? "currentColor" : "none"} strokeWidth={1.75} />
              </button>
              <span className="grow">{r.name || "(unnamed)"}</span>
              <span className="muted">{r.email}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Keyword rules are evaluated by the ticket_queue view at read time, so adding or
 * removing one re-ranks the queue immediately without re-running any analysis.
 */
export function UrgencyKeywords({ rows, canEdit, onAdd, onDelete, busy }) {
  const [pattern, setPattern] = useState("");
  const [label, setLabel] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (!pattern.trim() || !label.trim()) return;
    await onAdd({ pattern: pattern.trim(), label: label.trim() });
    setPattern("");
    setLabel("");
  }

  return (
    <>
      {canEdit && (
        <form className="inline-form" onSubmit={submit}>
          <input
            placeholder="Keyword or phrase"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            aria-label="Keyword or phrase"
          />
          <input
            placeholder="Why it matters"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            aria-label="Why it matters"
          />
          <button className="button" type="submit" disabled={busy}>
            Add rule
          </button>
        </form>
      )}

      {!rows.length ? (
        <div className="state">
          No keyword rules. Urgency is entirely the model's call right now.
        </div>
      ) : (
        <div className="plain-list">
          {rows.map((r) => (
            <div className="plain-row" key={r.id}>
              <span className="grow"><strong>{r.pattern}</strong></span>
              <span className="muted">{r.label}</span>
              {canEdit && (
                <button
                  className="row-delete"
                  onClick={() => onDelete(r)}
                  aria-label={`Delete rule ${r.pattern}`}
                  title="Delete rule"
                >
                  <Trash2 size={15} strokeWidth={1.75} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
