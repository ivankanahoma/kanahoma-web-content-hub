drop view if exists ticket_queue;

create view ticket_queue with (security_invoker = true) as
with latest_eta as (
  select distinct on (ticket_id) ticket_id, eta_date, is_fuzzy, quote
  from ticket_etas
  order by ticket_id, created_at desc
), enriched as (
  select
    t.id, t.client_id, t.subject, t.description, t.status, t.requester_id,
    t.assignee_id, t.tags, t.zendesk_created_at, t.zendesk_updated_at, t.solved_at,
    t.first_agent_reply_at, t.last_public_comment_at, t.last_reply_by,
    t.public_comment_count, t.synced_at, t.trailing_agent_messages, t.reopens,
    t.follower_ids,
    c.timezone, c.eod_hour,
    c.launched_on is not null
      and (t.zendesk_created_at at time zone c.timezone)::date < c.launched_on
      as requested_pre_launch,
    r.name as requester_name, r.email as requester_email, r.is_vip,
    a.name as assignee_name,
    i.summary, i.complexity, i.effort, i.tone_urgency, i.tone_urgency_reason,
    i.institutional_knowledge, i.institutional_knowledge_note,
    i.requester_deadline, i.requester_deadline_fuzzy, i.last_agent_message_kind,
    e.eta_date, e.is_fuzzy as eta_is_fuzzy,
    ur.label as rule_label,
    coalesce(o.critical_impact,
             coalesce(i.ai_critical_impact, false) or ur.label is not null)
      as critical_impact,
    coalesce(i.ai_critical_impact_reason, ur.label) as critical_impact_reason,
    -- Whether *you* pinned it. The view is security_invoker, so auth.uid() is the person
    -- reading, and RLS on ticket_pins means one queue never shows another's pins.
    exists (select 1 from ticket_pins p
            where p.ticket_id = t.id and p.user_id = auth.uid()) as pinned,
    o.note as override_note,
    case
      when t.first_agent_reply_at is null then 'us'
      when t.last_reply_by = 'requester' then 'us'
      else 'requester'
    end as waiting_on,
    t.first_agent_reply_at is not null and t.last_reply_by = 'us' as answered,
    case
      when t.first_agent_reply_at is null
        then next_business_day_eod(t.zendesk_created_at, c.timezone, c.eod_hour::integer)
      else null::timestamptz
    end as first_response_due_at
  from tickets t
  join clients c on c.id = t.client_id
  join ticket_spam_status s on s.ticket_id = t.id and not s.is_spam
  left join requesters r on r.id = t.requester_id
  left join zendesk_agents a on a.id = t.assignee_id
  left join ticket_insights i on i.ticket_id = t.id
  left join latest_eta e on e.ticket_id = t.id
  left join ticket_overrides o on o.ticket_id = t.id
  left join lateral (
    select rules.label
    from urgency_rules rules
    where rules.client_id = t.client_id and rules.active
      and case
        when rules.match_type = 'regex'
          then (coalesce(t.subject,'') || ' ' || coalesce(t.description,'')) ~* rules.pattern
        else lower(coalesce(t.subject,'') || ' ' || coalesce(t.description,''))
             like ('%' || lower(rules.pattern) || '%')
      end
    limit 1) ur on true
  where t.status <> 'solved'
), timed as (
  select enriched.*,
    ((requester_deadline + make_interval(hours => eod_hour::integer)) at time zone timezone)
      as requester_deadline_at,
    ((eta_date + make_interval(hours => eod_hour::integer)) at time zone timezone)
      as eta_at
  from enriched
), scored as (
  select timed.*,
    least(requester_deadline_at, eta_at, first_response_due_at) as next_due_at,
    case least(requester_deadline_at, eta_at, first_response_due_at)
      when requester_deadline_at then 'requester_deadline'
      when eta_at then 'promised_eta'
      when first_response_due_at then 'first_response'
      else null
    end as next_due_kind,
    least(requester_deadline_at, eta_at) as commitment_at,
    business_days_between(last_public_comment_at, now(), timezone)
      as business_days_since_last_comment,
    (extract(epoch from now() - zendesk_created_at) / 86400)::integer as age_days
  from timed
), ranked as (
  select scored.*,
    case
      when critical_impact then 0
      when waiting_on = 'requester' then 7
      when next_due_at is not null and next_due_at < now() then 1
      when next_due_at is not null and next_due_at < now() + interval '72 hours' then 2
      when is_vip then 3
      when coalesce(tone_urgency::integer, 0) >= 2 then 4
      when next_due_at is not null then 5
      else 6
    end as base_tier
  from scored
)
select
  id, client_id, subject, description, status, requester_id, assignee_id, tags,
  zendesk_created_at, zendesk_updated_at, solved_at, first_agent_reply_at,
  last_public_comment_at, last_reply_by, public_comment_count, synced_at,
  trailing_agent_messages, timezone, eod_hour, requested_pre_launch,
  requester_name, requester_email, is_vip, assignee_name, summary, complexity, effort,
  institutional_knowledge, institutional_knowledge_note,
  tone_urgency, tone_urgency_reason, requester_deadline, requester_deadline_fuzzy,
  last_agent_message_kind, eta_date, eta_is_fuzzy, rule_label, critical_impact,
  critical_impact_reason, pinned, override_note, waiting_on, answered,
  first_response_due_at, requester_deadline_at, eta_at, next_due_at, next_due_kind,
  commitment_at,
  case when commitment_at is not null
       then extract(epoch from commitment_at - now()) / 3600
       else null::numeric
  end as hours_to_commitment,
  reopens, follower_ids,
  reopens > 0 as reopened,
  business_days_since_last_comment, age_days,
  base_tier,
  case when requested_pre_launch then 8 else base_tier end as tier,
  case when next_due_at is not null
       then extract(epoch from next_due_at - now()) / 3600
       else null::numeric
  end as hours_to_due,
  stalled_action(waiting_on, business_days_since_last_comment, last_agent_message_kind,
                 trailing_agent_messages, critical_impact) as stalled_action
from ranked;
