import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type { AgentSessionConfig } from "@getpaseo/protocol/agent-types";
import { applyRolePrompt } from "./prompts.ts";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "agent-system-prompt-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "prompts"));
  const bindingsPath = join(root, "bindings.json");
  await writeFile(
    bindingsPath,
    JSON.stringify({
      "backend-worker": "prompts/backend.md",
      "design-critic": "prompts/critic.md",
    }),
  );
  await writeFile(join(root, "prompts/backend.md"), "# Backend\nImplement the task.\n");
  await writeFile(join(root, "prompts/critic.md"), "# Critic\nReview the design.\n");
  return { root, bindingsPath };
}

function agent(provider: string): AgentSessionConfig {
  return { provider, cwd: "/unrelated/workspace", model: "shared-test-model" };
}

test("each alias receives only its own prompt, even with identical model settings", async (t) => {
  const { bindingsPath } = await fixture(t);
  const [worker, critic] = await Promise.all([
    applyRolePrompt(agent("backend-worker"), bindingsPath),
    applyRolePrompt(agent("design-critic"), bindingsPath),
  ]);
  assert.equal(worker?.config.systemPrompt, "# Backend\nImplement the task.");
  assert.equal(critic?.config.systemPrompt, "# Critic\nReview the design.");
  assert.equal(worker.config.model, critic.config.model);
  assert.equal(worker.config.provider, "backend-worker");
  assert.equal(critic.config.provider, "design-critic");
});

test("base providers and unbound aliases remain untouched", async (t) => {
  const { root, bindingsPath } = await fixture(t);
  await rm(join(root, "prompts/backend.md"));
  for (const provider of ["codex", "claude", "openai-orchestrator", "claude-orchestrator", "constructor"]) {
    const config = { ...agent(provider), systemPrompt: "Existing instructions." };
    assert.equal(await applyRolePrompt(config, bindingsPath), undefined);
    assert.equal(config.systemPrompt, "Existing instructions.");
  }
});

test("appending preserves existing instructions and every other configuration field", async (t) => {
  const { bindingsPath } = await fixture(t);
  const config: AgentSessionConfig = Object.freeze({
    ...agent("backend-worker"),
    systemPrompt: "  Existing agent instructions.\n",
    modeId: "full-access",
    thinkingOptionId: "high",
    featureValues: { fast_mode: true },
    title: "Implement feature",
    providerOptions: { approval_policy: "never" },
    mcpServers: { docs: { type: "http", url: "https://example.test/mcp" } },
    toolPolicy: { preapproved: [{ kind: "mcp", server: "docs", tool: "search" }] },
  } satisfies AgentSessionConfig);
  const before = structuredClone(config);
  const result = await applyRolePrompt(config, bindingsPath);
  assert.ok(result);
  const { systemPrompt, ...other } = result.config;
  const { systemPrompt: original, ...expectedOther } = before;
  assert.equal(systemPrompt, original + "\n\n# Backend\nImplement the task.");
  assert.deepEqual(other, expectedOther);
  assert.deepEqual(config, before);
  assert.notEqual(result.config, config);
});

test("new creations read prompt and binding edits without changing earlier snapshots", async (t) => {
  const { root, bindingsPath } = await fixture(t);
  const config = agent("backend-worker");
  const first = await applyRolePrompt(config, bindingsPath);
  await writeFile(join(root, "prompts/backend.md"), "Updated worker instructions.");
  const second = await applyRolePrompt(config, bindingsPath);
  assert.equal(first?.config.systemPrompt, "# Backend\nImplement the task.");
  assert.equal(second?.config.systemPrompt, "Updated worker instructions.");

  await writeFile(bindingsPath, JSON.stringify({ "backend-worker": "prompts/critic.md" }));
  const third = await applyRolePrompt(config, bindingsPath);
  assert.equal(third?.config.systemPrompt, "# Critic\nReview the design.");

  await writeFile(bindingsPath, "{}");
  assert.equal(await applyRolePrompt(config, bindingsPath), undefined);
});

test("an absolute prompt path works independently of the agent working directory", async (t) => {
  const { root, bindingsPath } = await fixture(t);
  const promptPath = join(root, "prompts/backend.md");
  await writeFile(bindingsPath, JSON.stringify({ "backend-worker": promptPath }));
  const result = await applyRolePrompt(agent("backend-worker"), bindingsPath);
  assert.equal(result?.promptPath, promptPath);
  assert.equal(result?.config.systemPrompt, "# Backend\nImplement the task.");
});

test("missing, unreadable, and empty role files reject the affected creation", async (t) => {
  const { root, bindingsPath } = await fixture(t);
  const promptPath = join(root, "prompts/backend.md");
  await rm(promptPath);
  await assert.rejects(
    applyRolePrompt(agent("backend-worker"), bindingsPath),
    /Cannot read prompt for "backend-worker".*backend\.md/,
  );
  await mkdir(promptPath);
  await assert.rejects(
    applyRolePrompt(agent("backend-worker"), bindingsPath),
    /Cannot read prompt for "backend-worker"/,
  );
  await rm(promptPath, { recursive: true });
  await writeFile(promptPath, " \n\t ");
  await assert.rejects(
    applyRolePrompt(agent("backend-worker"), bindingsPath),
    /Prompt for "backend-worker" is empty/,
  );
  assert.equal(
    (await applyRolePrompt(agent("design-critic"), bindingsPath))?.config.systemPrompt,
    "# Critic\nReview the design.",
  );
});

test("invalid bindings fail with configuration errors", async (t) => {
  const { bindingsPath } = await fixture(t);
  for (const [source, error] of [
    ["{", /Invalid JSON/],
    ["null", /must map provider aliases/],
    ["[]", /must map provider aliases/],
    ['{"backend-worker":42}', /needs a non-empty prompt file path/],
    ['{"backend-worker":" "}', /needs a non-empty prompt file path/],
    ['{"Backend Worker":"prompts/backend.md"}', /Invalid provider alias/],
  ] as const) {
    await writeFile(bindingsPath, source);
    await assert.rejects(applyRolePrompt(agent("backend-worker"), bindingsPath), error);
  }
});

test("missing bindings name the configuration file in the error", async (t) => {
  const { bindingsPath } = await fixture(t);
  await rm(bindingsPath);
  await assert.rejects(
    applyRolePrompt(agent("backend-worker"), bindingsPath),
    /Cannot read bindings.*bindings\.json/,
  );
});

test("canceled hooks abort file reads", async (t) => {
  const { bindingsPath } = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    applyRolePrompt(agent("backend-worker"), bindingsPath, controller.signal),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.cause instanceof Error);
      assert.equal(error.cause.name, "AbortError");
      return true;
    },
  );
});
