import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./lib/supabase";
import { TIERS, sortQueue } from "./lib/queue";
import { SECTIONS, SECTION_BY_ID } from "./lib/sections";
import Login from "./components/Login";
import Clocks from "./components/Clocks";
import Sidebar from "./components/Sidebar";
import TicketRow from "./components/TicketRow";
import StudentWorkers from "./components/StudentWorkers";
import Leadership from "./components/Leadership";
import AsanaTasks from "./components/AsanaTasks";
import {
  RecentlyResolved,
  Requesters,
  SectionIntro,
  SpamList,
  UrgencyKeywords,
} from "./components/SimpleLists";
import bug from "./assets/kanahoma-bug-green.png";
import wordmark from "./assets/kanahoma-wordmark-green.png";

const COLLAPSED_KEY = "hub.sidebarCollapsed";

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [profile, setProfile] = useState(null);
  const [client, setClient] = useState(null);
  const [tickets, setTickets] = useState(null);
  const [resolved, setResolved] = useState([]);
  const [spam, setSpam] = useState([]);
  const [requesters, setRequesters] = useState([]);
  const [keywords, setKeywords] = useState([]);
  const [asanaCount, setAsanaCount] = useState(0);
  const [error, setError] = useState(null);

  const [section, setSection] = useState("queue");
  const landedRef = useRef(false);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSED_KEY) === "1",
  );
  const [search, setSearch] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [waitingFilter, setWaitingFilter] = useState(null); // null | us | them
  const [expandedId, setExpandedId] = useState(null);
  const [myAgentId, setMyAgentId] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) =>
      setSession(next ?? null),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  const reloadQueue = useCallback(async () => {
    const { data } = await supabase.from("ticket_queue").select("*");
    setTickets(data ?? []);
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    (async () => {
      const [me, clientRow, queue, agents, done, junk, people, rules, asana] =
        await Promise.all([
        supabase.from("app_users").select("*").eq("id", session.user.id).maybeSingle(),
        supabase.from("clients").select("*").eq("slug", "cui").maybeSingle(),
        supabase.from("ticket_queue").select("*"),
        supabase.from("zendesk_agents").select("id, email"),
        supabase.from("recently_resolved").select("*"),
        supabase.from("spam_tickets").select("*"),
        // The directory view applies the same domain allowlist as the queue, so spam
        // senders are not offered as people you could flag as VIP.
        supabase.from("requester_directory").select("id, name, email, is_vip"),
        supabase.from("urgency_rules").select("*").order("created_at"),
        supabase.from("asana_tasks").select("gid"),
      ]);
      if (cancelled) return;

      const failure = me.error || clientRow.error || queue.error;
      if (failure) setError(failure.message);

      setProfile(me.data);
      setClient(clientRow.data);
      setTickets(queue.data ?? []);
      setResolved(done.data ?? []);
      setSpam(junk.data ?? []);
      setRequesters(people.data ?? []);
      setKeywords(rules.data ?? []);
      setAsanaCount(asana.data?.length ?? 0);
      setMyAgentId(
        (agents.data ?? []).find(
          (a) => a.email?.toLowerCase() === session.user.email?.toLowerCase(),
        )?.id ?? null,
      );
    })();

    return () => { cancelled = true; };
  }, [session]);

  const canEdit = profile?.role === "admin" || profile?.role === "manager";

  useEffect(() => {
    if (landedRef.current || !profile) return;
    landedRef.current = true;
    if (profile.role === "manager") setSection("leadership");
  }, [profile]);

  const toggleVip = useCallback(async (requester) => {
    setBusyId(requester.id);
    const next = !requester.is_vip;
    const { error } = await supabase
      .from("requesters").update({ is_vip: next }).eq("id", requester.id);

    if (error) setError(error.message);
    else {
      setRequesters((rows) =>
        rows.map((r) => (r.id === requester.id ? { ...r, is_vip: next } : r)));
      await reloadQueue(); // VIP feeds the ranking, so the queue has to follow at once.
    }
    setBusyId(null);
  }, [reloadQueue]);

  const addKeyword = useCallback(async ({ pattern, label }) => {
    setBusyId("keyword");
    const { data, error } = await supabase
      .from("urgency_rules")
      .insert({ client_id: client.id, pattern, label, match_type: "keyword" })
      .select()
      .single();

    if (error) setError(error.message);
    else {
      setKeywords((rows) => [...rows, data]);
      await reloadQueue();
    }
    setBusyId(null);
  }, [client, reloadQueue]);

  const deleteKeyword = useCallback(async (rule) => {
    const { error } = await supabase.from("urgency_rules").delete().eq("id", rule.id);
    if (error) setError(error.message);
    else {
      setKeywords((rows) => rows.filter((r) => r.id !== rule.id));
      await reloadQueue();
    }
  }, [reloadQueue]);

  const isOverdue = (t) => t.hours_to_due != null && t.hours_to_due < 0;
  const isWaitingOnThem = (t) => t.waiting_on === "requester";

  const visible = useMemo(() => {
    if (!tickets) return [];
    const term = search.trim().toLowerCase();

    return sortQueue(
      tickets.filter((t) => {
        if (overdueOnly && !isOverdue(t)) return false;
        if (waitingFilter === "us" && t.waiting_on !== "us") return false;
        if (waitingFilter === "them" && t.waiting_on !== "requester") return false;
        // Guard on myAgentId: without it, String(null) === String(null) would make
        // "assigned to me" quietly mean "unassigned".
        if (mineOnly && (myAgentId == null || String(t.assignee_id) !== String(myAgentId)))
          return false;
        if (!term) return true;
        return [t.subject, t.summary, t.requester_name, String(t.id)]
          .filter(Boolean)
          .some((field) => field.toLowerCase().includes(term));
      }),
    );
  }, [tickets, search, mineOnly, overdueOnly, waitingFilter, myAgentId]);

  const grouped = useMemo(() => {
    const byTier = new Map();
    for (const t of visible) {
      if (!byTier.has(t.tier)) byTier.set(t.tier, []);
      byTier.get(t.tier).push(t);
    }
    return [...byTier.entries()].sort((a, b) => a[0] - b[0]);
  }, [visible]);

  const overdueCount = tickets?.filter(isOverdue).length ?? 0;
  const onThemCount = tickets?.filter(isWaitingOnThem).length ?? 0;
  const onUsCount = tickets?.filter((t) => t.waiting_on === "us").length ?? 0;
  const mineCount = myAgentId == null
    ? 0
    : tickets?.filter((t) => String(t.assignee_id) === String(myAgentId)).length ?? 0;

  const counts = {
    queue: tickets?.length ?? 0,
    resolved: resolved.length,
    spam: spam.length,
    requesters: requesters.length,
    keywords: keywords.length,
    asana: asanaCount,
  };

  if (session === undefined) return <div className="state">Loading…</div>;
  if (!session) return <Login />;

  const current = SECTION_BY_ID[section];
  const subdomain = client?.zendesk_subdomain ?? "cuiwebteam";

  /** The two waiting states are exclusive of each other, but independent of Overdue. */
  const toggleWaiting = (which) =>
    setWaitingFilter((v) => (v === which ? null : which));

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src={bug} alt="" />
          <img src={wordmark} alt="Kanahoma" />
          <span className="divider" />
          <span className="product">Web Content Hub</span>
        </div>

        <div className="spacer" />
        <Clocks />

        <div className="who">
          <div className="name">{profile?.full_name ?? session.user.email}</div>
          <div className="role">{profile?.role ?? "no access"}</div>
        </div>

        <button className="chip" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>

      <div className="body">
        <Sidebar
          active={section}
          onSelect={setSection}
          collapsed={collapsed}
          onToggle={() => setCollapsed((v) => !v)}
          counts={counts}
        />

        <div className="content">
          {section === "queue" && (
            <div className="toolbar">
              <input
                className="search"
                placeholder="Search subject, summary, requester or ticket id…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button
                className="chip danger"
                aria-pressed={overdueOnly}
                onClick={() => setOverdueOnly((v) => !v)}
              >
                Overdue <span className="count">{overdueCount}</span>
              </button>
              <span className="chip-pair">
                <button
                  className="chip solid"
                  aria-pressed={waitingFilter === "us"}
                  onClick={() => toggleWaiting("us")}
                  title="Tickets we can act on right now"
                >
                  Waiting on us <span className="count">{onUsCount}</span>
                </button>
                <button
                  className="chip"
                  aria-pressed={waitingFilter === "them"}
                  onClick={() => toggleWaiting("them")}
                  title="Blocked on the requester"
                >
                  Waiting on them <span className="count">{onThemCount}</span>
                </button>
              </span>
              <button
                className="chip"
                aria-pressed={mineOnly}
                onClick={() => setMineOnly((v) => !v)}
                disabled={myAgentId == null}
                title={myAgentId == null ? "No Zendesk agent matches your email" : undefined}
              >
                Assigned to me <span className="count">{mineCount}</span>
              </button>
              <span className="count-note">
                {visible.length} of {tickets?.length ?? 0} tickets
              </span>
            </div>
          )}

          <main className="queue">
            {error && <div className="state">Something went wrong: {error}</div>}

            {section !== "queue" && <SectionIntro section={current} />}

            {section === "queue" && !error && (
              <>
                {tickets === null && <div className="state">Loading the queue…</div>}
                {tickets?.length === 0 && (
                  <div className="state">
                    No tickets visible. If this looks wrong, your account may not have a
                    hub role yet.
                  </div>
                )}
                {tickets?.length > 0 && visible.length === 0 && (
                  <div className="state">Nothing matches those filters.</div>
                )}
                {grouped.map(([tier, rows]) => {
                  const meta = TIERS[tier] ?? { label: `Tier ${tier}`, tone: "normal" };
                  return (
                    <section key={tier}>
                      <div className={`tier-heading ${meta.tone}`}>
                        <h2>{meta.label}</h2>
                        <span className="n">{rows.length}</span>
                        <span className="hint">{meta.hint}</span>
                      </div>
                      <div className="ticket-list">
                        {rows.map((t) => (
                          <TicketRow
                            key={t.id}
                            ticket={t}
                            subdomain={subdomain}
                            canEdit={canEdit}
                            onChanged={reloadQueue}
                            expanded={expandedId === t.id}
                            onToggle={() =>
                              setExpandedId(expandedId === t.id ? null : t.id)}
                          />
                        ))}
                      </div>
                    </section>
                  );
                })}
              </>
            )}

            {section === "resolved" && (
              <RecentlyResolved rows={resolved} subdomain={subdomain} />
            )}

            {section === "spam" && <SpamList rows={spam} subdomain={subdomain} />}

            {section === "requesters" && (
              <Requesters
                rows={requesters}
                canEdit={canEdit}
                onToggleVip={toggleVip}
                busyId={busyId}
              />
            )}

            {section === "keywords" && (
              <UrgencyKeywords
                rows={keywords}
                canEdit={canEdit}
                onAdd={addKeyword}
                onDelete={deleteKeyword}
                busy={busyId === "keyword"}
              />
            )}

            {section === "leadership" && (
              <Leadership tickets={tickets} subdomain={subdomain} />
            )}

            {section === "asana" && <AsanaTasks />}

            {section === "students" && (
              <StudentWorkers clientId={client?.id} canEdit={canEdit} />
            )}

            {current && !current.ready && (
              <div className="state">This section is not built yet.</div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
