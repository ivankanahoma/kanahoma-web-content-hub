import { useMemo } from "react";
import { CheckCircle2, ExternalLink, User, UserCheck } from "lucide-react";
import { zendeskUrl } from "../lib/queue";
import { formatDate, formatRelative } from "../lib/format";

const LIMIT = 20;

function Block({ title, blurb, rows, empty, children }) {
  return (
    <section className="activity-block">
      <h3 className="block-title">{title}</h3>
      <p className="section-intro">{blurb}</p>
      {!rows.length ? <div className="state">{empty}</div> : children}
    </section>
  );
}

export default function RecentActivity({ activity, resolved, subdomain }) {
  const byRequester = useMemo(() =>
    (activity ?? [])
      .filter((t) => t.status !== "solved" && t.last_requester_comment_at)
      .sort((a, b) =>
        b.last_requester_comment_at.localeCompare(a.last_requester_comment_at))
      .slice(0, LIMIT),
  [activity]);

  const link = (id) => (
    <a href={zendeskUrl(subdomain, id)} target="_blank" rel="noreferrer noopener"
       aria-label={`Open ticket ${id} in Zendesk`}>
      <ExternalLink size={14} />
    </a>
  );

  if (!activity) return <div className="state">Loading…</div>;

  return (
    <>
      <Block
        title="Recently updated by requesters"
        blurb="Open tickets where the requester spoke last. These are usually waiting on us."
        rows={byRequester}
        empty="No requester replies yet."
      >
        <div className="plain-list">
          {byRequester.map((t) => (
            <div className="plain-row" key={t.id}>
              <span className="id">#{t.id}</span>
              <span className="grow">
                {t.subject}
                {t.last_requester_body && (
                  <span className="excerpt">{t.last_requester_body.slice(0, 110)}</span>
                )}
              </span>
              <span className="pill">
                <User size={12} strokeWidth={2} />
                {t.requester_name ?? "unknown"}
              </span>
              <span className="muted">{formatRelative(t.last_requester_comment_at)}</span>
              {link(t.id)}
            </div>
          ))}
        </div>
      </Block>

      <Block
        title="Recently resolved"
        blurb="Solved in the last 7 days, then dropped. Not work to do."
        rows={resolved ?? []}
        empty="Nothing resolved in the last 7 days."
      >
        <div className="plain-list">
          {(resolved ?? []).map((r) => (
            <div className="plain-row" key={r.id}>
              <CheckCircle2 size={14} strokeWidth={1.75} className="resolved-tick" />
              <span className="id">#{r.id}</span>
              <span className="grow">{r.subject || "(no subject)"}</span>
              <span className="muted">{r.requester_name}</span>
              <span className="pill">
                <UserCheck size={12} strokeWidth={2} />
                {r.assignee_name ?? "unassigned"}
              </span>
              <span className="muted">{formatDate(r.solved_at)}</span>
              {link(r.id)}
            </div>
          ))}
        </div>
      </Block>
    </>
  );
}
