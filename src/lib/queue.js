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

export const DUE_KIND_LABEL = {
  requester_deadline: "requester deadline",
  promised_eta: "our ETA",
  first_response: "first reply due",
};

/**
 * Tier first, then whatever breaches soonest. Sorting inside a tier by time rather than
 * by the kind of commitment is what stops a deadline two days out from outranking an ETA
 * due in two hours. Already-breached items carry negative hours, so the worst offender
 * naturally lands on top.
 *
 * `base_tier` breaks ties before the clock does, which only ever matters in the
 * pre-launch bucket: thirty-odd tickets share tier 8, and without their original tier the
 * critical and already-breached ones would be scattered through the pile.
 */
export function sortQueue(rows) {
  return [...rows].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.tier !== b.tier) return a.tier - b.tier;
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
