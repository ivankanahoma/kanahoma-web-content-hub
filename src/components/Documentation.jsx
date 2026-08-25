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
            <tr><td>8. Waiting on requester</td><td>The ball is with them, so it sits near the bottom</td></tr>
            <tr><td>9. Requested pre-launch</td><td>Filed against the old site, so it ranks last whatever it says</td></tr>
          </tbody>
        </table>

        <h4>Three rules decide the tier before the clock does</h4>
        <p>
          Tiers 2 to 8 are all about timing, but three conditions are checked first and
          override them, in this order:
        </p>
        <ul>
          <li>
            <strong>Pre-launch goes last, without exception.</strong> A ticket filed
            before cui.edu went live describes a site that no longer exists, so however
            urgently it reads, it is not what to work on next. This overrides everything,
            including critical impact.
          </li>
          <li>
            <strong>Then critical impact wins outright.</strong> A ticket that is breaking
            something live stays at the top even when we are blocked on the requester —
            that is not a reason to park it, it is a reason to chase them.
          </li>
          <li>
            <strong>Otherwise, waiting on the requester sends it down</strong>, even if a
            date has already passed. An overdue ticket we cannot act on is not work you
            can pick up, so it does not compete with work you can.
          </li>
        </ul>
        <p>
          The pre-launch bucket still sorts internally: inside it, tickets keep the tier
          they would otherwise have had, so the critical and already-breached ones sit at
          the top of the pile rather than scattered through it.
        </p>
        <p>
          This is the one part of the ordering that surprises people: a ticket can be
          overdue and still appear last. Filter by <strong>Waiting on us</strong> for the
          list you can actually act on today, or by <strong>Waiting on them</strong> to
          see what is parked.
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

        <h4>Closing a group</h4>
        <p>
          Every group heading is a control: click it and the group folds away, in any of
          the three views. The count stays on the heading, so a closed group still tells
          you how much is behind it rather than hiding the number along with the rows.
        </p>
        <p>
          What you closed is remembered, and it is remembered per group rather than per
          view, so closing <strong>Requested pre-launch</strong> does not also close
          somebody's name over in By assignee.
        </p>

        <h4>Pinning</h4>
        <p>
          The pin on a row puts a ticket in a <strong>Pinned</strong> group above
          everything else, in every view. It is a note to yourself about what you are
          working on right now, so it outranks anything the ranking has an opinion about,
          including a pre-launch ticket that really does need doing today.
        </p>
        <p>
          <strong>Pins are private.</strong> Yours are yours: nobody else's queue moves
          when you pin something, and nobody can see what you have pinned. That is
          enforced in the database rather than in the interface, so it holds however the
          data is reached.
        </p>

        <h4>A VIP leads its tier</h4>
        <p>
          Inside whatever tier it lands in, a flagged requester's ticket sorts first. In
          Critical that means a VIP's broken page sits above everyone else's, at the very
          top of the queue. A VIP does not jump a tier: critical still outranks a VIP who
          is merely overdue, and a pinned ticket still beats both.
        </p>
        <p>
          The <strong>VIP waiting</strong> tier is still there, and now only catches the
          flagged requesters who have nothing else wrong with their ticket. That was
          always the gap: flagging someone did nothing for their urgent tickets, only for
          their quiet ones.
        </p>

        <h4>A commitment is not the reply clock</h4>
        <p>
          The three feed the <em>ranking</em> equally, but they do not <em>read</em>
          equally. A deadline or an ETA is a date somebody named out loud. The
          first-response SLA is a target the hub computed from when the ticket arrived.
        </p>
        <p>
          So the row shows a commitment at full weight, with a coloured rule, its kind and
          its date, and drops the reply clock to a grey line underneath. A ticket with no
          commitment at all shows only the small reply clock. Before this, an unanswered
          ticket with no promises attached looked exactly like a broken promise.
        </p>

        <h4>Three ways to cut the list</h4>
        <p>
          <strong>By priority</strong> is the ranking above and answers "what next".
          <strong> By assignee</strong> groups the same filtered tickets by who owns them,
          your own name first, then the heaviest queues, unassigned last: the ranked view
          cannot answer "who is carrying what", because one person's work is scattered
          across every tier. <strong>By due date</strong> is the calendar view, one flat
          list soonest first, for "what is landing this week".
        </p>

        <h4>The filters, and what is deliberately missing</h4>
        <p>
          The chips are the ones worth toggling constantly; the dropdowns underneath
          narrow by assignee, requester, institutional knowledge, complexity, effort, age
          and launch phase. Everything survives a reload except the search box.
        </p>
        <p>
          There is no <strong>Overdue</strong> or <strong>Critical</strong> chip: both are
          tiers, so they are already headings you can scroll to. There is no{" "}
          <strong>Assigned to me</strong> chip either, because the assignee dropdown does
          that and more. A filter that duplicates something already on screen costs
          attention and buys nothing.
        </p>
        <p>
          <strong>No ETA</strong> is the one worth checking daily. The autoresponder
          promises every requester an ETA, so a ticket sitting there without one is a
          promise already broken, and it is invisible to the ranking because there is no
          date to miss.
        </p>
        <p>
          <strong>CSV</strong> exports exactly what the filters are showing, not the whole
          table. What you exported is what you were looking at.
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
          <strong>"Us" means the Web Team group in Zendesk</strong>, not anyone holding an
          agent or admin role. CUI runs several groups, and staff outside this one reply on
          tickets too; counting their messages as ours made tickets look answered by a team
          that had not touched them.
        </p>
        <p>
          Sides are also decided <strong>per ticket</strong>. A Web Team member who files a
          ticket of their own is the requester on it, and their messages are what we owe an
          answer to.
        </p>
        <p>
          The autoresponder and Zendesk's merge notices are excluded from this entirely.
          They are not human replies, so they never make a ticket look answered.
        </p>

        <h4>Answered, and reopened</h4>
        <p>
          <strong>Recent activity</strong> carries an <strong>Answered</strong> or
          <strong> Not answered</strong> badge: whether our last public message came after
          theirs. A ticket nobody has replied to at all is Not answered whatever its status
          says. A list of who wrote recently is only useful if it also says whether anyone
          picked it up.
        </p>
        <p>
          It appears there and not in the queue, where the waiting chip already carries the
          same fact. Two badges saying one thing is one badge too many.
        </p>
        <p>
          <strong>Reopened</strong> comes from Zendesk's own ticket metrics, not from a
          guess. It means the ticket was solved and came back, which is work we thought was
          finished and is not. There is no field for it on the ticket itself, so it is
          sideloaded from the metric set at sync.
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

        <h4>Everything in this queue is ours</h4>
        <p>
          The model is not allowed to conclude that a ticket belongs to another
          department. It reads a queue that is the web team's by definition, so "this is
          not for us" is never an available answer.
        </p>
        <p>
          Two things used to mislead it. An internal note answering for somebody else's
          system — <em>"Not a CRM user"</em>, <em>"no Banner record"</em> — is one team
          checking their own tools, and says nothing about whether the person appears on
          cui.edu. Those notes are often written by staff from other CUI teams, even
          though they sit on our side of the ticket.
        </p>
        <p>
          And <strong>staff exits and hires are web work, and routine</strong>. Staff and
          faculty live in a Faculty custom post type, so an exit is deleting that entry
          and a hire is creating one. There is a single known place for it, which is why
          these come out needing <em>no</em> institutional knowledge rather than reading
          as a hunt for where the person appears.
        </p>
      </>
    ),
  },
  {
    id: "tagged",
    title: "Tagged tickets",
    body: (
      <>
        <p>
          <strong>Leadership</strong> lists the open tickets the manager is tagged on.
          Tagged means a <strong>follower</strong> in Zendesk, which is what an @mention
          adds, so the list covers tags made from the hub and tags made in Zendesk
          directly.
        </p>
        <p>
          They are the <strong>same rows as the queue</strong>, in the same order, so a
          ticket opens, gets assigned and gets answered here exactly as it does there.
          One row means one set of behaviour to learn, and no reason to leave the page
          you were already on.
        </p>
        <p>
          Followers arrive on the ticket that the sync already fetches, so keeping this
          current costs no extra call to Zendesk.
        </p>
        <p>
          It shows the manager's tags rather than the viewer's, because Leadership is the
          manager's landing page. Which account that is comes from the hub's own roles,
          not from a name written into the code.
        </p>
      </>
    ),
  },
  {
    id: "knowledge",
    title: "Institutional knowledge",
    body: (
      <>
        <p>
          Every ticket carries a judgement about how much CUI-specific or CMS-specific
          knowledge it needs <em>beyond what the ticket itself says</em>. It answers a
          different question from complexity: not "how hard is this" but{" "}
          <strong>"can I hand it to someone new?"</strong>
        </p>
        <table className="doc-table">
          <thead><tr><th>Level</th><th>Meaning</th></tr></thead>
          <tbody>
            <tr>
              <td>None</td>
              <td>The ticket says exactly what to change and where. Anyone who can operate the CMS can finish it from the ticket alone.</td>
            </tr>
            <tr>
              <td>Some</td>
              <td>The ticket says what it wants, but doing it right needs decisions it does not spell out. Publishing an article or event is the common case: which categories it takes, where it surfaces, which template applies.</td>
            </tr>
            <tr>
              <td>Deep</td>
              <td>It cannot be finished from its own text. Someone has to know where the authoritative information lives, who owns it, or what the university's convention is. This also covers a requester who was vague, where working out what they meant means already knowing the site.</td>
            </tr>
          </tbody>
        </table>
        <p>
          The row also shows <strong>what</strong> you would need to know, in one line,
          without opening the ticket. That line is the useful part: "which category the
          article takes and where it surfaces" tells you who can pick it up, where a
          difficulty score does not.
        </p>
        <h4>It is not the same as easy</h4>
        <p>
          The two come apart constantly. "Please remove the hyperlinks below" is an easy,
          fast edit and needs <strong>deep</strong> knowledge, because the requester never
          said which page. A long article import can be routine once you know the category
          conventions. Filter on knowledge, not on complexity, when you are deciding what
          to delegate.
        </p>
        <p>
          Only <strong>Some</strong> and <strong>Deep</strong> get a chip. Marking the
          straightforward ones too would put a badge on every row and say nothing.
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
        <h4>It is the strongest rule in the ranking</h4>
        <p>
          A pre-launch ticket drops to its own bucket at the very bottom of the queue,
          below even the ones waiting on the requester, and nothing outranks it. A
          pre-launch ticket marked critical impact still goes to the bottom.
        </p>
        <p>
          That is deliberate and it is worth knowing, because it is the one rule that can
          bury something that reads as urgent. Roughly six in ten open tickets are
          pre-launch today. If one of them turns out to describe a problem that is still
          live on the new site, the fix is not to change the ranking: pin it, and it
          jumps to the top of the queue regardless of tier.
        </p>
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
          <strong>Refresh</strong> in the queue toolbar runs both steps immediately rather
          than waiting for the next scheduled one. Close five tickets in as many minutes
          and the queue agrees straight away. It pulls first and re-reads second, in that
          order, so the model never analyses a thread the sync has not caught up with.
        </p>
        <p>
          Reply drafts are generated only when you ask for one, and are never sent. You
          copy them into Zendesk yourself.
        </p>
        <p>
          What reaches the model is the <strong>trimmed</strong> thread: signatures and
          quoted reply chains are stripped first. That is a third to a half fewer tokens on
          an email-heavy ticket, and quoted history is worse than useless to it anyway,
          being old text it can mistake for new. Whether a ticket needs re-reading at all
          is still decided on the untouched text, so nothing goes stale.
        </p>

        <h4>The three things the hub writes back</h4>
        <p>
          <strong>Changing the status</strong> is the third. Open, pending and solved are
          settable from the row. <em>New</em> is Zendesk's own word for "nobody has replied
          yet", so it is shown but never offered, and <em>closed</em> is terminal and set
          by Zendesk's automations rather than by people.
        </p>
        <p>
          Solving asks for no confirmation, because it is quiet and reversible: CUI's live
          triggers were checked, and none of them emails the requester on a status change.
          Reopening a solved ticket does notify its assignee, which is Zendesk's own
          trigger and the right behaviour. A solved ticket stays visible here for seven
          days and then drops out, and reopening within that window puts it straight back.
        </p>
        <p>
          Two other things write back. <strong>Assigning a ticket</strong> is the first: pick
          someone in the expanded ticket and the change goes to Zendesk immediately,
          because an assignee that only existed in the hub would disagree with the system
          of record within minutes.
        </p>
        <p>
          The second is the <strong>comment composer</strong>, which sits open inside an
          expanded ticket rather than behind a button. It starts on{" "}
          <strong>Internal note</strong> and says so three times over: the switch, the
          cream Zendesk colouring, and the button, which reads <em>Post note</em>.
          Links and attachments are supported, up to 5&nbsp;MB a file and 8&nbsp;MB in
          total.
        </p>
        <p>
          Switching to <strong>Public reply</strong> changes all three at once. The cream
          goes, the header names the person who will receive it, and the button reads{" "}
          <em>Send public reply</em>. The whole box changing colour is what someone
          notices when they are not reading, which is the case that matters. Because a
          public reply is emailed and cannot be unsent, it asks once before sending. An
          internal note never does.
        </p>
        <h4>The last message</h4>
        <p>
          Opening a ticket shows the most recent message on the thread, whoever wrote it
          and whether or not it was public, right above the box you reply in. The badge
          says which it was, and an internal note carries the same cream as the composer,
          so "who can see this" reads the same whether you are reading or writing.
        </p>
        <p>
          Most comments arrive by email, so they carry a signature block and the whole
          quoted reply chain behind the two useful sentences. Those are trimmed off before
          the message is shown. Across the queue that is 54% fewer characters on screen,
          and on the worst offender it is 794 characters down to 252.
        </p>
        <p>
          Nothing is thrown away. The full text stays in the database and the row offers
          to show it, so a rule that trims too keenly costs a click rather than a message.
          A sign-off keeps its own line, because "Thanks!" is something the person wrote;
          what goes is the name, title, company and contact details underneath it.
        </p>
        <p>
          The original request is deliberately not shown. In Zendesk the first comment
          <em>is</em> the ticket description, which the summary at the top already covers,
          so a ticket nobody has answered yet shows nothing here rather than repeating
          itself. The autoresponder and Zendesk's merge notices are excluded too: they are
          not messages.
        </p>

        <h4>Mentioning someone</h4>
        <p>
          Type <strong>@</strong> in an internal note and pick a name. The person is added
          to the ticket as a <strong>follower</strong> in Zendesk, which emails them the
          update and lets them see internal notes.
        </p>
        <p>
          Worth knowing what this is underneath. Zendesk's real @mentions are a feature of
          its own agent interface with no documented API, so the hub cannot create one.
          Followers reach the same outcome by the route that <em>is</em> supported: the
          "@Name" you type is ordinary text, and the notification comes from the follower.
          Someone reading the ticket in Zendesk sees the name and gets the email; what
          they will not see is the blue mention chip Zendesk draws for its own.
        </p>
        <p>
          Deleting the name from the note before sending removes the mention, and a public
          reply offers no mentions at all, so an internal handle never travels out in an
          email to a requester. Only the eight people on the Web Team list can be
          mentioned, the same list that can be assigned work.
        </p>

        <h4>Submitting as a status</h4>
        <p>
          Hovering the send button opens Zendesk's <strong>submit as</strong> menu:
          <span style={{ whiteSpace: "nowrap" }}> Open, Pending, Solved</span>, in
          Zendesk's own red, blue and grey. The button itself sends nothing; picking one
          of the three posts the comment <em>and</em> sets that status.
        </p>
        <p>
          Both travel to Zendesk in a single request, so a note can never land with its
          status change lost. Either the whole submit applies or none of it does.
        </p>
        <p>
          The colours are Zendesk's rather than the brand palette on purpose. The team
          reads those three all day in Zendesk itself, and a private dialect for the same
          three states would be one more thing to translate.
        </p>

        <p>
          On the way out, <em>public</em> has to arrive as the literal value true.
          Anything else, including a missing field, posts an internal note. The safe
          outcome is the one you get by accident.
        </p>
        <p>
          A public reply also moves the ticket from waiting on us to waiting on them, and
          the queue is exactly what you look at next, so the reply state is recomputed
          when the comment is posted rather than left stale until the next sync.
        </p>
        <p>
          What you type is cleaned before it is sent, either way. The composer is a rich
          text box, so a paste from Word or a browser can carry markup with it; only the
          tags a comment needs survive, and an address that is not plainly a web or mail
          link loses its href rather than travelling to Zendesk.
        </p>
        <p>
          Assigning is deliberately narrow. Only admins and managers can do either, and
          nothing else on the ticket is touched: no status, no public reply, no tags. The permission is
          checked against your own sign-in inside the function, not taken from the page,
          because Edge Functions run with full database access and the interface is not
          what stops anyone.
        </p>
        <p>
          The picker lists <strong>eight people</strong>, not the fifteen in the Zendesk
          group. The group also carries Kanahoma staff who no longer work this queue,
          outside contractors and CUI staff who happen to hold an agent seat; offering
          them is how a ticket ends up parked with somebody who is not looking at it. That
          list is curated in the hub, so a sync never overwrites it, and anyone added to
          the Zendesk group later stays off the picker until someone puts them on it.
        </p>
      </>
    ),
  },
  {
    id: "article-generator",
    title: "The Article Generator",
    body: (
      <>
        <p>
          Give it a <code>.docx</code>, a markdown file or pasted text, and it returns the
          Gutenberg block markup for the article body, plus a second file with everything
          that lives outside the content area.
        </p>

        <h4>The model never writes the article</h4>
        <p>
          This is the part worth understanding, because it is what makes the output
          trustworthy. The document is parsed <strong>in your browser</strong> into
          numbered blocks. Only that numbered list is sent to the model, and what comes
          back is <strong>indices, not prose</strong>: block 0 is the series note, blocks
          9 to 12 are the author bio, block 3 has a duplicated word.
        </p>
        <p>
          The author's text goes from the parser straight to the renderer without passing
          through the model. "Never invent content" is not a rule the model is asked to
          follow here. It is something it has no opportunity to do.
        </p>
        <p>
          The two exceptions are named and visible. The <strong>excerpt</strong> is
          written, because an excerpt has to be. <strong>Typo fixes</strong> arrive as
          exact find-and-replace pairs, are applied only when the text matches
          character for character, and every one is listed in the flags.
        </p>

        <h4>What it will not do</h4>
        <ul>
          <li><strong>Invent headings.</strong> An article with no sections is generated with no sections, and the flags say so.</li>
          <li><strong>Choose a pull quote.</strong> Only a blockquote the author actually marked becomes one. Picking a sentence to enlarge is an editorial decision, and inventing emphasis breaks the same rule as inventing text.</li>
          <li><strong>Guess an author's job title.</strong> If the source does not give one, the card has none and the flags say it was not guessed.</li>
          <li><strong>Invent a media library ID.</strong> The photo is a placeholder URL with no ID, because a wrong ID points at someone else's file and breaks the block.</li>
        </ul>

        <h4>Where the markup comes from</h4>
        <p>
          Every attribute is copied from an article CUI has already approved, not derived
          from the design system. The generator is tested against that article: the
          headings, the pull quote and the staff card have to come out matching it, or the
          build fails.
        </p>
        <p>
          Three things have no precedent in any published article: <strong>lists</strong>,
          <strong>sub-headings</strong> and the <strong>pull quote</strong>. They are built
          from valid tokens, but nothing in production proves the theme styles them as
          expected. When an article uses one, the flags tell you to check it in a draft
          preview first.
        </p>

        <h4>Two files, and why the second one matters</h4>
        <p>
          The block markup only fills the content area. The excerpt, the SEO fields, the
          featured image and the template setting all live elsewhere in the WordPress
          admin, and an article missing them looks broken in the places nobody checks: the
          archive cards and the news feed. The second file is that checklist, with the
          values ready to paste.
        </p>
        <p>
          The featured image has to be <strong>1425 x 450</strong> and <code>.webp</code>.
          That ratio is what the card and archive templates expect; anything else gets
          cropped unpredictably across the site.
        </p>

        <h4>Nothing is stored</h4>
        <p>
          The file never leaves your machine. The extracted text reaches the model and is
          not kept. The last ten runs sit in <strong>this browser only</strong>, so they
          are not shared with anyone and do not survive clearing your browser data.
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
            <tr><td>Viewer</td><td>Read only, whole queue.</td></tr>
            <tr><td>Content editor</td><td>The tickets assigned to them, the tools, and this documentation. Nothing else.</td></tr>
          </tbody>
        </table>
        <p>
          A new sign-up starts as a viewer, which sees nothing until an admin grants a
          role. Access is enforced in the database, not in the interface, so a signed-out
          visitor reads nothing at all even though the site is public.
        </p>

        <h4>What a content editor cannot see</h4>
        <p>
          The role exists for the student workers who execute the edits. It is scoped in
          the database rather than in the menu: a content editor's own account cannot read
          a ticket that is not assigned to them, so hiding the sections is a convenience,
          not the protection.
        </p>
        <p>
          Out of reach: the rest of the queue, the requester directory and its contact
          details, spam, urgency keywords, Asana, the Leadership view, the schedules, the
          AI cost record, and the list of hub users. Requesters are visible only where
          they filed a ticket the editor is working on.
        </p>
        <p>
          A content editor is linked to their Zendesk account explicitly rather than by
          matching email addresses. Someone signing in to the hub with a different address
          than Zendesk knows them by would otherwise get a silently empty queue with
          nothing to explain it.
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
