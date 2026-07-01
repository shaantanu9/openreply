import assert from "node:assert";
import { initialState, applyEvent } from "../src/or/fetchStatus.js";

let s = { ...initialState(), running: true };
s = applyEvent(s, { event: "phase", name: "collect" });
assert.equal(s.phase, "collect");

s = applyEvent(s, { event: "source", name: "hn", status: "done", count: 125 });
assert.equal(s.sources.hn.status, "done");
assert.equal(s.sources.hn.count, 125);
assert.equal(s.sourcesDone, 1);
assert.equal(s.totalPosts, 125);

s = applyEvent(s, { event: "source", name: "youtube", status: "error" });
assert.equal(s.sources.youtube.status, "error");
assert.equal(s.sourcesDone, 1); // errors don't count as done-with-data
assert.equal(s.totalPosts, 125);

s = applyEvent(s, { event: "result", posts_fetched: 703 });
assert.equal(s.totalPosts, 703); // result total wins

console.log("fetch-status OK");
