// The order the queue actually renders in.
//
// Tier is decided in Postgres; this is the part decided on the client, and it is the part
// that is easy to break silently. A wrong tie-break does not throw, it just quietly puts
// the wrong ticket at the top of somebody's morning.

import test from "node:test";
import assert from "node:assert/strict";

import { sortQueue } from "../src/lib/queue.js";

/** Only the fields the sort reads. */
const ticket = (id, over = {}) => ({
  id,
  pinned: false,
  tier: 0,
  is_vip: false,
  base_tier: 0,
  hours_to_due: null,
  age_days: 0,
  ...over,
});

const order = (rows) => sortQueue(rows).map((t) => t.id);

test("a VIP leads its tier", () => {
  assert.deepEqual(
    order([
      ticket("plain-critical"),
      ticket("vip-critical", { is_vip: true }),
      ticket("another-critical"),
    ]),
    ["vip-critical", "plain-critical", "another-critical"],
  );
});

test("a VIP does not jump a tier", () => {
  // Critical still outranks a VIP who is merely overdue: the tier is compared first.
  assert.deepEqual(
    order([
      ticket("vip-overdue", { tier: 1, base_tier: 1, is_vip: true }),
      ticket("plain-critical", { tier: 0, base_tier: 0 }),
    ]),
    ["plain-critical", "vip-overdue"],
  );
});

test("a pinned ticket still beats a VIP", () => {
  assert.deepEqual(
    order([
      ticket("vip", { is_vip: true }),
      ticket("pinned", { pinned: true }),
    ]),
    ["pinned", "vip"],
  );
});

test("a VIP leads the pre-launch bucket too", () => {
  assert.deepEqual(
    order([
      ticket("prelaunch-breached", { tier: 8, base_tier: 1 }),
      ticket("prelaunch-vip", { tier: 8, base_tier: 6, is_vip: true }),
    ]),
    ["prelaunch-vip", "prelaunch-breached"],
  );
});

test("below the VIP line, the original tier still orders the pre-launch pile", () => {
  assert.deepEqual(
    order([
      ticket("quiet", { tier: 8, base_tier: 6 }),
      ticket("breached", { tier: 8, base_tier: 1 }),
      ticket("critical", { tier: 8, base_tier: 0 }),
    ]),
    ["critical", "breached", "quiet"],
  );
});

test("two VIPs in a tier sort by what breaches first", () => {
  assert.deepEqual(
    order([
      ticket("later", { is_vip: true, hours_to_due: 40 }),
      ticket("sooner", { is_vip: true, hours_to_due: -6 }),
    ]),
    ["sooner", "later"],
  );
});

test("a missing due date sorts behind one that has it, then by age", () => {
  assert.deepEqual(
    order([
      ticket("no-date-new", { age_days: 2 }),
      ticket("no-date-old", { age_days: 90 }),
      ticket("dated", { hours_to_due: 100 }),
    ]),
    ["dated", "no-date-old", "no-date-new"],
  );
});

test("sorting does not mutate the array it was given", () => {
  const rows = [ticket("b"), ticket("a", { is_vip: true })];
  const before = rows.map((t) => t.id);
  sortQueue(rows);
  assert.deepEqual(rows.map((t) => t.id), before);
});
