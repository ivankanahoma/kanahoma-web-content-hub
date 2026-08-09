#!/usr/bin/env python3
"""Probe the CUI Zendesk instance to design the hub's schema from real data.

Read-only. Dumps raw JSON to data/zendesk_probe/ (gitignored) and prints a summary
focused on the two things we cannot guess from the docs:

  1. How the system autoresponder appears on a ticket, so we can exclude it when
     computing "days without a reply".
  2. Which custom ticket fields the Web Team actually uses.

Usage:
    cp .env.example .env   # fill in ZENDESK_EMAIL and ZENDESK_TOKEN
    python3 scripts/probe_zendesk.py
"""

from __future__ import annotations

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "zendesk_probe"

SAMPLE_TICKET_ID = 75241  # the ticket Ivan pointed at
GROUP_NAME = "Web Team"
DEEP_DIVE_COUNT = 12  # tickets to pull full comment threads for


def load_env() -> None:
    env = ROOT / ".env"
    if not env.exists():
        sys.exit("No .env found. Copy .env.example to .env and fill it in.")
    for line in env.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


class Zendesk:
    def __init__(self, subdomain: str, email: str, token: str) -> None:
        self.base = f"https://{subdomain}.zendesk.com"
        raw = f"{email}/token:{token}".encode()
        self.auth = "Basic " + base64.b64encode(raw).decode()

    def get(self, path: str, **params) -> dict:
        url = self.base + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        for attempt in range(5):
            req = urllib.request.Request(url, headers={"Authorization": self.auth})
            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    return json.loads(resp.read())
            except urllib.error.HTTPError as err:
                if err.code == 429:
                    wait = int(err.headers.get("Retry-After", 30))
                    print(f"  rate limited, waiting {wait}s")
                    time.sleep(wait)
                    continue
                body = err.read().decode(errors="replace")[:400]
                raise SystemExit(f"HTTP {err.code} on {url}\n{body}") from err
        raise SystemExit(f"Gave up after rate limits on {url}")

    def paginate(self, path: str, key: str, cap: int = 2000, **params) -> list:
        """Follow Zendesk cursor pagination until exhausted or `cap` records."""
        out: list = []
        params = {**params, "page[size]": 100}
        url = path + "?" + urllib.parse.urlencode(params)
        while url and len(out) < cap:
            page = self.get(url) if url.startswith("/") else self.get(url[len(self.base):])
            out.extend(page.get(key, []))
            meta = page.get("meta") or {}
            url = (page.get("links") or {}).get("next") if meta.get("has_more") else None
        return out[:cap]

    def search(self, query: str, cap: int = 1000) -> list:
        """Search API uses offset pagination and caps at 1000 results."""
        out: list = []
        page = 1
        while len(out) < cap:
            res = self.get("/api/v2/search.json", query=query, per_page=100, page=page)
            results = res.get("results", [])
            out.extend(results)
            if not res.get("next_page") or not results:
                break
            page += 1
        return out[:cap]


def save(name: str, payload) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{name}.json").write_text(json.dumps(payload, indent=2))


def plain(html_or_text: str, limit: int = 220) -> str:
    text = " ".join((html_or_text or "").split())
    return text[:limit] + ("..." if len(text) > limit else "")


