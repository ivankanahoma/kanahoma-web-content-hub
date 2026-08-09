import { useCallback, useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { formatDate } from "../lib/format";

const WEEKDAYS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 7, label: "Sunday" },
];

/** "17:00:00" -> "5:00 PM", without dragging a date into it. */
function prettyTime(value) {
  if (!value) return "";
  const [h, m] = value.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

export default function StudentWorkers({ clientId, canEdit }) {
  const [workers, setWorkers] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [timeOff, setTimeOff] = useState([]);
  const [events, setEvents] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState(null);

  const [shiftDraft, setShiftDraft] = useState({ weekday: 1, starts_at: "09:00", ends_at: "13:00" });
  const [offDraft, setOffDraft] = useState({ kind: "pto", starts_on: "", ends_on: "", label: "" });

  const load = useCallback(async () => {
    const [w, s, t, e] = await Promise.all([
      supabase.from("student_workers").select("*").order("full_name"),
      supabase.from("work_shifts").select("*").order("weekday").order("starts_at"),
      supabase.from("time_off").select("*").order("starts_on"),
      supabase.from("check_events").select("*").order("happened_on", { ascending: false }).limit(40),
    ]);
    setWorkers(w.data ?? []);
    setShifts(s.data ?? []);
    setTimeOff(t.data ?? []);
    setEvents(e.data ?? []);
    setSelectedId((prev) => prev ?? w.data?.[0]?.id ?? null);
    setError(w.error?.message ?? s.error?.message ?? null);
  }, []);

  useEffect(() => { load(); }, [load]);

  const selected = workers.find((w) => w.id === selectedId) ?? null;
  const myShifts = useMemo(
    () => shifts.filter((s) => s.student_worker_id === selectedId),
    [shifts, selectedId],
  );

  const today = new Date().toISOString().slice(0, 10);
  const upcomingOff = timeOff.filter((t) => t.ends_on >= today).slice(0, 25);

  async function addShift(event) {
    event.preventDefault();
    if (!selectedId) return;
    const { error } = await supabase.from("work_shifts").insert({
      student_worker_id: selectedId,
      weekday: Number(shiftDraft.weekday),
      starts_at: shiftDraft.starts_at,
      ends_at: shiftDraft.ends_at,
    });
    if (error) setError(error.message);
    else await load();
  }

  async function addTimeOff(event) {
    event.preventDefault();
    if (!offDraft.starts_on) return;
    const { error } = await supabase.from("time_off").insert({
      client_id: clientId,
      // PTO belongs to a person; a holiday applies to everyone at the client.
      student_worker_id: offDraft.kind === "holiday" ? null : selectedId,
      kind: offDraft.kind,
      starts_on: offDraft.starts_on,
      ends_on: offDraft.ends_on || offDraft.starts_on,
      label: offDraft.label || null,
    });
    if (error) setError(error.message);
    else {
      setOffDraft({ kind: "pto", starts_on: "", ends_on: "", label: "" });
      await load();
    }
  }

  async function remove(table, id) {
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) setError(error.message);
    else await load();
  }

  async function updateWorker(patch) {
    const { error } = await supabase
      .from("student_workers").update(patch).eq("id", selectedId);
    if (error) setError(error.message);
    else await load();
  }

  return (
    <>
      {error && <div className="state">Something went wrong: {error}</div>}

      <div className="state" style={{ textAlign: "left", padding: "0 0 18px" }}>
        <strong>Slack is not connected yet.</strong> Reading the check-in / check-out
        channel and posting the reminder both need an app installed in CUI's “eagles”
        workspace. Hours, time off and the log below all work without it, and the check-in
        record can be filled in by hand meanwhile.
      </div>

      <div className="list-toolbar">
        {workers.map((w) => (
          <button
            key={w.id}
            className="chip"
            aria-pressed={w.id === selectedId}
            onClick={() => setSelectedId(w.id)}
          >
            {w.full_name}
          </button>
        ))}
      </div>

      {!selected ? (
        <div className="state">No student workers yet.</div>
      ) : (
        <>
          <h3 className="block-title">Working hours — {selected.full_name}</h3>
          <p className="section-intro">
            All times are {selected.timezone.replace("America/", "").replace("_", " ")}.
            A check-in counts as late after {selected.grace_minutes} minutes.
          </p>

          {canEdit && (
            <form className="inline-form" onSubmit={addShift}>
              <select
                value={shiftDraft.weekday}
                onChange={(e) => setShiftDraft({ ...shiftDraft, weekday: e.target.value })}
                aria-label="Weekday"
              >
                {WEEKDAYS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
              <input
                type="time"
                value={shiftDraft.starts_at}
                onChange={(e) => setShiftDraft({ ...shiftDraft, starts_at: e.target.value })}
                aria-label="Starts at"
              />
              <input
                type="time"
                value={shiftDraft.ends_at}
                onChange={(e) => setShiftDraft({ ...shiftDraft, ends_at: e.target.value })}
                aria-label="Ends at"
              />
              <button className="button" type="submit">Add shift</button>
            </form>
          )}

          {!myShifts.length ? (
            <div className="state">
              No hours set. Without them the hub cannot tell a missed check-in from a day
              off, so nothing is monitored yet.
            </div>
          ) : (
            <div className="plain-list">
              {myShifts.map((s) => (
                <div className="plain-row" key={s.id}>
                  <span className="grow">
                    {WEEKDAYS.find((d) => d.value === s.weekday)?.label}
                  </span>
                  <span className="muted">
                    {prettyTime(s.starts_at)} – {prettyTime(s.ends_at)}
                  </span>
                  {canEdit && (
                    <button
                      className="row-delete"
                      onClick={() => remove("work_shifts", s.id)}
                      aria-label="Delete shift"
                    >
                      <Trash2 size={15} strokeWidth={1.75} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <h3 className="block-title">Slack identity</h3>
          <div className="inline-form">
            <input
              placeholder="Slack member ID, e.g. U01ABCDEF"
              defaultValue={selected.slack_user_id ?? ""}
              disabled={!canEdit}
              aria-label="Slack member ID"
              onBlur={(e) => {
                const next = e.target.value.trim() || null;
                if (next !== (selected.slack_user_id ?? null)) {
                  updateWorker({ slack_user_id: next });
                }
              }}
            />
            <span className="count-note" style={{ marginLeft: 0 }}>
              A plain “@name” in a Slack message does not notify anyone. The member ID does.
            </span>
          </div>
        </>
      )}

      <h3 className="block-title">Time off and holidays</h3>
      <p className="section-intro">
        Days nobody is expected to check in. Seeded with US federal and California
        holidays through 2027 — delete the ones you do work.
      </p>

      {canEdit && (
        <form className="inline-form" onSubmit={addTimeOff}>
          <select
            value={offDraft.kind}
            onChange={(e) => setOffDraft({ ...offDraft, kind: e.target.value })}
            aria-label="Kind"
          >
            <option value="pto">PTO</option>
            <option value="sick">Sick</option>
            <option value="holiday">Holiday (everyone)</option>
          </select>
          <input
            type="date"
            value={offDraft.starts_on}
            onChange={(e) => setOffDraft({ ...offDraft, starts_on: e.target.value })}
            aria-label="First day"
          />
          <input
            type="date"
            value={offDraft.ends_on}
            onChange={(e) => setOffDraft({ ...offDraft, ends_on: e.target.value })}
            aria-label="Last day"
          />
          <input
            placeholder="Label (optional)"
            value={offDraft.label}
            onChange={(e) => setOffDraft({ ...offDraft, label: e.target.value })}
            aria-label="Label"
          />
          <button className="button" type="submit">Add</button>
        </form>
      )}

      <div className="plain-list">
        {upcomingOff.map((t) => (
          <div className="plain-row" key={t.id}>
            <span className="tag quiet">{t.kind}</span>
            <span className="grow">{t.label || "—"}</span>
            <span className="muted">
              {formatDate(t.starts_on)}
              {t.ends_on !== t.starts_on && ` → ${formatDate(t.ends_on)}`}
            </span>
            {canEdit && (
              <button
                className="row-delete"
                onClick={() => remove("time_off", t.id)}
                aria-label="Delete time off"
              >
                <Trash2 size={15} strokeWidth={1.75} />
              </button>
            )}
          </div>
        ))}
      </div>

      <h3 className="block-title">Check-in record</h3>
      {!events.length ? (
        <div className="state">
          Nothing recorded yet. Entries appear once working hours are set and Slack is
          connected.
        </div>
      ) : (
        <div className="plain-list">
          {events.map((e) => (
            <div className="plain-row" key={e.id}>
              <span className="muted">{formatDate(e.happened_on)}</span>
              <span className="grow">{e.kind.replace("_", " ")}</span>
              <span className={`tag ${e.status === "missed" ? "critical" : "quiet"}`}>
                {e.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
