import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { supabase } from "./lib/supabase";
import { invokeFunction } from "./lib/invoke";
import { TIERS, sortQueue } from "./lib/queue";
import { SECTION_BY_ID, homeSectionFor, sectionsFor } from "./lib/sections";
import Login from "./components/Login";
import Clocks from "./components/Clocks";
import Sidebar from "./components/Sidebar";
import TicketRow from "./components/TicketRow";
import StudentWorkers from "./components/StudentWorkers";
import Leadership from "./components/Leadership";
import Documentation from "./components/Documentation";
import AsanaTasks from "./components/AsanaTasks";
import ArticleGenerator from "./components/ArticleGenerator";
import {
  Requesters,
  SectionIntro,
  SpamList,
  UrgencyKeywords,
} from "./components/SimpleLists";
import RecentActivity from "./components/RecentActivity";
import bug from "./assets/kanahoma-bug-green.png";
import wordmark from "./assets/kanahoma-wordmark-green.png";

const COLLAPSED_KEY = "hub.sidebarCollapsed";
const FILTERS_KEY = "hub.queueFilters";

/**
 * How the queue was left last time. Filters are how you narrow 38 tickets to the six you
 * are actually working, and losing that on every reload made the toolbar feel disposable.
 * The search box is deliberately not kept: a stale search term hides tickets silently,
 * where a stale filter chip is visible and lit up.
 */
function loadFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTERS_KEY) ?? "{}");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}
const SAVED = loadFilters();

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [profile, setProfile] = useState(null);
  const [client, setClient] = useState(null);
  const [tickets, setTickets] = useState(null);
  const [resolved, setResolved] = useState([]);
  const [activity, setActivity] = useState(null);
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
  const [view, setView] = useState(SAVED.view ?? "priority"); // priority | assignee
  const [mineOnly, setMineOnly] = useState(SAVED.mineOnly ?? false);
  const [overdueOnly, setOverdueOnly] = useState(SAVED.overdueOnly ?? false);
  const [newOnly, setNewOnly] = useState(SAVED.newOnly ?? false);
  const [reopenedOnly, setReopenedOnly] = useState(SAVED.reopenedOnly ?? false);
  const [waitingFilter, setWaitingFilter] = useState(SAVED.waitingFilter ?? null);
  const [refreshing, setRefreshing] = useState(null); // null | pulling | reading
  const [expandedId, setExpandedId] = useState(null);
  const [myAgentId, setMyAgentId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [agents, setAgents] = useState([]);

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

  useEffect(() => {
    localStorage.setItem(FILTERS_KEY, JSON.stringify({
      view, mineOnly, overdueOnly, newOnly, reopenedOnly, waitingFilter,
    }));
  }, [view, mineOnly, overdueOnly, newOnly, reopenedOnly, waitingFilter]);

  const reloadQueue = useCallback(async () => {
    const { data } = await supabase.from("ticket_queue").select("*");
    setTickets(data ?? []);
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    (async () => {
      const [me, clientRow, queue, agents, done, acts, junk, people, rules, asana] =
        await Promise.all([
        supabase.from("app_users").select("*").eq("id", session.user.id).maybeSingle(),
        supabase.from("clients").select("*").eq("slug", "cui").maybeSingle(),
        supabase.from("ticket_queue").select("*"),
        supabase.from("zendesk_agents").select("id, name, email").order("name"),
        supabase.from("recently_resolved").select("*"),
        supabase.from("ticket_activity").select("*"),
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
      setActivity(acts.data ?? []);
      setSpam(junk.data ?? []);
      setRequesters(people.data ?? []);
      setKeywords(rules.data ?? []);
      setAsanaCount(asana.data?.length ?? 0);
      setAgents(agents.data ?? []);
      setMyAgentId(
        (agents.data ?? []).find(
          (a) => a.email?.toLowerCase() === session.user.email?.toLowerCase(),
        )?.id ?? null,
      );
    })();

    return () => { cancelled = true; };
  }, [session]);

  const canEdit = profile?.role === "admin" || profile?.role === "manager";
  const role = profile?.role ?? null;

  useEffect(() => {
    if (landedRef.current || !profile) return;
    landedRef.current = true;
    setSection(homeSectionFor(profile.role));
  }, [profile]);

  // A role can lose access to whatever it was looking at, and a heading is never a
  // destination. Either way, land somewhere real instead of rendering a blank page.
  useEffect(() => {
    if (!role) return;
    const reachable = new Set(
      sectionsFor(role).flatMap((s) => [
        ...(s.navigable === false ? [] : [s.id]),
        ...(s.children ?? []).map((c) => c.id),
      ]),
    );
    if (!reachable.has(section)) setSection(homeSectionFor(role));
  }, [role, section]);

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

  /**
   * Pull from Zendesk on demand, then re-read the threads that changed. Closing five
   * tickets and waiting ten minutes for the queue to agree is the thing this avoids.
   * Enrichment follows the sync rather than running beside it, so it reads fresh threads.
   */
  const refreshNow = useCallback(async () => {
    setError(null);
    try {
      setRefreshing("pulling");
      await invokeFunction("sync-zendesk", {});
      setRefreshing("reading");
      await invokeFunction("enrich-tickets", {});
      await reloadQueue();
      const [done, acts] = await Promise.all([
        supabase.from("recently_resolved").select("*"),
        supabase.from("ticket_activity").select("*"),
      ]);
      setResolved(done.data ?? []);
      setActivity(acts.data ?? []);
    } catch (e) {
      setError(`Refresh failed: ${e.message}`);
    } finally {
      setRefreshing(null);
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
        if (newOnly && t.status !== "new") return false;
        if (reopenedOnly && !t.reopened) return false;
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
  }, [tickets, search, mineOnly, overdueOnly, newOnly, reopenedOnly, waitingFilter,
      myAgentId]);

  /**
   * Two ways to cut the same list. By priority answers "what next"; by assignee answers
   * "who is carrying what", which the ranked view cannot show because one person's work
   * is scattered across every tier.
   */
  const grouped = useMemo(() => {
    if (view === "assignee") {
      const byAgent = new Map();
      for (const t of visible) {
        const key = t.assignee_name ?? "Unassigned";
        if (!byAgent.has(key)) byAgent.set(key, []);
        byAgent.get(key).push(t);
      }
      const mine = myAgentId == null
        ? null
        : visible.find((t) => String(t.assignee_id) === String(myAgentId))?.assignee_name;

      // Your own name first, then the heaviest queues, then whatever nobody owns.
      return [...byAgent.entries()].sort(([a, ra], [b, rb]) => {
        if (a === mine) return -1;
        if (b === mine) return 1;
        if (a === "Unassigned") return 1;
        if (b === "Unassigned") return -1;
        return rb.length - ra.length;
      });
    }

    const byTier = new Map();
    for (const t of visible) {
      if (!byTier.has(t.tier)) byTier.set(t.tier, []);
      byTier.get(t.tier).push(t);
    }
    return [...byTier.entries()].sort((a, b) => a[0] - b[0]);
  }, [visible, view, myAgentId]);

  const overdueCount = tickets?.filter(isOverdue).length ?? 0;
  const newCount = tickets?.filter((t) => t.status === "new").length ?? 0;
  const reopenedCount = tickets?.filter((t) => t.reopened).length ?? 0;
  const onThemCount = tickets?.filter(isWaitingOnThem).length ?? 0;
  const onUsCount = tickets?.filter((t) => t.waiting_on === "us").length ?? 0;
  const mineCount = myAgentId == null
    ? 0
    : tickets?.filter((t) => String(t.assignee_id) === String(myAgentId)).length ?? 0;

  const counts = {
    queue: tickets?.length ?? 0,
    activity: (activity ?? []).filter((t) => {
      const last = [t.last_team_comment_at, t.last_requester_comment_at]
        .filter(Boolean).sort().at(-1);
      return last && Date.now() - new Date(last).getTime() < 7 * 864e5;
    }).length,
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
          role={role}
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
              <span className="chip-pair view-switch">
                <button
                  className="chip"
                  aria-pressed={view === "priority"}
                  onClick={() => setView("priority")}
                  title="Ranked by what breaches first"
                >
                  By priority
                </button>
                <button
                  className="chip"
                  aria-pressed={view === "assignee"}
                  onClick={() => setView("assignee")}
                  title="Grouped by who it is assigned to"
                >
                  By assignee
                </button>
              </span>

              <button
                className="chip danger"
                aria-pressed={overdueOnly}
                onClick={() => setOverdueOnly((v) => !v)}
              >
                Overdue <span className="count">{overdueCount}</span>
              </button>
              <button
                className="chip"
                aria-pressed={newOnly}
                onClick={() => setNewOnly((v) => !v)}
                title="Nobody has touched these yet"
              >
                New <span className="count">{newCount}</span>
              </button>
              <button
                className="chip"
                aria-pressed={reopenedOnly}
                onClick={() => setReopenedOnly((v) => !v)}
                title="Solved once and came back"
              >
                Reopened <span className="count">{reopenedCount}</span>
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
              {canEdit && (
                <button
                  className="chip"
                  onClick={refreshNow}
                  disabled={refreshing != null}
                  title="Pull from Zendesk now instead of waiting for the next run"
                >
                  <RefreshCw
                    size={13}
                    className={refreshing ? "spinning" : undefined}
                    strokeWidth={2}
                  />
                  {refreshing === "pulling" ? "Pulling from Zendesk…"
                    : refreshing === "reading" ? "Reading new replies…"
                    : "Refresh"}
                </button>
              )}
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
                {grouped.map(([key, rows]) => {
                  const meta = view === "assignee"
                    ? {
                      label: key,
                      tone: key === "Unassigned" ? "muted" : "normal",
                      hint: key === "Unassigned"
                        ? "Nobody owns these yet"
                        : "In queue order, highest priority first",
                    }
                    : TIERS[key] ?? { label: `Tier ${key}`, tone: "normal" };
                  return (
                    <section key={key}>
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
                            agents={agents}
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

            {section === "activity" && (
              <RecentActivity
                activity={activity}
                resolved={resolved}
                subdomain={subdomain}
              />
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

            {section === "docs" && <Documentation />}

            {section === "asana" && <AsanaTasks />}

            {section === "article-generator" && <ArticleGenerator />}

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