def main() -> None:
    load_env()
    zd = Zendesk(
        os.environ["ZENDESK_SUBDOMAIN"],
        os.environ["ZENDESK_EMAIL"],
        os.environ["ZENDESK_TOKEN"],
    )

    print("== auth ==")
    me = zd.get("/api/v2/users/me.json")["user"]
    print(f"  {me['name']} <{me['email']}> role={me['role']} id={me['id']}")
    save("me", me)

    print("\n== groups ==")
    groups = zd.paginate("/api/v2/groups.json", "groups")
    save("groups", groups)
    web_team = next((g for g in groups if g["name"] == GROUP_NAME), None)
    for g in groups:
        mark = "  <-- target" if web_team and g["id"] == web_team["id"] else ""
        print(f"  {g['id']:>12}  {g['name']}{mark}")
    if not web_team:
        sys.exit(f"Group {GROUP_NAME!r} not found. Fix GROUP_NAME and rerun.")

    print("\n== ticket fields (custom fields the hub may need to mirror) ==")
    fields = zd.paginate("/api/v2/ticket_fields.json", "ticket_fields")
    save("ticket_fields", fields)
    for f in fields:
        if not f.get("active"):
            continue
        opts = [o["value"] for o in (f.get("custom_field_options") or [])]
        tail = f"  options={opts}" if opts else ""
        print(f"  {f['id']:>12}  {f['type']:<16} {f['title']}{tail}")

    print(f"\n== ticket volume in {GROUP_NAME} ==")
    open_tickets = zd.search(f'type:ticket group:"{GROUP_NAME}" status<solved')
    all_recent = zd.search(f'type:ticket group:"{GROUP_NAME}" created>2025-01-01')
    save("tickets_unsolved", open_tickets)
    save("tickets_recent", all_recent)
    print(f"  unsolved now: {len(open_tickets)}")
    print(f"  created since 2025-01-01: {len(all_recent)} (search caps at 1000)")
    print("  by status:", dict(Counter(t["status"] for t in all_recent)))
    print("  by priority:", dict(Counter(t.get("priority") for t in all_recent)))
    print("  by assignee_id:", dict(Counter(t.get("assignee_id") for t in all_recent).most_common(8)))
    print("  top requesters:", dict(Counter(t.get("requester_id") for t in all_recent).most_common(10)))

    print(f"\n== deep dive: ticket {SAMPLE_TICKET_ID} ==")
    ticket = zd.get(f"/api/v2/tickets/{SAMPLE_TICKET_ID}.json")["ticket"]
    comments = zd.paginate(f"/api/v2/tickets/{SAMPLE_TICKET_ID}/comments.json", "comments")
    audits = zd.paginate(f"/api/v2/tickets/{SAMPLE_TICKET_ID}/audits.json", "audits")
    save("sample_ticket", ticket)
    save("sample_comments", comments)
    save("sample_audits", audits)
    print(f"  subject: {ticket['subject']}")
    print(f"  status={ticket['status']} priority={ticket.get('priority')} "
          f"assignee={ticket.get('assignee_id')} requester={ticket['requester_id']}")
    print(f"  created={ticket['created_at']} updated={ticket['updated_at']}")

    # Resolve every author so we can tell humans from the system/trigger user.
    author_ids = {c["author_id"] for c in comments}
    users = {}
    for uid in author_ids:
        try:
            users[uid] = zd.get(f"/api/v2/users/{uid}.json")["user"]
        except SystemExit:
            users[uid] = {"name": "?", "role": "?", "email": None}
    save("sample_comment_authors", users)

    print(f"\n  {len(comments)} comments:")
    for i, c in enumerate(comments):
        u = users.get(c["author_id"], {})
        via = (c.get("via") or {}).get("channel")
        rel = ((c.get("via") or {}).get("source") or {}).get("rel")
        print(f"   [{i}] {c['created_at']}  public={c['public']}  "
              f"author={u.get('name')} ({u.get('role')})  via={via} rel={rel}")
        print(f"       {plain(c.get('plain_body') or c.get('body'))}")

    # Assignee-change history — Ivan wants the hub to show who a ticket is assigned to.
    print("\n  assignee changes recorded in audits:")
    for a in audits:
        for ev in a.get("events", []):
            if ev.get("type") in ("Change", "Create") and ev.get("field_name") == "assignee_id":
                print(f"   {a['created_at']}  {ev.get('previous_value')} -> {ev.get('value')}")

    # The autoresponder question: what does the FIRST public comment look like across
    # many tickets? If it is consistently a trigger, this is where it shows up.
    print(f"\n== first public comment pattern across {DEEP_DIVE_COUNT} unsolved tickets ==")
    threads = {}
    for t in open_tickets[:DEEP_DIVE_COUNT]:
        tid = t["id"]
        cs = zd.paginate(f"/api/v2/tickets/{tid}/comments.json", "comments")
        threads[tid] = cs
        for c in cs[:3]:
            uid = c["author_id"]
            if uid not in users:
                try:
                    users[uid] = zd.get(f"/api/v2/users/{uid}.json")["user"]
                except SystemExit:
                    users[uid] = {"name": "?", "role": "?"}
        print(f"\n  #{tid} {plain(t['subject'], 70)}")
        for i, c in enumerate(cs[:3]):
            u = users.get(c["author_id"], {})
            rel = ((c.get("via") or {}).get("source") or {}).get("rel")
            print(f"    [{i}] public={c['public']} author={u.get('name')} "
                  f"({u.get('role')}) rel={rel}")
            print(f"        {plain(c.get('plain_body') or c.get('body'), 140)}")
    save("threads_sample", threads)
    save("users_seen", users)

    print(f"\nRaw JSON written to {OUT.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
