-- Kanahoma Web Content Hub - core schema.
--
-- Scope: the live work queue, not an analytics warehouse. We mirror only UNSOLVED
-- Zendesk tickets (plus solved ones for a 7 day grace period). Historical trends stay
-- in Zendesk Analytics.
--
-- Everything client-scoped from day one: CUI is just the first row in `clients`.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Clients and hub users
-- ---------------------------------------------------------------------------

create table clients (
  id                  uuid primary key default gen_random_uuid(),
  name                text        not null,
  slug                text        not null unique,
  zendesk_subdomain   text,
  zendesk_group_name  text,
  -- All business-hour math for a client runs in this zone.
  timezone            text        not null default 'America/Los_Angeles',
  -- End of day used by the first-response SLA, in the client's timezone.
  eod_hour            smallint    not null default 17,
  active              boolean     not null default true,
  created_at          timestamptz not null default now()
);

-- Hub accounts. `id` mirrors auth.users so RLS can key off auth.uid().
create table app_users (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  -- admin   : Ivan. Full control, including integrations and user management.
  -- manager : Matt. Can set VIPs, priority overrides, ETAs and notes, nothing structural.
  -- viewer  : read only.
  role        text not null default 'viewer' check (role in ('admin', 'manager', 'viewer')),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Zendesk people
-- ---------------------------------------------------------------------------

-- Anyone who can act on a ticket as "us". Used to tell our replies from the
-- requester's. Populated from the Zendesk agents in the Web Team group.
create table zendesk_agents (
  id          bigint primary key,          -- Zendesk user id
  client_id   uuid not null references clients(id) on delete cascade,
  name        text,
  email       text,
  role        text,                        -- Zendesk role: admin | agent
  active      boolean not null default true,
  synced_at   timestamptz not null default now()
);

create table requesters (
  id          bigint primary key,          -- Zendesk user id
  client_id   uuid not null references clients(id) on delete cascade,
  name        text,
  email       text,
  -- VIP is a hub-side decision, not a Zendesk field. Set by admin or manager.
  is_vip      boolean not null default false,
  vip_note    text,
  synced_at   timestamptz not null default now()
);

create index requesters_vip_idx on requesters (client_id) where is_vip;

-- ---------------------------------------------------------------------------
-- Tickets
-- ---------------------------------------------------------------------------

create table tickets (
  id                     bigint primary key,   -- Zendesk ticket id
  client_id              uuid not null references clients(id) on delete cascade,
  subject                text,
  description            text,
  status                 text not null,        -- new | open | pending | hold | solved
  requester_id           bigint,
  assignee_id            bigint,               -- current assignee only, no history
  tags                   text[] not null default '{}',
  zendesk_created_at     timestamptz not null,
  zendesk_updated_at     timestamptz not null,
  solved_at              timestamptz,          -- set when status flips to solved; row is
                                               -- purged 7 days later
  -- Reply state, derived on ingest so the UI never has to scan comments.
  -- System comments (autoresponder, merge notices) are excluded from all of these.
  first_agent_reply_at   timestamptz,
  last_public_comment_at timestamptz,
  last_reply_by          text check (last_reply_by in ('us', 'requester')),
  public_comment_count   integer not null default 0,
  synced_at              timestamptz not null default now()
);

create index tickets_client_status_idx on tickets (client_id, status);
create index tickets_assignee_idx on tickets (assignee_id);

comment on column tickets.first_agent_reply_at is
  'First public comment from one of our agents. Excludes the "You will receive an ETA '
  'shortly" trigger autoresponder (author_id = -1) and ticket merge notices.';

create table ticket_comments (
  id            bigint primary key,           -- Zendesk comment id
  ticket_id     bigint not null references tickets(id) on delete cascade,
  author_id     bigint,                       -- -1 for system/trigger comments
  author_name   text,
  -- us | requester | system. `system` covers the autoresponder and merge notices and is
  -- ignored by every reply-timing calculation.
  author_side   text not null check (author_side in ('us', 'requester', 'system')),
  is_public     boolean not null,
  body          text,
  created_at    timestamptz not null
);

create index ticket_comments_ticket_idx on ticket_comments (ticket_id, created_at);

-- ---------------------------------------------------------------------------
-- AI enrichment
-- ---------------------------------------------------------------------------

-- One row per ticket, replaced whenever the thread changes. `content_hash` covers the
-- subject plus every public comment, so re-enrichment only runs on real changes.
create table ticket_insights (
  ticket_id               bigint primary key references tickets(id) on delete cascade,

  summary                 text,

  -- Tier 0. A rule match always wins over the model's opinion.
  critical_impact         boolean not null default false,
  critical_impact_reason  text,
  critical_impact_source  text check (critical_impact_source in ('rule', 'ai')),

  -- Two independent axes: how hard, and how long.
  complexity              text check (complexity in ('easy', 'medium', 'complex')),
  effort                  text check (effort in ('fast', 'time_consuming')),
  complexity_reason       text,

  -- 0 none, 1 mild, 2 pressing, 3 alarmed. Soft signal, ranks below real commitments.
  tone_urgency            smallint check (tone_urgency between 0 and 3),
  tone_urgency_reason     text,

  -- A deadline the REQUESTER asked for. Distinct from any ETA we promised.
  requester_deadline      date,
  requester_deadline_fuzzy boolean not null default false,
  requester_deadline_quote text,

  model                   text,
  content_hash            text not null,
  enriched_at             timestamptz not null default now()
);

-- Every ETA we have promised, newest wins. History is kept so a moved date is visible.
create table ticket_etas (
  id                uuid primary key default gen_random_uuid(),
  ticket_id         bigint not null references tickets(id) on delete cascade,
  eta_date          date not null,
  -- "early next week" resolves to a date but is flagged so the UI shows it as soft.
  is_fuzzy          boolean not null default false,
  quote             text,
  source_comment_id bigint,
  -- ai: parsed from one of our comments. manual: typed into the hub.
  source            text not null check (source in ('ai', 'manual')),
  created_by        uuid references app_users(id),
  created_at        timestamptz not null default now()
);

create index ticket_etas_latest_idx on ticket_etas (ticket_id, created_at desc);

-- Manual keyword/topic rules that force critical impact. These override the model.
create table urgency_rules (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  pattern     text not null,
  match_type  text not null default 'keyword' check (match_type in ('keyword', 'regex')),
  label       text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Human corrections that survive re-enrichment.
create table ticket_overrides (
  ticket_id        bigint primary key references tickets(id) on delete cascade,
  critical_impact  boolean,      -- force on or off
  pinned           boolean not null default false,
  note             text,
  updated_by       uuid references app_users(id),
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Business-time helpers
-- ---------------------------------------------------------------------------

-- Whole weekdays elapsed between two instants, in the given zone. Holidays are not
-- considered yet; the holidays table arrives with the student-worker scheduling phase.
create or replace function business_days_between(
  start_ts timestamptz,
  end_ts   timestamptz,
  tz       text default 'America/Los_Angeles'
) returns integer
language sql stable as $$
  select coalesce(count(*), 0)::integer
  from generate_series(
         (start_ts at time zone tz)::date,
         (end_ts   at time zone tz)::date - 1,
         interval '1 day'
       ) as d
  where extract(isodow from d) < 6;
$$;

-- End of the next business day. A ticket created Friday is due Monday at EOD.
create or replace function next_business_day_eod(
  from_ts  timestamptz,
  tz       text default 'America/Los_Angeles',
  eod_hour integer default 17
) returns timestamptz
language sql stable as $$
  with next_day as (
    select (from_ts at time zone tz)::date + 1 as d
  ), skipped as (
    select case extract(isodow from d)
             when 6 then d + 2   -- Saturday -> Monday
             when 7 then d + 1   -- Sunday   -> Monday
             else d
           end as d
    from next_day
  )
  select ((d + make_interval(hours => eod_hour)) at time zone tz) from skipped;
$$;

-- ---------------------------------------------------------------------------
-- The queue
-- ---------------------------------------------------------------------------
--
-- Three commitments share one clock, which is what keeps the ordering honest: the
-- requester's deadline, the ETA we promised, and the first-response SLA. Whichever
-- breaches first wins, regardless of type. Ranking by *type* instead of *time* is how
-- you end up putting a deadline 47 hours out above an ETA due in 2 hours.
--
-- tier 0  critical impact          broken apply link, wrong tuition, bad start date
-- tier 1  breached                 any commitment already past due
-- tier 2  due within 72h           sorted by hours remaining
-- tier 3  VIP requester waiting
-- tier 4  tone urgency             the model thinks the requester sounds pressed
-- tier 5  distant deadline         by date
-- tier 6  everything else          by how long they have waited
-- tier 7  waiting on the requester never urgent, always last

create view ticket_queue as
with latest_eta as (
  select distinct on (ticket_id) ticket_id, eta_date, is_fuzzy, quote
  from ticket_etas
  order by ticket_id, created_at desc
),
enriched as (
  select
    t.*,
    c.timezone,
    c.eod_hour,
    r.name  as requester_name,
    r.is_vip,
    a.name  as assignee_name,
    i.summary,
    i.complexity,
    i.effort,
    i.tone_urgency,
    i.tone_urgency_reason,
    i.critical_impact_reason,
    i.requester_deadline,
    i.requester_deadline_fuzzy,
    e.eta_date,
    e.is_fuzzy as eta_is_fuzzy,
    coalesce(o.critical_impact, i.critical_impact, false) as critical_impact,
    coalesce(o.pinned, false) as pinned,
    o.note as override_note,
    -- Nobody has replied yet, or the requester spoke last: the ball is ours.
    case
      when t.first_agent_reply_at is null then 'us'
      when t.last_reply_by = 'requester'  then 'us'
      else 'requester'
    end as waiting_on,
    -- Only unanswered tickets carry a first-response commitment.
    case
      when t.first_agent_reply_at is null
      then next_business_day_eod(t.zendesk_created_at, c.timezone, c.eod_hour)
    end as first_response_due_at
  from tickets t
  join clients c on c.id = t.client_id
  left join requesters     r on r.id = t.requester_id
  left join zendesk_agents a on a.id = t.assignee_id
  left join ticket_insights i on i.ticket_id = t.id
  left join latest_eta      e on e.ticket_id = t.id
  left join ticket_overrides o on o.ticket_id = t.id
  where t.status <> 'solved'
),
timed as (
  select
    *,
    -- Deadlines are dates; they come due at end of business on that day.
    ((requester_deadline + make_interval(hours => eod_hour)) at time zone timezone)
      as requester_deadline_at,
    ((eta_date + make_interval(hours => eod_hour)) at time zone timezone)
      as eta_at
  from enriched
),
scored as (
  select
    *,
    least(requester_deadline_at, eta_at, first_response_due_at) as next_due_at,
    case least(requester_deadline_at, eta_at, first_response_due_at)
      when requester_deadline_at  then 'requester_deadline'
      when eta_at                 then 'promised_eta'
      when first_response_due_at  then 'first_response'
    end as next_due_kind,
    business_days_between(last_public_comment_at, now(), timezone) as business_days_since_last_comment,
    (extract(epoch from (now() - zendesk_created_at)) / 86400)::integer as age_days
  from timed
)
select
  *,
  case
    when waiting_on = 'requester'                       then 7
    when critical_impact                                then 0
    when next_due_at is not null and next_due_at < now() then 1
    when next_due_at is not null
         and next_due_at < now() + interval '72 hours'  then 2
    when is_vip                                          then 3
    when coalesce(tone_urgency, 0) >= 2                  then 4
    when next_due_at is not null                         then 5
    else 6
  end as tier,
  -- Negative when already breached, which is what sorts the worst offender first.
  case when next_due_at is not null
       then extract(epoch from (next_due_at - now())) / 3600
  end as hours_to_due,
  -- The requester has gone quiet long enough that the ticket can be closed out.
  (waiting_on = 'requester'
   and business_days_between(last_public_comment_at, now(), timezone) >= 3) as close_candidate
from scored;

-- Solved tickets kept visible for 7 days. Deliberately a separate view: this is not
-- work to do, and it must never compete with the queue for attention.
create view recently_resolved as
select t.id, t.client_id, t.subject, t.solved_at, t.assignee_id,
       r.name as requester_name
from tickets t
left join requesters r on r.id = t.requester_id
where t.status = 'solved'
  and t.solved_at > now() - interval '7 days';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
--
-- Ingestion and enrichment run as the service role, which bypasses RLS entirely.
-- Everything below governs the browser client only.

create or replace function app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from app_users where id = auth.uid();
$$;

alter table clients          enable row level security;
alter table app_users        enable row level security;
alter table zendesk_agents   enable row level security;
alter table requesters       enable row level security;
alter table tickets          enable row level security;
alter table ticket_comments  enable row level security;
alter table ticket_insights  enable row level security;
alter table ticket_etas      enable row level security;
alter table urgency_rules    enable row level security;
alter table ticket_overrides enable row level security;

-- Any known hub user can read everything.
do $$
declare t text;
begin
  foreach t in array array['clients', 'app_users', 'zendesk_agents', 'requesters',
                           'tickets', 'ticket_comments', 'ticket_insights',
                           'ticket_etas', 'urgency_rules', 'ticket_overrides']
  loop
    execute format(
      'create policy %I on %I for select using (app_role() is not null)',
      t || '_read', t);
  end loop;
end $$;

-- Admin and manager can curate: VIPs, ETAs, urgency rules, overrides.
create policy requesters_write on requesters for update
  using (app_role() in ('admin', 'manager')) with check (app_role() in ('admin', 'manager'));

create policy ticket_etas_write on ticket_etas for all
  using (app_role() in ('admin', 'manager')) with check (app_role() in ('admin', 'manager'));

create policy ticket_overrides_write on ticket_overrides for all
  using (app_role() in ('admin', 'manager')) with check (app_role() in ('admin', 'manager'));

create policy urgency_rules_write on urgency_rules for all
  using (app_role() in ('admin', 'manager')) with check (app_role() in ('admin', 'manager'));

-- Structural tables are admin only.
create policy clients_write on clients for all
  using (app_role() = 'admin') with check (app_role() = 'admin');

create policy app_users_write on app_users for all
  using (app_role() = 'admin') with check (app_role() = 'admin');
