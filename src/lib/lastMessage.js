// The most recent message on a ticket, and the reason it is two queries.
//
// A PostgrestFilterBuilder is mutable: `.order()` returns the same object with the clause
// appended, not a copy. Deriving both queries from one builder produced
// `order=created_at.asc,created_at.desc` on BOTH, so "first" and "last" came back as the
// same row and the block silently never rendered. Each query gets its own builder, and
// the test below pins that.

/** The autoresponder and merge notices are not messages, so they never qualify. */
const base = (client, ticketId) => client
  .from("ticket_comments")
  .select("id, author_side, author_name, is_public, body, created_at")
  .eq("ticket_id", ticketId)
  .neq("author_side", "system");

export const oldestQuery = (client, ticketId) =>
  base(client, ticketId).order("created_at", { ascending: true }).limit(1);

export const newestQuery = (client, ticketId) =>
  base(client, ticketId).order("created_at", { ascending: false }).limit(1);

/**
 * Returns the last message, or null when the only thing on the thread is the original
 * request: in Zendesk the first comment *is* the ticket description, which the summary
 * already covers.
 */
export async function fetchLastMessage(client, ticketId) {
  const [oldest, newest] = await Promise.all([
    oldestQuery(client, ticketId),
    newestQuery(client, ticketId),
  ]);
  const last = newest.data?.[0] ?? null;
  const first = oldest.data?.[0] ?? null;
  return last && last.id !== first?.id ? last : null;
}
