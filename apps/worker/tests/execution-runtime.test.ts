import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeExecutionTarget,
  SANDBOX_EXECUTION_TARGET,
  supportsExecutionTargetOnSurface,
  supportedExecutionTargetsForSurface,
} from "@nosis/agent-runtime/execution";

const UNSUPPORTED_TARGET_ERROR_RE = /Unsupported cloud execution target/;

test("canonicalizeExecutionTarget maps cloud inputs to sandbox", () => {
  assert.equal(
    canonicalizeExecutionTarget(undefined),
    SANDBOX_EXECUTION_TARGET
  );
  assert.equal(canonicalizeExecutionTarget(null), SANDBOX_EXECUTION_TARGET);
  assert.equal(canonicalizeExecutionTarget(""), SANDBOX_EXECUTION_TARGET);
  assert.equal(
    canonicalizeExecutionTarget("sandbox"),
    SANDBOX_EXECUTION_TARGET
  );
});

test("canonicalizeExecutionTarget rejects unsupported targets", () => {
  assert.throws(
    () => canonicalizeExecutionTarget("default"),
    UNSUPPORTED_TARGET_ERROR_RE
  );
  assert.throws(
    () => canonicalizeExecutionTarget("local"),
    UNSUPPORTED_TARGET_ERROR_RE
  );
  assert.throws(
    () => canonicalizeExecutionTarget("host"),
    UNSUPPORTED_TARGET_ERROR_RE
  );
});

test("supportsExecutionTargetOnSurface enforces surface capabilities", () => {
  assert.equal(supportsExecutionTargetOnSurface("sandbox", "worker"), true);
  assert.equal(supportsExecutionTargetOnSurface("sandbox", "web"), true);
  assert.equal(supportsExecutionTargetOnSurface("sandbox", "desktop"), true);
  assert.equal(supportsExecutionTargetOnSurface("local", "desktop"), true);
  assert.equal(supportsExecutionTargetOnSurface("local", "worker"), false);
  assert.equal(supportsExecutionTargetOnSurface("local", "web"), false);
});

test("supportedExecutionTargetsForSurface returns expected target lists", () => {
  assert.deepEqual(supportedExecutionTargetsForSurface("worker"), ["sandbox"]);
  assert.deepEqual(supportedExecutionTargetsForSurface("web"), ["sandbox"]);
  assert.deepEqual(supportedExecutionTargetsForSurface("desktop"), [
    "sandbox",
    "local",
  ]);
});
