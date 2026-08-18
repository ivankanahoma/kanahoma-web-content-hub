-- How much CUI-specific or CMS-specific knowledge a ticket needs beyond its own text.
--
-- The question this answers is not "how hard is this" -- complexity already covers that.
-- It is "can this be handed to someone new?". A one-word deletion and a new article can
-- both be easy and fast, but only one of them needs somebody who knows which category the
-- article takes and where it surfaces on the site.

alter table ticket_insights
  add column if not exists institutional_knowledge text
    check (institutional_knowledge in ('none', 'some', 'high')),
  add column if not exists institutional_knowledge_note text;

comment on column ticket_insights.institutional_knowledge is
  'none = the ticket says exactly what to change; some = needs choices the ticket does '
  'not spell out; high = cannot be completed without knowing where the authoritative '
  'information lives or what the university convention is.';
