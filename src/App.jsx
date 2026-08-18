import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { supabase } from "./lib/supabase";
import { invokeFunction } from "./lib/invoke";
import { downloadCsv } from "./lib/csv";
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
  const [view, setView] = useState(SAVED.view ?? "priority"); // priority | assignee | due
  const [reopenedOnly, setReopenedOnly] = useState(SAVED.reopenedOnly ?? false);
  const [criticalOnly, setCriticalOnly] = useState(SAVED.criticalOnly ?? false);
  const [noEtaOnly, setNoEtaOnly] = useState(SAVED.noEtaOnly ?? false);
  const [noReplyOnly, setNoReplyOnly] = useState(SAVED.noReplyOnly ?? false);
  const [waitingFilter, setWaitingFilter] = useState(SAVED.waitingFilter ?? null);
  // Dropdowns: "" means the filter is off.
  const [assigneeFilter, setAssigneeFilter] = useState(SAVED.assigneeFilter ?? "");
  const [requesterFilter, setRequesterFilter] = useState(SAVED.requesterFilter ?? "");
  const [complexityFilter, setComplexityFilter] = useState(SAVED.complexityFilter ?? "");
  const [effortFilter, setEffortFilter] = useState(SAVED.effortFilter ?? "");
  const [knowledgeFilter, setKnowledgeFilter] = useState(SAVED.knowledgeFilter ?? "");
  const [ageFilter, setAgeFilter] = useState(SAVED.ageFilter ?? "");
  const [launchFilter, setLaunchFilter] = useState(SAVED.launchFilter ?? "");
  const [refreshing, setRefreshing] = useState(null); // null | pulling | reading
  const [expandedId, setExpandedId] = useState(null);
  const [myAgentId, setMyAgentId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [agents, setAgents] = useState([]);

  /**
   * The tier headings stick below the toolbar, and the toolbar's height changes with the
   * window: two rows on a wide screen, three or four when the filters wrap. Measuring it
   * beats guessing an offset that is wrong at every other width.
   */
  const toolbarRef = useRef(null);
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const apply = () => document.documentElement.style.setProperty(
      "--queue-sticky-top", `${Math.round(el.getBoundingClientRect().height) + 47}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, [section]);

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
      view, reopenedOnly, criticalOnly, noEtaOnly, noReplyOnly, waitingFilter,
      assigneeFilter, requesterFilter, complexityFilter, effortFilter, knowledgeFilter,
      ageFilter, launchFilter,
    }));
  }, [view, reopenedOnly, criticalOnly, noEtaOnly, noReplyOnly, waitingFilter,
      assigneeFilter, requesterFilter, complexityFilter, effortFilter, knowledgeFilter,
      ageFilter, launchFilter]);

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
        supabase.from("zendesk_agents").select("id, name, email, assignable").order("name"),
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
      // The picker offers the six people work is actually handed to, not the
      // fifteen the Zendesk group happens to carry.
      setAgents((agents.data ?? []).filter((a) => a.assignable));
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

  const isWaitingOnThem = (t) => t.waiting_on === "requester";

  const visible = useMemo(() => {
    if (!tickets) return [];
    const term = search.trim().toLowerCase();

    return sortQueue(
      tickets.filter((t) => {
        if (reopenedOnly && !t.reopened) return false;
        if (criticalOnly && !t.critical_impact) return false;
        // The autoresponder promised every one of these an ETA we never gave.
        if (noEtaOnly && t.eta_date != null) return false;
        if (noReplyOnly && t.first_agent_reply_at != null) return false;
        if (waitingFilter === "us" && t.waiting_on !== "us") return false;
        if (waitingFilter === "them" && t.waiting_on !== "requester") return false;

        // "unassigned" is a real choice here, so it cannot share the empty string with
        // "no filter": String(null) === String(null) would quietly conflate the two.
        if (assigneeFilter === "unassigned" && t.assignee_id != null) return false;
        if (assigneeFilter && assigneeFilter !== "unassigned" &&
            String(t.assignee_id) !== String(assigneeFilter)) return false;
        if (requesterFilter && String(t.requester_id) !== String(requesterFilter))
          return false;

        if (complexityFilter && t.complexity !== complexityFilter) return false;
        if (effortFilter && t.effort !== effortFilter) return false;
        if (knowledgeFilter && t.institutional_knowledge !== knowledgeFilter) return false;
        if (launchFilter === "pre" && !t.requested_pre_launch) return false;
        if (launchFilter === "post" && t.requested_pre_launch) return false;

        const age = t.age_days ?? 0;
        if (ageFilter === "lt3" && age >= 3) return false;
        if (ageFilter === "gt5" && age <= 5) return false;
        if (ageFilter === "gt15" && age <= 15) return false;
        if (ageFilter === "gt30" && age <= 30) return false;

        if (!term) return true;
        return [t.subject, t.summary, t.requester_name, String(t.id)]
          .filter(Boolean)
          .some((field) => field.toLowerCase().includes(term));
      }),
    );
  }, [tickets, search, reopenedOnly, criticalOnly, noEtaOnly, noReplyOnly, waitingFilter,
      assigneeFilter, requesterFilter, complexityFilter, effortFilter, knowledgeFilter,
      ageFilter, launchFilter]);

  /**
   * Two ways to cut the same list. By priority answers "what next"; by assignee answers
   * "who is carrying what", which the ranked view cannot show because one person's work
   * is scattered across every tier.
   */
  const grouped = useMemo(() => {
    // One flat list, soonest commitment first. Deliberately ignores the tiers: it is the
    // calendar view, for "what is landing this week" rather than "what next".
    if (view === "due") {
      const withDate = visible.filter((t) => t.hours_to_due != null)
        .sort((a, b) => a.hours_to_due - b.hours_to_due);
      const without = visible.filter((t) => t.hours_to_due == null)
        .sort((a, b) => (b.age_days ?? 0) - (a.age_days ?? 0));
      return [
        ...(withDate.length ? [["Has a date", withDate]] : []),
        ...(without.length ? [["No date attached", without]] : []),
      ];
    }
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

  /** Requesters who actually have something open, so the filter is never a dead list. */
  const requestersInQueue = useMemo(() => {
    const seen = new Map();
    for (const t of tickets ?? []) {
      if (t.requester_id != null && !seen.has(t.requester_id)) {
        seen.set(t.requester_id, t.requester_name ?? `Requester ${t.requester_id}`);
      }
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [tickets]);

  const filtersOn = [
    reopenedOnly, criticalOnly, noEtaOnly, noReplyOnly, waitingFilter, assigneeFilter,
    requesterFilter, complexityFilter, effortFilter, knowledgeFilter, ageFilter,
    launchFilter,
  ].filter(Boolean).length;

  const clearFilters = () => {
    setReopenedOnly(false); setCriticalOnly(false); setNoEtaOnly(false);
    setNoReplyOnly(false); setWaitingFilter(null); setAssigneeFilter("");
    setRequesterFilter(""); setComplexityFilter(""); setEffortFilter("");
    setKnowledgeFilter(""); setAgeFilter(""); setLaunchFilter("");
  };

  const reopenedCount = tickets?.filter((t) => t.reopened).length ?? 0;
  const criticalCount = tickets?.filter((t) => t.critical_impact).length ?? 0;
  const noEtaCount = tickets?.filter((t) => t.eta_date == null).length ?? 0;
  const noReplyCount = tickets?.filter((t) => t.first_agent_reply_at == null).length ?? 0;
  const onThemCount = tickets?.filter(isWaitingOnThem).length ?? 0;
  const onUsCount = tickets?.filter((t) => t.waiting_on === "us").length ?? 0;

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
            <div className="toolbar" ref={toolbarRef}>
              <div className="toolbar-row">
                <input
                  className="search"
                  placeholder="Search subject, summary, requester or ticket id…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <span className="chip-pair view-switch">
                  {[["priority", "By priority", "Ranked by what breaches first"],
                    ["assignee", "By assignee", "Grouped by who owns it"],
                    ["due", "By due date", "Flat calendar view, soonest first"]]
                    .map(([id, label, hint]) => (
                      <button
                        key={id}
                        className="chip"
                        aria-pressed={view === id}
                        onClick={() => setView(id)}
                        title={hint}
                      >
                        {label}
                      </button>
                    ))}
                </span>

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
                  className="chip danger"
                  aria-pressed={criticalOnly}
                  onClick={() => setCriticalOnly((v) => !v)}
                  title="Breaking or misleading a student on the live site"
                >
                  Critical <span className="count">{criticalCount}</span>
                </button>
                <button
                  className="chip"
                  aria-pressed={reopenedOnly}
                  onClick={() => setReopenedOnly((v) => !v)}
                  title="Solved once and came back"
                >
                  Reopened <span className="count">{reopenedCount}</span>
                </button>
                <button
                  className="chip"
                  aria-pressed={noEtaOnly}
                  onClick={() => setNoEtaOnly((v) => !v)}
                  title="The autoresponder promised them an ETA we never gave"
                >
                  No ETA <span className="count">{noEtaCount}</span>
                </button>
                <button
                  className="chip"
                  aria-pressed={noReplyOnly}
                  onClick={() => setNoReplyOnly((v) => !v)}
                  title="Nobody on the team has replied yet"
                >
                  No human reply <span className="count">{noReplyCount}</span>
                </button>
              </div>

              <div className="toolbar-row secondary">
                <select
                  className="filter-select"
                  value={assigneeFilter}
                  onChange={(e) => setAssigneeFilter(e.target.value)}
                  aria-label="Filter by assignee"
                >
                  <option value="">Anyone assigned</option>
                  <option value="unassigned">Unassigned</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.id === myAgentId ? `${a.name} (me)` : a.name}
                    </option>
                  ))}
                </select>

                <select
                  className="filter-select"
                  value={requesterFilter}
                  onChange={(e) => setRequesterFilter(e.target.value)}
                  aria-label="Filter by requester"
                >
                  <option value="">Any requester</option>
                  {requestersInQueue.map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>

                <select
                  className="filter-select"
                  value={knowledgeFilter}
                  onChange={(e) => setKnowledgeFilter(e.target.value)}
                  aria-label="Filter by institutional knowledge"
                  title="How much CUI or CMS knowledge the ticket needs beyond its own text"
                >
                  <option value="">Any knowledge level</option>
                  <option value="none">No institutional knowledge</option>
                  <option value="some">Some institutional knowledge</option>
                  <option value="high">Deep institutional knowledge</option>
                </select>

                <select
                  className="filter-select"
                  value={complexityFilter}
                  onChange={(e) => setComplexityFilter(e.target.value)}
                  aria-label="Filter by complexity"
                >
                  <option value="">Any complexity</option>
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="complex">Complex</option>
                </select>

                <select
                  className="filter-select"
                  value={effortFilter}
                  onChange={(e) => setEffortFilter(e.target.value)}
                  aria-label="Filter by effort"
                >
                  <option value="">Any effort</option>
                  <option value="fast">Fast</option>
                  <option value="time_consuming">Time-consuming</option>
                </select>

                <select
                  className="filter-select"
                  value={ageFilter}
                  onChange={(e) => setAgeFilter(e.target.value)}
                  aria-label="Filter by age"
                >
                  <option value="">Any age</option>
                  <option value="lt3">Under 3 days</option>
                  <option value="gt5">Over 5 days</option>
                  <option value="gt15">Over 15 days</option>
                  <option value="gt30">Over 30 days</option>
                </select>

                <select
                  className="filter-select"
                  value={launchFilter}
                  onChange={(e) => setLaunchFilter(e.target.value)}
                  aria-label="Filter by launch phase"
                >
                  <option value="">Pre and post-launch</option>
                  <option value="pre">Pre-launch only</option>
                  <option value="post">Post-launch only</option>
                </select>

                {filtersOn > 0 && (
                  <button className="chip" onClick={clearFilters}>
                    Clear {filtersOn} filter{filtersOn === 1 ? "" : "s"}
                  </button>
                )}

                <span className="count-note">
                  {visible.length} of {tickets?.length ?? 0} tickets
                </span>

                <button
                  className="chip"
                  onClick={() => downloadCsv(
                    visible,
                    `cui-queue-${new Date().toISOString().slice(0, 10)}.csv`,
                  )}
                  disabled={!visible.length}
                  title="Exports exactly what these filters are showing"
                >
                  <Download size={13} strokeWidth={2} /> CSV
                </button>

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
