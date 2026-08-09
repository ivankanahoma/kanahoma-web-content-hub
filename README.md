# Kanahoma Web Content Hub

Internal work queue for Kanahoma's web content management service. Ranks every open
Zendesk request across clients by what actually breaches first, and reads each thread with
Claude to surface impact, complexity, deadlines and the ETAs we promised.

First client: **Concordia University Irvine** (`cuiwebteam.zendesk.com`, Web Team group).

## What it does

- Mirrors the unsolved Web Team queue every 10 minutes.
- Reads each thread and records critical impact, complexity × effort, tone, the deadline
  the requester asked for, and the ETA we promised back.
- Ranks the queue by time-to-breach across all three kinds of commitment.
- Tells stalled tickets apart: chase it, close it, or escalate it.
- Filters spam by requester domain before it costs a token.
- Generates copy-paste reply drafts on demand.

## Run it

```bash
npm install
cp .env.example .env    # fill in the Zendesk values for the local probe scripts
npm run dev
```

See [CLAUDE.md](./CLAUDE.md) for architecture, the queue model, the schema, and the
Zendesk behaviour the ingest depends on.
