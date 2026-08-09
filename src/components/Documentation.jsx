import { useState } from "react";

/**
 * How the hub works, written for whoever opens it next. Kept in the app rather than a
 * README so it is read where the questions actually come up.
 */
const TOPICS = [
  {
    id: "ordering",
    title: "How the queue is ordered",
    body: (
      <>
        <p>
          Every open ticket lands in exactly one tier. The queue renders them top to
          bottom in this order:
        </p>

        <table className="doc-table">
          <thead>
            <tr><th>Tier</th><th>Meaning</th></tr>
          </thead>
          <tbody>
            <tr><td>1. Critical impact</td><td>Blocking or misleading a student or prospect on the live site</td></tr>
            <tr><td>2. Overdue</td><td>A commitment has already been missed</td></tr>
            <tr><td>3. Due within 72h</td><td>A commitment comes due soon</td></tr>
            <tr><td>4. VIP waiting</td><td>A flagged requester is waiting on us</td></tr>
            <tr><td>5. Sounds urgent</td><td>The model reads the requester as pressed</td></tr>
            <tr><td>6. Scheduled</td><td>Has a commitment further out</td></tr>
            <tr><td>7. Everything else</td><td>No commitment attached, sorted by how long it has waited</td></tr>
            <tr><td>8. Waiting on requester</td><td>The ball is with them, so it sits at the bottom</td></tr>
          </tbody>
        </table>

        <h4>Two rules decide the tier before the clock does</h4>
        <p>
          Tiers 2 to 7 are all about timing, but two conditions are checked first and
          override them:
        </p>
        <ul>
          <li>
            <strong>Critical impact wins outright.</strong> A ticket that is breaking
            something live stays at the top even when we are blocked on the requester —
            that is not a reason to park it, it is a reason to chase them.
          </li>
          <li>
            <strong>Otherwise, waiting on the requester sends it to the bottom</strong>,
            even if a date has already passed. An overdue ticket we cannot act on is not
            work you can pick up, so it does not compete with work you can.
          </li>
        </ul>
        <p>
          This is the one part of the ordering that surprises people: a ticket can be
          overdue and still appear last. Filter by <strong>Waiting on them</strong> to see
          those, or by <strong>Overdue + Waiting on us</strong> for the list you can
          actually act on today.
        </p>

        <h4>Three commitments, one clock</h4>
        <p>
          The queue does not rank by <em>kind</em> of commitment. It ranks by whichever
          one breaches first, whether that is:
        </p>
        <ul>
          <li><strong>A deadline the requester asked for</strong> — a date they named in the ticket.</li>
          <li><strong>An ETA we promised</strong> — a date someone on the team committed to in a reply.</li>
          <li><strong>The first-response SLA</strong> — every unanswered ticket owes a first reply by end of the next business day, 5&nbsp;PM Pacific. A ticket filed Friday is due Monday, not Saturday.</li>
        </ul>
        <p>
          Ranking by kind instead of by time is how a deadline two days out ends up above
          an ETA due in two hours. Inside a tier, tickets sort by hours until breach, so
          the most overdue sits at the top.
        </p>

        <h4>What the ordering deliberately ignores</h4>
        <p>
          Zendesk's own <code>priority</code> field and its <code>due_at</code> field are
          both unused across this queue, so the hub does not read them. Everything that
          drives the order is either computed from the thread or judged by the model.
        </p>
      </>
    ),
  },
  {
    id: "waiting",
    title: "Waiting on us vs waiting on them",
    body: (
      <>
        <p>
          Every row leads with who the ticket is waiting on, because that decides whether
          you can act on it at all.
        </p>
        <ul>
          <li><strong>Waiting on us</strong> — the requester spoke last, or nobody from the team has replied yet.</li>
          <li><strong>Waiting on them</strong> — our message was the last one, so we are blocked.</li>
        </ul>
        <p>
          Sides are decided <strong>per ticket, not per person</strong>. Several CUI staff
          hold an agent role in Zendesk and still file tickets of their own; on those, they
          count as the requester.
        </p>
        <p>
          The autoresponder and Zendesk's merge notices are excluded from this entirely.
          They are not human replies, so they never make a ticket look answered.
        </p>

        <h4>When the requester goes quiet</h4>
        <p>
          After <strong>five business days</strong> of silence, the hub suggests what the
          ticket needs. Five rather than three: at CUI's cadence, three days is still
          "they were busy". What it suggests depends entirely on what our last message
          was doing.
        </p>
        <table className="doc-table">
          <thead><tr><th>Our last message</th><th>What it needs</th></tr></thead>
          <tbody>
            <tr><td>Delivered the work, asked them to confirm</td><td><strong>Can close</strong> — silence reads as acceptance</td></tr>
            <tr><td>Asked a question, chased once</td><td><strong>Follow up</strong></td></tr>
            <tr><td>Asked a question, already chased twice</td><td><strong>Can close</strong>, or <strong>Flag George</strong> if it is critical</td></tr>
            <tr><td>Promised work, or gave a date</td><td>Nothing — see below</td></tr>
            <tr><td>Anything else</td><td>Nothing — no evidence either way</td></tr>
          </tbody>
        </table>

        <h4>Why a promise is not a delivery</h4>
        <p>
          "The updates have been made, let me know if everything looks good" and "we
          should be able to complete this by 8/21" both end with the requester saying
          nothing. Only the first one means they accepted the work.
        </p>
        <p>
          In the second, <strong>we</strong> owe <strong>them</strong>. They have nothing
          to reply to, so their silence carries no information at all — and suggesting a
          close would mean quietly dropping work we committed to, on the tickets least
          likely to be chased. Those tickets are already tracked by their ETA, which is
          what puts them in the Overdue tier if the date passes.
        </p>
        <p>
          Two more guards: a <strong>critical</strong> ticket is never proposed for
          closing, only escalated; and when our last message was neither a delivery, a
          promise nor a question, the hub stays quiet rather than guessing.
        </p>
        <p>
          Closing is always a suggestion. The hub never writes to Zendesk — you close the
          ticket yourself.
        </p>
      </>
    ),
  },
  {
    id: "ai",
    title: "What the AI reads and decides",
    body: (
      <>
        <p>
          Each thread is read once and re-read whenever it changes. The model gets the
          subject and every human comment, with the autoresponder stripped out.
        </p>
        <table className="doc-table">
          <thead><tr><th>Field</th><th>What it means</th></tr></thead>
          <tbody>
            <tr>
              <td>Critical impact</td>
              <td>The live site is right now blocking or misleading a student. A high bar: wrong tuition, a broken application path, wrong start dates, a page returning 404, a compliance problem. Typos and styling do not qualify.</td>
            </tr>
            <tr>
              <td>Complexity</td>
              <td>How much judgement the work needs: easy, medium or complex.</td>
            </tr>
            <tr>
              <td>Effort</td>
              <td>How long it takes: fast or time-consuming. Independent of complexity — a one-word fix on 20 pages is easy and time-consuming.</td>
            </tr>
            <tr>
              <td>Tone urgency</td>
              <td>How pressed the requester sounds, 0 to 3. Tone only. A calm report of a broken form is tone 0 and critical impact true.</td>
            </tr>
            <tr>
              <td>Requester deadline</td>
              <td>A date they asked for, resolved against the date of the comment it appears in.</td>
            </tr>
            <tr>
              <td>Promised ETA</td>
              <td>A date <em>we</em> committed to. Kept strictly separate from the requester's deadline, and editable by hand when the parsing gets it wrong.</td>
            </tr>
          </tbody>
        </table>
        <p>
          The model is instructed never to infer a date, a commitment or a severity that
          nobody wrote down. If it is not in the thread, the field stays empty.
        </p>
      </>
    ),
  },
  {
    id: "keywords",
    title: "Urgency keywords",
    body: (
      <>
        <p>
          Keywords are an optional override on top of the model's judgement, not a second
          classifier. A ticket whose subject or description matches an active keyword is
          forced to critical, whatever the model concluded.
        </p>
        <p>
          They are evaluated when the queue is read, not when a ticket is analysed, so
          adding or removing one re-ranks the queue immediately and costs nothing.
        </p>
        <h4>Why broad words backfire</h4>
        <p>
          Keywords match <strong>topic words</strong>, not problem words. "update" appears
          in most web content requests, so using it as a keyword moves half the queue into
          the top tier — and once most of the queue is critical, the tier stops sorting
          anything. Narrow phrases that describe a fault ("out of compliance", "wrong
          tuition") behave far better than the noun for the work itself.
        </p>
      </>
    ),
  },
  {
    id: "prelaunch",
    title: "The pre-launch flag",
    body: (
      <>
        <p>
          Tickets filed before cui.edu went live carry a <strong>Requested pre-launch</strong>
          badge. They were written against the old site, so they often describe pages or
          behaviour that no longer exists.
        </p>
        <p>
          The cutover date is stored per client rather than in the code, so it can be
          corrected without a release, and the next client brings its own. It is compared
          in the client's own timezone: a ticket filed at 6&nbsp;PM Pacific the day before
          launch is pre-launch, even though it is already the next day in UTC.
        </p>
        <p>The badge is informational. It says when a request was made, not how urgent it is.</p>
      </>
    ),
  },
  {
    id: "spam",
    title: "Spam filtering",
    body: (
      <>
        <p>
          A ticket counts as legitimate when its requester's email domain is on the
          allowlist. Everything else is spam: it never reaches the queue, never reaches
          the resolved list, and is never sent to the model, so junk costs nothing.
        </p>
        <p>
          Filtered tickets stay visible under <strong>Filtered as spam</strong> so a
          mistake in the allowlist is discoverable rather than silent. Once a junk ticket
          is solved in Zendesk it drops off that list too — it is no longer a pending
          decision.
        </p>
        <p>A requester with no email on record is treated as legitimate, so a data gap surfaces a ticket rather than hiding it.</p>
      </>
    ),
  },
  {
    id: "data",
    title: "Where the data comes from",
    body: (
      <>
        <p>
          Zendesk stays the system of record. The hub mirrors it and never writes back —
          nothing you do here changes a ticket.
        </p>
        <ul>
          <li><strong>Every 10 minutes</strong> the unsolved Web Team queue is pulled in. Only threads Zendesk reports as changed are re-fetched.</li>
          <li><strong>Five minutes later</strong> anything whose thread actually changed is re-analysed. An idle ticket costs nothing.</li>
          <li><strong>Solved tickets</strong> stay visible for seven days, then drop out.</li>
        </ul>
        <p>
          Reply drafts are generated only when you ask for one, and are never sent. You
          copy them into Zendesk yourself.
        </p>
      </>
    ),
  },
  {
    id: "access",
    title: "Roles and access",
    body: (
      <>
        <table className="doc-table">
          <thead><tr><th>Role</th><th>Can do</th></tr></thead>
          <tbody>
            <tr><td>Admin</td><td>Everything, including clients, users and integration settings.</td></tr>
            <tr><td>Manager</td><td>Curate the queue: VIPs, ETAs, keywords, notes, schedules. Nothing structural. Lands on Leadership.</td></tr>
            <tr><td>Viewer</td><td>Read only.</td></tr>
          </tbody>
        </table>
        <p>
          A new sign-up starts as a viewer, which sees nothing until an admin grants a
          role. Access is enforced in the database, not in the interface, so a signed-out
          visitor reads nothing at all even though the site is public.
        </p>
      </>
    ),
  },
];

export default function Documentation() {
  const [active, setActive] = useState(TOPICS[0].id);
  const topic = TOPICS.find((t) => t.id === active) ?? TOPICS[0];

  return (
    <div className="docs">
      <nav className="docs-nav" aria-label="Documentation topics">
        {TOPICS.map((t) => (
          <button
            key={t.id}
            className="docs-link"
            aria-current={t.id === active ? "page" : undefined}
            onClick={() => setActive(t.id)}
          >
            {t.title}
          </button>
        ))}
      </nav>

      <article className="docs-body">
        <h2>{topic.title}</h2>
        {topic.body}
      </article>
    </div>
  );
}
