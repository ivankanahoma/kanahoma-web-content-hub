import {
  CalendarClock,
  CheckCircle2,
  KanbanSquare,
  ListChecks,
  ShieldAlert,
  Star,
  Tags,
} from "lucide-react";

/**
 * Sidebar navigation. Everything that is a different view of the same Zendesk work sits
 * under Queue as a child. `ready: false` marks a section that is planned but not built,
 * so the menu shows the shape of the tool without pretending the section works.
 */
export const SECTIONS = [
  {
    id: "queue",
    label: "Queue",
    icon: ListChecks,
    ready: true,
    countKey: "queue",
    children: [
      {
        id: "resolved",
        label: "Recently resolved",
        icon: CheckCircle2,
        ready: true,
        countKey: "resolved",
        blurb: "Solved in the last 7 days. Not work to do.",
      },
      {
        id: "requesters",
        label: "Requesters",
        icon: Star,
        ready: true,
        countKey: "requesters",
        blurb: "Flag the people whose tickets should jump the queue.",
      },
      {
        id: "spam",
        label: "Filtered as spam",
        icon: ShieldAlert,
        ready: true,
        countKey: "spam",
        blurb:
          "Requesters outside the allowed email domains. These never reach the queue " +
          "and are never sent to the model.",
      },
    ],
  },
  {
    id: "keywords",
    label: "Urgency keywords",
    icon: Tags,
    ready: true,
    countKey: "keywords",
    blurb:
      "Optional keyword rules that force a ticket to critical. The model already judges " +
      "every ticket on its own, so this is the manual override for topics you never want " +
      "it to weigh up. Changes re-rank the queue immediately.",
  },
  {
    id: "asana",
    label: "Asana",
    icon: KanbanSquare,
    ready: false,
    blurb: "Tasks assigned to you, alongside the Zendesk queue.",
  },
  {
    id: "students",
    label: "Student Workers",
    icon: CalendarClock,
    ready: true,
    countKey: "students",
    blurb:
      "Working hours, time off and the daily check-in / check-out record for the people " +
      "executing the work.",
  },
];

/** Flat lookup, since the router only ever deals in section ids. */
export const SECTION_BY_ID = Object.fromEntries(
  SECTIONS.flatMap((s) => [[s.id, s], ...(s.children ?? []).map((c) => [c.id, c])]),
);

export function parentOf(id) {
  return SECTIONS.find((s) => (s.children ?? []).some((c) => c.id === id))?.id ?? null;
}
