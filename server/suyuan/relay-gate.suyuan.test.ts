// suyuan fork: the relay gate lets a one-way notice into a thread someone else opened only when a person is behind the turn,
// the source conversation is not outside work and may read the target, and the target does not wait on the person.
import { describe, expect, it } from "vitest";

import type { TaskRecord } from "../store.ts";
import { OWN_THREADS_ONLY, relayGate, type RelayGateDeps, WAITS_ON_PERSON } from "./relay-gate.ts";

const task = { threadId: "target" } as TaskRecord;
const gate = (over: Partial<RelayGateDeps> = {}) => relayGate({
  personBehind: () => true, outside: () => false, readableFrom: () => () => true, openPersonCard: () => undefined, ...over,
}, "chief", "source")(task);

describe("relayGate", () => {
  it("lets a notice in when a person is behind the turn, the source is clean and reads the target, and nothing waits on the person", () => {
    expect(gate()).toBe(true);
  });

  it("asks the source conversation and the target thread by their ids", () => {
    const seen: string[] = [];
    gate({ personBehind: (bot, thread) => { seen.push(`behind ${bot} ${thread}`); return true; }, outside: (thread) => { seen.push(`outside ${thread}`); return false; },
      readableFrom: (from) => (other) => { seen.push(`reads ${from} ${other}`); return true; }, openPersonCard: (thread) => { seen.push(`card ${thread}`); return undefined; } });
    expect(seen).toEqual(["behind chief source", "outside source", "reads source target", "card target"]);
  });

  it("says why when nobody is behind the turn (a webhook, a routine)", () => {
    expect(() => gate({ personBehind: () => false })).toThrow(OWN_THREADS_ONLY);
  });

  it("refuses when the source cannot read the target (fenced, bot API)", () => {
    expect(gate({ readableFrom: () => () => false })).toBe(false);
  });

  it("says why when the source conversation carries the outside mark", () => {
    expect(() => gate({ outside: () => true })).toThrow(OWN_THREADS_ONLY);
  });

  it("says why when the target waits on the person's answer", () => {
    expect(() => gate({ openPersonCard: () => ({ kind: "question" }) })).toThrow(WAITS_ON_PERSON);
  });
});
