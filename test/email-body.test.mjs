// Trimming a comment down to what somebody wrote.
//
// The fixture is ticket 75234 verbatim: two sentences of question followed by a
// signature block and two quoted replies, 1,069 characters to say one thing.

import test from "node:test";
import assert from "node:assert/strict";

import { trimComment } from "../src/lib/emailBody.js";

const KELLI = `Hi team - question on these blogs - are you going to be able to publish all blogs that we've sent to your que all at once? Or will any be delayed? Please let us know - as we'd like to plan/schedule around that on upcoming/new blogs on our end.

Thanks!

Kelli Headley, MSL

Marketing Manager

Grand Canyon Education

2600 W. Camelback Rd. | Phoenix, AZ | 85017

623-703-9099 Cell

kelli.headley@gce.com |

gce.com

From: Kelli Headley (Orbis) <Kelli.Headley@gce.com>

Date: Tuesday, August 11, 2026 at 11:45 AM

To: Web Team Tickets <webteam@cui.edu>

Subject: Re: [CUI] Re: CUI ABSN Blog Links Broken

Hi Matt, I don't have them indexed on my end - but no worries, we understand on the timeline!

Thank you,

Kelli Headley, MSL

Marketing Manager

Grand Canyon Education

kelli.headley@gce.com`;

test("ticket 75234 comes down to the question", () => {
  const { text, trimmed } = trimComment(KELLI);
  assert.ok(trimmed);
  assert.ok(text.startsWith("Hi team - question on these blogs"));
  // "Thanks!" stays: it is part of what she wrote. The signature is the name, title,
  // company and contact block underneath it, and that is what goes.
  assert.ok(text.endsWith("Thanks!"), `ended with: ${JSON.stringify(text.slice(-40))}`);
  assert.ok(!text.includes("Kelli Headley, MSL"), "the name block survived");
  assert.ok(!text.includes("Marketing Manager"), "the job title survived");
  assert.ok(!text.includes("From:"), "the quoted chain survived");
  assert.ok(!text.includes("gce.com"), "the signature survived");
  assert.ok(!text.includes("Camelback"), "the address survived");
  // The whole point: 1,000-odd characters carrying two sentences.
  assert.ok(text.length < KELLI.length / 3,
            `${text.length} of ${KELLI.length} characters kept`);
});

test("a message with nothing to trim is returned untouched", () => {
  const plain = "Hi Kelly,\nYes! We're going to publish those at once, I'm reviewing them!";
  const { text, trimmed } = trimComment(plain);
  assert.equal(text, plain);
  assert.equal(trimmed, false);
});

test("the quoted chain goes, however it is marked", () => {
  for (const marker of [
    "-----Original Message-----",
    "On Tuesday, August 11, 2026 at 11:45 AM Kelli Headley wrote:",
    "> the older message",
  ]) {
    const { text } = trimComment(`The actual message.\n\n${marker}\nold text here`);
    assert.equal(text, "The actual message.", `${marker} was not cut`);
  }
});

test("the confidentiality footer goes", () => {
  const { text } = trimComment(
    "Please update the page.\n\nNOTICE: This email and any attachments are confidential.");
  assert.equal(text, "Please update the page.");
});

test("a sign-off with no signature under it is left alone", () => {
  const note = "Can you take a look?\n\nThanks!";
  assert.equal(trimComment(note).text, note);
});

test("thanks in the middle of a sentence is not a sign-off", () => {
  const note = "Thanks for the quick turnaround on the last one.\nOne more please.";
  assert.equal(trimComment(note).text, note);
});

test("a signature with no sign-off above it still goes", () => {
  const { text } = trimComment(
    "Please publish this.\nJane Doe\njane.doe@cui.edu\n949-555-0100");
  assert.equal(text, "Please publish this.\nJane Doe");
});

test("a phone number inside a sentence is not a contact line", () => {
  const note = "The page still lists 949-214-3018 but it should be 949-214-3020 now.";
  assert.equal(trimComment(note).text, note);
});

test("the rules never hand back an empty message", () => {
  // Nothing here but contact details: trimming would leave an empty box, so it does not.
  const { text, trimmed } = trimComment("kelli.headley@gce.com | gce.com");
  assert.equal(text, "kelli.headley@gce.com | gce.com");
  assert.equal(trimmed, false);
});

test("a sign-off keeps its own line but loses the block beneath it", () => {
  const { text } = trimComment("Thanks!\n\nKelli\nkelli.headley@gce.com");
  assert.equal(text, "Thanks!");
});
