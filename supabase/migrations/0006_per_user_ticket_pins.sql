-- Pinning, per person.
--
-- `ticket_overrides.pinned` already existed and was global: one person pinning a ticket
-- would have moved it to the top of everybody's queue. It also never had a control, so
-- nothing ever set it. A pin is a note to yourself about what you are working on right
-- now, which is only useful if it is yours alone.

create table if not exists ticket_pins (
  user_id    uuid   not null references auth.users(id) on delete cascade,
  ticket_id  bigint not null references tickets(id)    on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, ticket_id)
);

create index if not exists ticket_pins_user_idx on ticket_pins(user_id);

alter table ticket_pins enable row level security;

-- One policy for everything: you only ever see or touch your own rows, and the check on
-- insert stops anyone writing a pin onto somebody else's account.
drop policy if exists ticket_pins_own on ticket_pins;
create policy ticket_pins_own on ticket_pins
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on table ticket_pins is
  'Private per user. Feeds ticket_queue.pinned, which is why the queue view is '
  'security_invoker: it has to be read as the person asking.';
