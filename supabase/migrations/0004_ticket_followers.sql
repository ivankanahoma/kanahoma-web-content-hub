-- Who is tagged on a ticket.
--
-- Zendesk calls them followers; in the agent interface they are what an @mention creates.
-- They arrive on the ticket object the search already returns, so mirroring them costs no
-- extra API call.

alter table tickets add column if not exists follower_ids bigint[] not null default '{}';

comment on column tickets.follower_ids is
  'Zendesk follower_ids: agents tagged on the ticket, whether by an @mention or by hand.';

-- Link the hub accounts to their Zendesk agents. Matching on email is safe here because
-- these two are being set once, by hand, from addresses that already agree; the column
-- stays explicit so nothing re-matches silently later.
update app_users u
set zendesk_agent_id = a.id
from zendesk_agents a
where lower(a.email) = lower(u.email) and u.zendesk_agent_id is null;
