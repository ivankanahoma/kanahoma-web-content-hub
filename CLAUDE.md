# Kanahoma Web Content Hub

Internal work queue for Kanahoma's web content management service. Multi-client from day
one; Concordia University Irvine (CUI) is the first and currently only client.

The hub answers one question: **what should I work on next, and what have I already
promised?** It is not a ticketing system and not an analytics tool. Zendesk stays the
system of record and Zendesk Analytics keeps the historical reporting.

## Architecture

GitHub Pages serves static files only, so nothing that needs a secret can run in the
browser. Everything that touches an API key runs in Supabase:

```
Zendesk ──► sync-zendesk ──┐
                           ├──► Postgres ──► React SPA (read only)
Anthropic ─► enrich-tickets┘         ▲
            draft-reply              └── pg_cron drives both on a schedule
```

- **Edge Functions** (Deno) hold every credential. The front end never sees one.
  Any function the browser calls (`analyze-article`, `draft-reply`) must answer the CORS
  preflight *before* reading its body, via `_shared/cors.ts`. `functions.invoke` sends an
  Authorization header, so the browser always sends `OPTIONS` first; a function that
  parses JSON straight away answers it with a 400 and no CORS headers, and the call dies
  in the browser with nothing in the function logs. The cron-driven functions never need
  it.
- **pg_cron + pg_net** invoke the functions. `sync-zendesk` every 10 minutes,
  `enrich-tickets` five minutes behind it so it always reads fresh threads. The queue's
  **Refresh** button runs the same two in the same order on demand, which is why both
  now answer the CORS preflight too.
- **The SPA only reads.** Its writes are limited to hub-side judgements: VIP flags,
  manual ETAs, keyword rules, schedules. The exceptions are `assign-ticket`,
  `add-comment` and `set-ticket-status`, the only three things that reach Zendesk.

### Writing back to Zendesk

`assign-ticket`, `add-comment` and `set-ticket-status` are the only functions that change
anything in Zendesk. Edge Functions run
as the service role and **bypass RLS entirely**, so a write endpoint cannot lean on it:
every signed-in account, viewer and content editor included, reaches the same URL with a
valid JWT. `_shared/auth.ts -> requireRole` verifies the caller's token with `getUser`
(never by decoding it) and looks their role up with the service key, because a
`content_editor` cannot read `app_users` at all and that is indistinguishable from having
no role. None of them touches anything else on the ticket.

`set-ticket-status` accepts **only** `open`, `pending` and `solved`, named in the function
rather than passed through: `new` is Zendesk's word for "nobody has replied yet" and
`closed` is terminal and set by its automations. It asks for no confirmation because
solving is quiet and reversible — CUI's active triggers were read, and none notifies the
requester on a status change; the reopen trigger notifies the assignee, which is correct.
Reopening clears `solved_at`, or the 7-day grace window would drop a ticket out of the
mirror while somebody is working on it.

`add-comment` posts an internal note or a public reply, optionally setting the ticket's
status in the same PUT — Zendesk's own "submit as", and one request so a note can never
land with its status change lost. It turns @mentions into **followers**. Zendesk's real @mentions are an agent-interface feature with no documented
API; a follower is the same outcome by the supported route, and CUI's account has
`ticket_followers_allowed` and `follower_and_email_cc_collaborations` both on (checked
against `/api/v2/account/settings.json`, not assumed). The `@Name` is plain text; the
notification is the follower. Mentions are refused for anyone outside
`zendesk_agents.assignable`, and are not offered at all on a public reply, so an internal
handle cannot travel out in a customer email. **`public` must arrive as the
literal boolean `true`** — a missing field, `"true"`, or any other truthy value posts an
internal note, so the safe outcome is the one you get by accident. The function was
renamed from `add-internal-note` when public replies were added: a function still called
that while emailing requesters is how somebody eventually sends the wrong thing. A public
reply also re-derives the ticket's reply state (`last_reply_by`, `trailing_agent_messages`
and the rest) on the spot, because it flips waiting-on-us to waiting-on-them and the queue
is what you look at next. The composer is a `contenteditable`, so its HTML is whatever the
browser produced on paste; `_shared/note-html.ts` keeps it to a dozen tags and drops any
href that is not plainly `http(s):` or `mailto:`. It is unit-tested in Node — the file is
plain enough that `node --test` strips its types — because a sanitiser nobody tests is a
sanitiser nobody has checked. The posted comment is mirrored into `ticket_comments` with
its real Zendesk id, so the thread is not missing it until the next sync and the later
upsert is idempotent.

