import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, Clock, Inbox, MessageSquareOff } from "lucide-react";
import { sortQueue, zendeskUrl } from "../lib/queue";
import TicketRow from "./TicketRow";
import { pluralDays } from "../lib/format";

/**
 * Age bands are ordinal, not nominal: reordering them would change their meaning, so
 * they take a single-hue ramp that reads light to dark as age grows. The four steps
 * below were checked with the palette validator (monotone lightness, adjacent gaps,
 * and a light end that clears the white surface) rather than picked by eye.
 */
const AGE_BANDS = [
  { label: "0–7 days",    max: 7,        fill: "#a8b8ad" },
  { label: "8–30 days",   max: 30,       fill: "#7f948a" },
  { label: "31–90 days",  max: 90,       fill: "#566f5d" },
  { label: "Over 90 days", max: Infinity, fill: "#2f4936" },
];

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * A headline number, not a chart. The value stays in ink; a tile in a problem state
 * carries its state through a coloured rule and its label, never through the number.
 */
function Stat({ icon: Icon, label, value, hint, alarm }) {
  return (
    <div className={`stat ${alarm ? "alarm" : ""}`}>
      <div className="stat-label">
        <Icon size={13} strokeWidth={2} />
        {label}
      </div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

/** One series, so no legend: the heading names it. Every bar is directly labelled. */
function BarRow({ label, count, total, fill }) {
  const share = total ? Math.round((count / total) * 100) : 0;
  return (
    <div className="bar-row" title={`${label}: ${count} of ${total} (${share}%)`}>
      <span className="bar-label">{label}</span>
      <span className="bar-track">
        <span
          className="bar-fill"
          style={{ width: `${total ? (count / total) * 100 : 0}%`, background: fill }}
        />
      </span>
      <span className="bar-value">{count}</span>
    </div>
  );
}

export default function Leadership({
  tickets, subdomain, taggedFor, canEdit, agents, onChanged,
}) {
  const [expandedId, setExpandedId] = useState(null);
  /**
   * What has been tagged onto one person. Followers are what Zendesk's own @mentions
   * create, so this is "things somebody wanted you to see", whether the tag came from
   * the hub or from Zendesk directly.
   */
  const tagged = useMemo(() => {
    if (!taggedFor?.agentId) return [];
    return sortQueue((tickets ?? []).filter((t) =>
      (t.follower_ids ?? []).map(String).includes(String(taggedFor.agentId))));
  }, [tickets, taggedFor]);

  const m = useMemo(() => {
    const rows = tickets ?? [];
    const overdue = rows.filter((t) => t.hours_to_due != null && t.hours_to_due < 0);
    const noFirstReply = rows.filter((t) => !t.first_agent_reply_at);
    // The autoresponder promises an ETA on every ticket. These are the ones where a
    // human replied and that promise was never actually made good on.
    const repliedNoEta = rows
      .filter((t) => t.first_agent_reply_at && !t.eta_date)
      .sort((a, b) => (b.age_days ?? 0) - (a.age_days ?? 0));

    const bands = AGE_BANDS.map((band, i) => {
      const floor = i === 0 ? -Infinity : AGE_BANDS[i - 1].max;
      return {
        ...band,
        count: rows.filter((t) => (t.age_days ?? 0) > floor && (t.age_days ?? 0) <= band.max).length,
      };
    });

    const byAssignee = Object.entries(
      rows.reduce((acc, t) => {
        const key = t.assignee_name ?? "Unassigned";
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
    ).sort((a, b) => b[1] - a[1]);

    return {
      total: rows.length,
      critical: rows.filter((t) => t.critical_impact).length,
      overdue: overdue.length,
      noFirstReply,
      repliedNoEta,
      medianAge: median(rows.map((t) => t.age_days ?? 0)),
      oldest: Math.max(0, ...rows.map((t) => t.age_days ?? 0)),
      preLaunch: rows.filter((t) => t.requested_pre_launch).length,
      bands,
      byAssignee,
    };
  }, [tickets]);

  if (!tickets) return <div className="state">Loading…</div>;
  if (!tickets.length) return <div className="state">No open tickets.</div>;

  return (
    <div className="leadership">
      <div className="stat-row">
        <Stat icon={Inbox} label="Open tickets" value={m.total}
              hint={`${m.preLaunch} requested pre-launch`} />
        <Stat icon={AlertTriangle} label="Critical impact" value={m.critical}
              hint="Blocking or misleading a student" alarm={m.critical > 0} />
        <Stat icon={CalendarClock} label="Past a commitment" value={m.overdue}
              hint="A deadline or ETA already missed" alarm={m.overdue > 0} />
        <Stat icon={MessageSquareOff} label="No human reply yet" value={m.noFirstReply.length}
              hint="Only the autoresponder has answered" alarm={m.noFirstReply.length > 0} />
        <Stat icon={Clock} label="Replied, no ETA" value={m.repliedNoEta.length}
              hint="Promised an ETA, never gave one" alarm={m.repliedNoEta.length > 0} />
        <Stat icon={Clock} label="Median age" value={pluralDays(m.medianAge)}
              hint={`Oldest is ${pluralDays(m.oldest)}`} />
      </div>

      <h3 className="block-title">How long the open queue has been waiting</h3>
      <div className="chart-card">
        {m.bands.map((b) => (
          <BarRow key={b.label} label={b.label} count={b.count} total={m.total} fill={b.fill} />
        ))}
      </div>

      <h3 className="block-title">Open tickets by assignee</h3>
      <div className="chart-card">
        {m.byAssignee.map(([name, count]) => (
          <BarRow key={name} label={name} count={count} total={m.total} fill="#547059" />
        ))}
      </div>

      {taggedFor?.agentId && (
        <>
          <h3 className="block-title">
            Tagged {taggedFor.name ?? "you"}
          </h3>
          <p className="section-intro">
            Open tickets where {taggedFor.name ?? "you are"} a follower in Zendesk, which
            is what an @mention adds. Same rows as the queue, in the same order, so they
            can be opened, assigned and answered here.
          </p>
          {!tagged.length ? (
            <div className="state">Nothing tagged right now.</div>
          ) : (
            // The queue's own row, so a ticket opens, assigns and gets answered here
            // exactly as it does there. One row means one set of behaviour to learn.
            <div className="ticket-list">
              {tagged.map((t) => (
                <TicketRow
                  key={t.id}
                  ticket={t}
                  subdomain={subdomain}
                  canEdit={canEdit}
                  agents={agents}
                  onChanged={onChanged}
                  expanded={expandedId === t.id}
                  onToggle={() => setExpandedId(expandedId === t.id ? null : t.id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      <h3 className="block-title">Replied, but no ETA given</h3>
      <p className="section-intro">
        The autoresponder tells every requester they will receive an ETA. These are the
        tickets a human answered where that promise was never kept. Oldest first.
      </p>
      {!m.repliedNoEta.length ? (
        <div className="state">Every answered ticket has an ETA.</div>
      ) : (
        <div className="plain-list">
          {m.repliedNoEta.slice(0, 15).map((t) => (
            <div className="plain-row" key={t.id}>
              <span className="id">#{t.id}</span>
              <span className="grow">{t.subject}</span>
              <span className="muted">{t.requester_name}</span>
              <span className="pill">{pluralDays(t.age_days)} old</span>
              <a href={zendeskUrl(subdomain, t.id)} target="_blank" rel="noreferrer noopener"
                 aria-label={`Open ticket ${t.id} in Zendesk`}>↗</a>
            </div>
          ))}
          {m.repliedNoEta.length > 15 && (
            <div className="plain-row muted">
              and {m.repliedNoEta.length - 15} more
            </div>
          )}
        </div>
      )}
    </div>
  );
}
