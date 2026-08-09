import { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { supabase } from "../lib/supabase";
import { formatDate } from "../lib/format";

/** Days between today and a due date, in whole calendar days. Negative means overdue. */
function daysUntil(dueOn) {
  if (!dueOn) return null;
  const today = new Date();
  const todayKey = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const [y, m, d] = dueOn.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - todayKey) / 86400000);
}

export default function AsanaTasks() {
  const [tasks, setTasks] = useState(null);
  const [term, setTerm] = useState("");

  useEffect(() => {
    supabase.from("asana_tasks").select("*").then(({ data }) => setTasks(data ?? []));
  }, []);

  const shown = useMemo(() => {
    if (!tasks) return [];
    const needle = term.trim().toLowerCase();
    const filtered = needle
      ? tasks.filter((t) =>
          [t.name, ...(t.project_names ?? [])]
            .filter(Boolean)
            .some((f) => f.toLowerCase().includes(needle)))
      : tasks;

    // Dated tasks first, soonest at the top; undated fall to the bottom.
    return [...filtered].sort((a, b) => {
      if (!a.due_on && !b.due_on) return (a.name ?? "").localeCompare(b.name ?? "");
      if (!a.due_on) return 1;
      if (!b.due_on) return -1;
      return a.due_on.localeCompare(b.due_on);
    });
  }, [tasks, term]);

  if (tasks === null) return <div className="state">Loading tasks…</div>;

  if (!tasks.length) {
    return (
      <div className="state">
        No Asana tasks mirrored yet. This fills in once <code>ASANA_TOKEN</code> is set as
        an Edge Function secret and the sync runs.
      </div>
    );
  }

  return (
    <>
      <div className="list-toolbar">
        <input
          className="search"
          placeholder="Search task or project…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        <span className="count-note">{shown.length} of {tasks.length}</span>
      </div>

      <div className="plain-list">
        {shown.map((t) => {
          const left = daysUntil(t.due_on);
          return (
            <div className="plain-row" key={t.gid}>
              <span className="grow">
                {t.name}
                {t.project_names?.length > 0 && (
                  <span className="muted"> · {t.project_names.join(", ")}</span>
                )}
              </span>

              {t.due_on && (
                <span className={`tag ${left < 0 ? "critical" : left <= 2 ? "warn" : "quiet"}`}>
                  {left < 0
                    ? `${Math.abs(left)}d overdue`
                    : left === 0 ? "today" : `${left}d left`}
                </span>
              )}
              <span className="muted">{formatDate(t.due_on) ?? "no due date"}</span>

              {t.permalink_url && (
                <a href={t.permalink_url} target="_blank" rel="noreferrer noopener"
                   aria-label={`Open ${t.name} in Asana`}>
                  <ExternalLink size={14} />
                </a>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