Assignees come from `zendesk_agents.assignable`, a **hub-side curation of eight people**,
not from group membership: the Zendesk group carries fifteen, including staff who no
longer work this queue and outside contractors. Sync never names that column in its
upsert, so the flag survives, and a new group member defaults to not assignable.

### Why the front end cannot own the ingest

Zendesk blocks browser CORS, the Anthropic key would ship in the bundle, and the
check-in monitor has to run whether or not anyone has the tab open.

## Stack

- Vite + React 18, no router. Section state lives in `App.jsx`, which keeps GitHub Pages
  subpath hosting trivial.
- `@supabase/supabase-js` for auth and reads. `lucide-react` for icons.
- Plain CSS with custom properties (`src/index.css`), brand tokens in
  `brand/tokens.css`, extracted from the official logo and icon assets in `brand/`.
- Supabase project `Kanahoma Web Content Hub`, ref `vantaufqxthqmlakaxbi`.

## The queue model

Ranking is the product. Three commitments share one clock — the requester's deadline,
the ETA we promised, and the first-response SLA — and whichever breaches first wins,
regardless of type. Ranking by *kind of commitment* instead of *time remaining* is how a
deadline two days out ends up above an ETA due in two hours.

| Tier | Meaning |
|---|---|
| 0 | Critical impact: blocking or misleading a student/prospect on the live site |
| 1 | Breached: a deadline or an ETA already passed |
| 2 | Due within 72h, sorted by hours remaining |
| 3 | VIP requester waiting on us |
| 4 | Tone urgency: the model reads the requester as pressed |
| 5 | Has a deadline further out |
| 6 | Everything else, by how long it has waited |
| 7 | Waiting on the requester — never urgent |
| 8 | Requested pre-launch — filed against a site that no longer exists |

The queue offers three cuts of the same filtered list: **By priority** (the ranking),
**By assignee** (who is carrying what) and **By due date** (a flat calendar view). Filters
persist in `localStorage`; the search box deliberately does not, because a stale search
term hides tickets silently where a lit-up chip does not. There is no Overdue or Assigned
to me chip: overdue is already a tier heading, and the assignee dropdown is a superset of
the second.

Tier is computed in the `ticket_queue` view; the ordering *inside* a tier is
`src/lib/queue.js -> sortQueue`, which puts **VIPs first within their tier**. Tier 3 then
only catches VIPs with nothing else wrong, which is the gap it used to leave: flagging a
requester did nothing for their critical or overdue tickets.

**Pre-launch outranks every other rule, critical impact included.** The view also exposes
`base_tier`, the tier a ticket would otherwise have had, and `sortQueue` uses it as the
first tie-break. Without it the pre-launch bucket — around 60% of the open queue — would
be an undifferentiated pile with its breached tickets scattered through it. A pre-launch
ticket that really does need doing now gets pinned; pinned beats tier.

**Pins are per user and private.** `ticket_pins` is keyed on `(user_id, ticket_id)` with
one RLS policy covering read and write, so a pin never moves anybody else's queue.
`ticket_queue.pinned` is an `exists` against it on `auth.uid()`, which only works because
every view is `security_invoker`: the queue has to be read as the person asking.
`ticket_overrides.pinned` predates this, was global, never had a control, and no longer
feeds the queue.

`src/lib/queue.js -> groupQueue` turns the sorted queue into the groups it renders as,
pins first in every view. It is a plain function so the bucketing is testable, which the
inline version in `App.jsx` was not.

### Stalled tickets

Silence alone never means "close". Once the requester has been quiet for three business
days, what the ticket needs depends on what our last message was doing
(`ticket_insights.last_agent_message_kind`):

- `delivery` → **close_candidate**. We delivered and asked for confirmation.
- `question` with one unanswered message from us → **follow_up**. Chase it.
- `question` with two or more, and critical → **flag_george** (George Allen III).
- `question` with two or more, not critical → **close_candidate**.

## Database

Schema lives in `supabase/migrations/`, applied in filename order. Key tables:

