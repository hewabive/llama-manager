import { strict as assert } from "node:assert";
import test from "node:test";

import {
  checkLoginRateLimit,
  recordLoginFailure,
  recordLoginSuccess,
  resetLoginRateLimit,
} from "../auth.js";

test.afterEach(() => {
  resetLoginRateLimit();
});

test("allows attempts below the failure threshold", () => {
  const now = 1_000_000;
  for (let i = 0; i < 4; i += 1) {
    const result = recordLoginFailure("10.0.0.1", now + i);
    assert.equal(result.allowed, true);
  }
  assert.equal(checkLoginRateLimit("10.0.0.1", now + 10).allowed, true);
});

test("locks out after the failure threshold", () => {
  const now = 1_000_000;
  let last = { allowed: true, retryAfterSeconds: 0 };
  for (let i = 0; i < 5; i += 1) {
    last = recordLoginFailure("10.0.0.2", now);
  }
  assert.equal(last.allowed, false);
  assert.ok(last.retryAfterSeconds > 0);
  assert.equal(checkLoginRateLimit("10.0.0.2", now).allowed, false);
});

test("lock expires after the window passes", () => {
  const now = 1_000_000;
  for (let i = 0; i < 5; i += 1) {
    recordLoginFailure("10.0.0.3", now);
  }
  const locked = checkLoginRateLimit("10.0.0.3", now);
  assert.equal(locked.allowed, false);
  const afterWindow = now + locked.retryAfterSeconds * 1000 + 1;
  assert.equal(checkLoginRateLimit("10.0.0.3", afterWindow).allowed, true);
});

test("escalates lock duration on repeated lockouts", () => {
  const now = 1_000_000;
  for (let i = 0; i < 5; i += 1) {
    recordLoginFailure("10.0.0.4", now);
  }
  const first = checkLoginRateLimit("10.0.0.4", now).retryAfterSeconds;
  const afterFirst = now + first * 1000 + 1;
  const second = recordLoginFailure("10.0.0.4", afterFirst);
  assert.ok(second.retryAfterSeconds > first);
});

test("success resets the counter", () => {
  const now = 1_000_000;
  for (let i = 0; i < 4; i += 1) {
    recordLoginFailure("10.0.0.5", now);
  }
  recordLoginSuccess("10.0.0.5");
  const result = recordLoginFailure("10.0.0.5", now);
  assert.equal(result.allowed, true);
});

test("tracks clients independently", () => {
  const now = 1_000_000;
  for (let i = 0; i < 5; i += 1) {
    recordLoginFailure("10.0.0.6", now);
  }
  assert.equal(checkLoginRateLimit("10.0.0.6", now).allowed, false);
  assert.equal(checkLoginRateLimit("10.0.0.7", now).allowed, true);
});

test("counter decays after inactivity", () => {
  const now = 1_000_000;
  for (let i = 0; i < 4; i += 1) {
    recordLoginFailure("10.0.0.8", now);
  }
  const muchLater = now + 16 * 60_000;
  const result = recordLoginFailure("10.0.0.8", muchLater);
  assert.equal(result.allowed, true);
});
