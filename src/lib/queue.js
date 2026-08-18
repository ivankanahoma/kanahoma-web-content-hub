// Everything about how the queue is described and ordered lives here, so the tier model
// has exactly one definition on the client.

export const CLIENT_TIMEZONE = "America/Los_Angeles";

export const TIERS = {
  0: {
    label: "Critical impact",
    hint: "Blocking or misleading a student/prospect on the live site",
    tone: "critical",
  },
  1: {
    label: "Overdue",
    hint: "A deadline or an ETA we promised has already passed",
    tone: "critical",
  },
  2: {
    label: "Due within 72h",
    hint: "Sorted by hours remaining, whatever comes due first",
    tone: "high",
  },
  3: { label: "VIP waiting", hint: "A flagged requester is waiting on us", tone: "high" },
  4: { label: "Sounds urgent", hint: "The requester reads as pressed", tone: "medium" },
  5: { label: "Scheduled", hint: "Has a deadline further out", tone: "normal" },
  6: { label: "Waiting on us", hint: "No deadline attached", tone: "normal" },
  7: { label: "Waiting on requester", hint: "The ball is with them", tone: "muted" },
  8: {
    label: "Requested pre-launch",
    hint: "Filed against the old site, so it ranks last whatever it says",
    tone: "muted",
  },
};

export const STALLED_ACTIONS = {
  follow_up: {
    label: "Follow up",
    hint: "Quiet 5+ business days on a question we asked, or on anything critical",
  },
  close_candidate: {
    label: "Can close",
    hint: "Delivered and unconfirmed, or asked twice with no reply, for 5+ business days",
  },
  flag_george: {
    label: "Flag George",
    hint: "Critical, already chased twice, still no reply",
  },
};

export const COMPLEXITY_LABEL = { easy: "Easy", medium: "Medium", complex: "Complex" };
export const EFFORT_LABEL = { fast: "Fast", time_consuming: "Time-consuming" };

/**
 * How much CUI or CMS knowledge the ticket needs beyond what it says. This answers a
 * different question from complexity: not "how hard is this" but "can I hand it to
 * someone new?". A one-word deletion and a new article can both be easy and fast, and
 * only one of them needs somebody who knows which category it takes.
 */
export const KNOWLEDGE_LABEL = {
  none: "No institutional knowledge",
  some: "Some institutional knowledge",
  high: "Deep institutional knowledge",
};

export const DUE_KIND_LABEL = {
  requester_deadline: "requester deadline",
  promised_eta: "our ETA",
  first_response: "first reply due",
};

/**
 * A commitment and the reply clock are not the same kind of debt, so the row shows them
 * differently. A deadline or an ETA is a date somebody named out loud; the first-response
 * SLA is a service target the hub computed. Rendering both at the same weight made every
 * unanswered ticket look like a broken promise.
 */
export function dueParts(ticket) {
  const commitment = ticket.hours_to_commitment != null
    ? {
      hours: Number(ticket.hours_to_commitment),
      kind: ticket.eta_at != null &&
        (ticket.requester_deadline_at == null ||
         new Date(ticket.eta_at) <= new Date(ticket.requester_deadline_at))
        ? "promised_eta"
        : "requester_deadline",
      date: ticket.requester_deadline_at != null &&
        (ticket.eta_at == null ||
         new Date(ticket.requester_deadline_at) < new Date(ticket.eta_at))
        ? ticket.requester_deadline
        : ticket.eta_date,
    }
    : null;

  // Only worth showing once a commitment is already on screen if it is still open.
  const sla = ticket.first_response_due_at != null
    ? { hours: (new Date(ticket.first_response_due_at) - Date.now()) / 36e5 }
    : null;

  return { commitment, sla };
}

/**
 * Tier first, then whatever breaches soonest. Sorting inside a tier by time rather than
 * by the kind of commitment is what stops a deadline two days out from outranking an ETA
 * due in two hours. Already-breached items carry negative hours, so the worst offender
 * naturally lands on top.
 *
 * A VIP sorts to the top of whatever tier it lands in. Inside Critical that puts a VIP's
 * broken page above everyone else's, which is the point: a flagged requester is flagged
 * because their tickets come first, and a tier of its own only ever caught the VIPs with
 * nothing else wrong.
 *
 * `base_tier` breaks ties before the clock does, which only ever matters in the
 * pre-launch bucket: thirty-odd tickets share tier 8, and without their original tier the
 * critical and already-breached ones would be scattered through the pile.
 */
export function sortQueue(rows) {
  return [...rows].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (!!a.is_vip !== !!b.is_vip) return a.is_vip ? -1 : 1;
    if (a.base_tier !== b.base_tier) return (a.base_tier ?? 9) - (b.base_tier ?? 9);

    const aDue = a.hours_to_due;
    const bDue = b.hours_to_due;
    if (aDue != null && bDue != null) return aDue - bDue;
    if (aDue != null) return -1;
    if (bDue != null) return 1;

    return (b.age_days ?? 0) - (a.age_days ?? 0);
  });
}

export function zendeskUrl(subdomain, id) {
  return `https://${subdomain}.zendesk.com/agent/tickets/${id}`;
}