- `clients` — one row per client. Timezone and EOD hour drive all business-hour maths.
- `tickets`, `ticket_comments` — mirror of the **unsolved** Web Team queue only, plus a
  7-day grace window after a ticket is solved. Derived reply state
  (`first_agent_reply_at`, `last_reply_by`, `trailing_agent_messages`) is computed at
  ingest so the UI never scans comments.
- `ticket_insights` — one row per ticket, replaced when `content_hash` changes.
  **`ai_critical_impact` holds the model's own verdict, untouched.** Keyword rules layer
  on top at read time; they never overwrite it. `institutional_knowledge`
  (`none`/`some`/`high`) plus a one-line note answers a question complexity does not:
  *can this be handed to someone new?* The two come apart often — "remove the hyperlinks
  below" is easy, fast and needs deep knowledge, because the requester never said which
  page.
- `tickets.follower_ids` — agents tagged on a ticket. Zendesk returns them on the ticket
  object the search already fetches, so mirroring them is free. Followers are what an
  @mention creates, which is why Leadership can list "tagged" tickets without caring
  whether the tag came from the hub or from Zendesk.
- `ticket_etas` — append-only history of every date we promised. Latest wins.
- `urgency_rules` — optional keyword overrides, evaluated by the view, so editing one
  re-ranks the queue instantly with no re-analysis and no tokens.
- `allowed_requester_domains` — anything outside the list is spam: excluded from the
  queue and never sent to the model.
- `student_workers`, `work_shifts`, `time_off`, `check_events` — scheduling and the
  check-in record.

### Views

`ticket_queue` (the ranked queue), `recently_resolved`, `spam_tickets`,
`enrichable_tickets`, `requester_directory`, `ticket_spam_status`.

**Every view is `security_invoker = true`.** Postgres views otherwise run as their owner
and read straight past RLS, which would expose the whole queue to an anonymous visitor.

### RLS

Four roles in `app_users`: `admin` (Ivan), `manager` (Matt — can curate VIPs, ETAs,
keyword rules, schedules, but nothing structural), `viewer`, and `content_editor` (the
student workers). A new sign-up lands as `viewer` via the `on_auth_user_created` trigger;
promotion is deliberate. Edge Functions use the service role and bypass RLS entirely.

`content_editor` is scoped to the tickets assigned to them, via
`app_users.zendesk_agent_id` and the `can_see_ticket()` helper. The link is set explicitly
rather than matched on email: a hub sign-in address that differs from the Zendesk one
would otherwise produce an empty queue with nothing to explain it.

`allowed_requester_domains` stays readable by **every** role. `ticket_spam_status` is
`security_invoker` and derives `is_spam` from that list, so a role that cannot read it
sees an empty allowlist, classifies every requester as spam, and gets an empty queue.

## Zendesk specifics, learned from the live instance

- **The autoresponder is deterministic.** `author_id = -1`, `via.channel = "rule"`, from
  the trigger *"Web Team - Ticket Receipt Rebuild Content Freeze"*. Its text promises the
  requester an ETA, which is why ETA tracking matters. `via.source.rel = "merge"` marks
  ticket-merge notices. Both are `author_side = 'system'` and are excluded from every
  reply-timing calculation and from the model's context.
- **Reopen counts are not on the ticket.** They live in the metric set, sideloaded via
  `tickets/show_many.json?include=metric_sets` — one call per 100 tickets, fetched for
  every open ticket rather than only the changed ones, because a ticket can be reopened
  back into this queue without its comment thread changing.
- **"Not a CRM user" is not a scope decision.** Internal notes answering for another
  team's system say nothing about whether the change is ours, and they are often written
  by other CUI teams despite sitting on our side of the ticket: the one that triggered
  this rule was authored by a contractor who is in the Zendesk Web Team group but works
  CRM. The enrichment prompt forbids concluding that a ticket belongs to another
  department at all, since the queue is the web team's by definition.
- **Staff and faculty live in a Faculty custom post type.** An exit is deleting that
  entry, a hire is creating one. There is one known place, so these rate `none` for
  institutional knowledge rather than reading as a hunt across the site.
- **No structured field is usable.** Across the open queue, `priority` is empty on
  ~90%, `due_at` on 100%, and every custom field (Project, Delayed By, Minutes Worked) on
  100%. All signal lives in free text. The hub does not mirror dead fields.
- Comparing `updated_at` needs `Date.getTime()`, not string equality: Postgres renders
  `+00:00` where Zendesk sends `Z`.
