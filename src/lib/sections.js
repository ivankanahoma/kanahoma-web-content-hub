import {
  BookOpen,
  CalendarClock,
  Gauge,
  CheckCircle2,
  KanbanSquare,
  ListChecks,
  Newspaper,
  ShieldAlert,
  Star,
  Tags,
  Wrench,
} from "lucide-react";

/** Roles that see everything. A content editor is listed section by section instead. */
const STAFF = ["admin", "manager", "viewer"];

/**
 * Sidebar navigation. Everything that is a different view of the same Zendesk work sits
 * under Queue as a child. `ready: false` marks a section that is planned but not built,
 * so the menu shows the shape of the tool without pretending the section works.
 *
 * `navigable: false` marks a heading rather than a destination: Tools groups the
 * standalone utilities and has no page of its own, so its children are always shown.
 *
 * `roles` is presentation only. What a role can actually read is enforced in RLS, and
 * hiding a section here does not protect anything on its own.
 */
export const SECTIONS = [
  {
    id: "queue",
    label: "Queue",
    icon: ListChecks,
    ready: true,
    countKey: "queue",
    roles: [...STAFF, "content_editor"],
    children: [
      {
        id: "activity",
        label: "Recent activity",
        icon: CheckCircle2,
        ready: true,
        countKey: "activity",
        blurb:
          "What moved recently, and who moved it. None of this is a work list — the " +
          "queue decides what to do next.",
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
    id: "leadership",
    label: "Leadership",
    icon: Gauge,
    ready: true,
    blurb:
      "Where the queue stands as a whole: what is critical, what has blown a " +
      "commitment, and what was answered without ever getting an ETA.",
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
    ready: true,
    countKey: "asana",
    blurb:
      "Incomplete tasks assigned to you in Asana, soonest due first. Read only: Asana " +
      "stays the system of record.",
  },
  {
    id: "tools",
    label: "Tools",
    icon: Wrench,
    ready: true,
    navigable: false,
    roles: [...STAFF, "content_editor"],
    children: [
      {
        id: "article-generator",
        label: "Article Generator",
        icon: Newspaper,
        ready: true,
        roles: [...STAFF, "content_editor"],
        blurb:
          "Turns an article document into paste-ready Gutenberg markup for cui.edu, " +
          "plus the excerpt, SEO fields and publishing checklist that live outside the " +
          "content area.",
      },
    ],
  },
  {
    id: "docs",
    label: "Documentation",
    icon: BookOpen,
    ready: true,
    roles: [...STAFF, "content_editor"],
    blurb: null,
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

/** No `roles` means the three original roles. A signed-in account with no role yet sees
 *  nothing, rather than briefly seeing the sections that predate this list. */
const allows = (section, role) =>
  role != null && (section.roles ?? STAFF).includes(role);

/**
 * The menu a given role gets. A parent survives if the role may see it, and is then
 * pruned to the children it may see; a heading that ends up with no children is dropped
 * rather than left as a dead label.
 */
export function sectionsFor(role) {
  return SECTIONS.filter((s) => allows(s, role))
    .map((s) => (s.children
      ? { ...s, children: s.children.filter((c) => allows(c, role)) }
      : s))
    .filter((s) => s.navigable !== false || s.children?.length);
}

/** Where a role lands on sign-in, and the fallback when it cannot see the current one. */
export function homeSectionFor(role) {
  if (role === "manager") return "leadership";
  if (role === "content_editor") return "queue";
  return "queue";
}