- **The model is sent trimmed comments.** `_shared/email-body.ts -> trimComment` strips
  signatures and quoted reply chains before the thread reaches the prompt, which is 34-42%
  fewer input tokens on the heaviest threads, measured. Quoted history is worse than
  useless to the model: it is old text it can mistake for new. The **content hash is
  computed over the raw body**, so a real change still triggers a re-analysis.
- **A prompt change does not mean re-analysing everything.** `enrich-tickets` accepts
  `{ticket_ids, force, preview}`. `preview` prices the run against what the job has
  actually cost lately without spending anything; `ticket_ids` with `force` re-reads only
  the tickets a rule change can plausibly affect. The whole queue is $0.89; one ticket is
  $0.02. Four unnecessary full re-runs in one afternoon are what made 18 August cost
  $3.72 against a $0.02-0.60 baseline.
- **Comment bodies keep their newlines.** `stripHtml` used to collapse every run of
  whitespace, which ran the message, the signature and the quoted chain into one
  unbroken line: unreadable, and impossible to trim. `src/lib/emailBody.js -> trimComment`
  then cuts the quoted chain, the legal footer and the signature block at display time
  only, so the full text is always still there behind a toggle. It halves what is on
  screen across the queue.

## Dates

Timestamps render in the client's timezone. **Date-only values must not be.**
`new Date("2026-09-07")` parses as UTC midnight and renders as the 6th anywhere behind
UTC, so `formatDate` detects `YYYY-MM-DD` and formats it as written. Getting this wrong
shows every ETA and deadline a day early, silently.

## Environment

`.env` is gitignored; `.env.example` documents it. `VITE_*` values are public by design —
the publishable key only permits what RLS allows. Zendesk and Anthropic credentials live
**only** as Supabase Edge Function secrets, never in `.env` for production use:

- `ZENDESK_EMAIL`, `ZENDESK_TOKEN`, `ANTHROPIC_API_KEY`

## Commands

```bash
npm install
npm run dev                              # http://localhost:5175
npm run build
npm test                                 # renderer fidelity + nav role gating

python3 scripts/probe_zendesk.py         # read-only API probe, dumps to data/
./scripts/deploy-function.sh sync-zendesk
```

## Tools

Standalone utilities that are not about the queue. `Tools` is a nav heading with
`navigable: false` — it groups its children and has no page of its own.

### Article Generator

`.docx` / markdown / pasted text in, WordPress Gutenberg block markup for cui.edu out,
plus a companion file for the excerpt, SEO fields and publishing checklist.

The architecture is the point: **the model never sees the article on the way out.**

```
browser: parse .docx ──► numbered nodes ──┬──► model ──► indices + labels ──┐
                                          │                                 ▼
                                          └───────── text ────────────► renderer ──► markup
```

`src/lib/articleSource.js` parses in the browser (mammoth for `.docx`, marked for the
rest); the file never leaves the machine. `analyze-article` sends only `index | type |
text` and gets back indices: which node is the series note, which range is an author bio,
which node carries a typo. `src/lib/gutenberg.js` renders. The author's prose goes parser
→ renderer without touching the model, so "never invent content" is structural rather than
a prompt instruction. The model writes only the excerpt and typo find/replace pairs.

Two details that break naive implementations:

- **`--` is illegal in an HTML comment**, so block attributes carry `--`. Those
  six characters must reach the output literally. `serializeAttrs` escapes runs of two or
  more hyphens *after* `JSON.stringify`, which is why `gold-500` stays readable.
- **An unused `pad`/`mar` in `kanahomaResp` is an empty array**, not an object.

Attribute shapes are copied from `test/fixtures/reference-approved-article.txt`, an
article the client signed off. `npm test` re-renders its headings, pull quote and staff
card and diffs them against it, so drift fails the build. The 1,000-character Read More
threshold is derived from those fixtures: it reproduces both a 690-character bio staying
whole and a 913-character opener collapsing the rest.

Known gaps, surfaced as flags rather than hidden: lists, sub-headings and the pull quote
appear in no published CUI article, so their styling is unproven in production.

## Not built yet

- **Slack.** The check-in / check-out channel is in CUI's *eagles* workspace, not
  Kanahoma's. Reading it needs an app installed there. Alerts and the check-in monitor are
  blocked on that.
- **Asana**, and email intake via Microsoft Graph (Outlook), scoped to one label rather
  than the whole mailbox.
