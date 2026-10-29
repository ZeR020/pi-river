import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test, { type TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";
import registerRiver, { riverModelIds, riverThinking } from "./index.ts";

const piDist = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
const aiDist = join(piDist, "../node_modules/@earendil-works/pi-ai/dist");
const { ModelRuntime } = await import(pathToFileURL(join(piDist, "core/model-runtime.js")).href);
const { getSupportedThinkingLevels, calculateCost } = await import(pathToFileURL(join(aiDist, "models.js")).href);
const { streamSimple } = await import(pathToFileURL(join(aiDist, "api/openai-completions.js")).href);
const GLM = "zai-org/GLM-5.3-Flash";
const DS = "deepseek-ai/DeepSeek-V4.1-Flash";
const DS1017 = "deepseek-ai/DeepSeek-V4.1-Flash-1017";
const NV = "nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-NVFP4";
const QWEN = "Qwen/Qwen3.8-27B-FP8";
const KIMI = "moonshotai/Kimi-K3";
const GLM3 = "GLM-5.3";
const UNKNOWN = "future/new-chat-model";
const catalog = (ids: string[]) => ({ object: "list", data: ids.map((id) => ({ id, object: "model", owned_by: "river" })) });

function env(t: TestContext, name: string, value: string) {
	const old = process.env[name];
	process.env[name] = value;
	t.after(() => { if (old === undefined) delete process.env[name]; else process.env[name] = old; });
}

async function configuration(): Promise<ProviderConfig> {
	let config: ProviderConfig | undefined;
	await registerRiver({ registerProvider: (id: string, value: ProviderConfig) => {
		assert.equal(id, "river");
		config = value;
	} } as ExtensionAPI);
	assert.ok(config);
	return config;
}

async function runtime() {
	const dir = mkdtempSync(join(tmpdir(), "river-runtime-"));
	const options = { authPath: join(dir, "auth.json"), modelsPath: join(dir, "models.json"), modelsStorePath: join(dir, "store.json"), refreshOnCreate: false };
	const config = await configuration();
	const models = await ModelRuntime.create(options);
	models.registerProvider("river", config);
	await models.refresh({ providers: ["river"], allowNetwork: false });
	return { models, options, config };
}

function reply(chunks: unknown[]) {
	return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
		headers: { "Content-Type": "text/event-stream" },
	});
}
const chunk = (delta: unknown, finish_reason: string | null = null) => ({ id: "mock-response", choices: [{ index: 0, delta, finish_reason }] });
const context = { messages: [{ role: "system", content: "test", timestamp: 0 }, { role: "user", content: "Hello", timestamp: 0 }] };

async function wire(model: unknown, reasoning: string, samplingParams?: unknown) {
	let payload: any;
	const result = await streamSimple(model, context, { apiKey: "fake-test-key", reasoning, samplingParams, maxRetries: 0,
		fetch: async (_url: unknown, init: any) => { payload = JSON.parse(init.body); return reply([chunk({ content: "ok" }, "stop")]); },
	}).result();
	assert.equal(result.stopReason, "stop", result.errorMessage);
	return payload;
}

test("catalog validates its envelope and entries before returning IDs", () => {
	assert.deepEqual(riverModelIds(catalog([GLM, DS, GLM, UNKNOWN])), [GLM, DS, UNKNOWN]);
	assert.deepEqual(riverModelIds(catalog([])), []);
	for (const body of [{}, null, { data: {} }, { data: [{ id: GLM }, {}] }, { data: [{ id: "" }] }, { data: [{ id: "   " }] }]) {
		assert.throws(() => riverModelIds(body), /catalog|model list/i);
	}
});

test("effort mappings apply only to documented exact IDs", () => {
	assert.equal(riverThinking(GLM).map?.max, "max");
	assert.equal(riverThinking(DS).map?.max, "max");
	assert.equal(riverThinking("future/glm-unverified").effort, false);
	assert.equal(riverThinking(GLM3).map?.max, "max");
	assert.equal(riverThinking("future/deepseek-unverified").effort, false);
	assert.equal(riverThinking("Qwen/Qwen3.8-unverified").effort, false);
	assert.equal(riverThinking("moonshotai/Kimi-unverified").effort, false);
});

test("live membership uses documented prices and per-model output budgets", async (t) => {
	t.mock.method(globalThis, "fetch", async () => Response.json(catalog([DS, DS1017, GLM, NV, QWEN, GLM3, KIMI, UNKNOWN])));
	const { models } = await runtime();
	const refreshed = await models.refresh({ providers: ["river"], allowNetwork: true });
	assert.equal(refreshed.errors.size, 0);
	assert.equal(models.getModels("river").length, 8);
	for (const [id, contextLimit, outputLimit, input, output, cacheRead] of [
		[DS, 1048576, 384000, 0.12, 0.48, 0.0024], [GLM, 1048576, 128000, 0.12, 0.40, 0.024], [NV, 1048576, 128000, 0.07, 0.37, 0.024],
		[DS1017, 1048576, 384000, 0.12, 0.48, 0.0024],
		[QWEN, 262144, 262143, 0.10, 2.00, 0.02], [KIMI, 1048576, 32768, 3.00, 15.00, 0.30],
		[GLM3, 1048576, 128000, 1.12, 3.52, 0.208],
	] as const) {
		const model = models.getModel("river", id)!;
		assert.equal(model.maxTokens, outputLimit);
		const budget = (await wire(model, "max")).max_tokens;
		// Pi reserves context headroom when the output ceiling nearly fills the window.
		if (id === QWEN) assert.ok(budget > 250000 && budget <= outputLimit);
		else assert.equal(budget, outputLimit);
		assert.deepEqual(model.cost, { input, output, cacheRead, cacheWrite: 0 });
		const usage = { input: 1000000, output: 1000000, cacheRead: 1000000, cacheWrite: 0, cost: {} };
		assert.ok(Math.abs(calculateCost(model, usage).total - (input + output + cacheRead)) < 1e-10);
		assert.equal(model.contextWindow, contextLimit);
	}
	assert.deepEqual(models.getModel("river", QWEN)!.input, ["text", "image"]);
	assert.deepEqual(models.getModel("river", GLM3)!.input, ["text"]);
	const kimi = models.getModel("river", KIMI)!;
	assert.doesNotMatch(kimi.name, /unverified/i);
	assert.doesNotMatch(kimi.name, /estimated pricing/i);
	assert.deepEqual(kimi.input, ["text", "image"]);
	assert.equal(kimi.reasoning, true);
	const unknown = models.getModel("river", UNKNOWN)!;
	assert.match(unknown.name, /unverified|estimated/i);
	assert.ok(unknown.cost.input > 0 && unknown.cost.output > 0);
	assert.deepEqual(unknown.input, ["text"]);
	assert.deepEqual(getSupportedThinkingLevels(unknown), ["off"]);
});

test("actual Pi reasoning choices and requests match documented controls", async (t) => {
	t.mock.method(globalThis, "fetch", async () => Response.json(catalog([GLM, DS, DS1017, NV, QWEN, GLM3, KIMI])));
	const { models } = await runtime();
	await models.refresh({ providers: ["river"], allowNetwork: true });
	for (const [id, levels, efforts] of [
		[GLM, ["low", "high", "max"], ["low", "high", "max"]],
		[GLM3, ["low", "high", "max"], ["low", "high", "max"]],
		[DS, ["off", "low", "high", "max"], ["none", "low", "high", "max"]],
		[DS1017, ["off", "low", "high", "max"], ["none", "low", "high", "max"]],
		[NV, ["off", "high"], ["none", "high"]],
		[QWEN, ["off", "low", "medium", "xhigh"], ["none", "low", "medium", "xhigh"]],
		[KIMI, ["off", "max"], ["none", "max"]],
	] as const) {
		const model = models.getModel("river", id)!;
		assert.deepEqual(getSupportedThinkingLevels(model), levels);
		for (let i = 0; i < levels.length; i++) assert.equal((await wire(model, levels[i])).reasoning_effort, efforts[i]);
	}
	assert.equal(models.getModel("river", KIMI)!.name, KIMI);
});

test("refresh failures remain visible without losing the last good live or saved catalog", async (t) => {
	let response = () => Response.json(catalog([GLM]));
	t.mock.method(globalThis, "fetch", async () => response());
	const { models, options, config } = await runtime();
	await models.refresh({ providers: ["river"], allowNetwork: true });
	for (const bad of [() => Response.json({ error: "bad envelope" }), () => new Response("bad JSON"), () => new Response("secret body must not be logged", { status: 402 }), () => new Response("unauthorized", { status: 401 })]) {
		response = bad;
		const result = await models.refresh({ providers: ["river"], allowNetwork: true });
		assert.ok(result.errors.has("river"));
		assert.equal(models.getModels("river")[0]?.id, GLM);
		assert.doesNotMatch(String(result.errors.get("river")), /secret body|fake-test-key/);
		const restored = await ModelRuntime.create(options);
		restored.registerProvider("river", config);
		await restored.refresh({ providers: ["river"], allowNetwork: false });
		assert.equal(restored.getModels("river")[0]?.id, GLM);
	}
	response = () => Response.json(catalog([]));
	const empty = await models.refresh({ providers: ["river"], allowNetwork: true });
	assert.equal(empty.errors.size, 0);
	assert.equal(models.getModels("river").length, 0);
});

test("offline restoration upgrades the previous zero-price snapshot", async () => {
	const config = await configuration();
	const restored = await config.refreshModels!({ allowNetwork: false, signal: new AbortController().signal, publish: async () => true,
		stored: { checkedAt: 0, models: [{ type: "chat", id: DS, name: DS, provider: "river", baseUrl: "https://api.river.ai/v1", api: "openai-completions", input: ["text", "image"], reasoning: false, contextWindow: 1048576, maxTokens: 131072, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] },
	});
	const model = restored[0];
	assert.ok("maxTokens" in model);
	assert.equal(model.maxTokens, 384000);
	assert.equal(model.cost.output, 0.48);
	assert.equal(model.reasoning, true);
});

test("offline restoration upgrades -1017 from unverified fallback metadata", async () => {
	const config = await configuration();
	const restored = await config.refreshModels!({ allowNetwork: false, signal: new AbortController().signal, publish: async () => true,
		stored: { checkedAt: 0, models: [{ type: "chat", id: DS1017, name: DS1017 + " (unverified metadata; estimated pricing)", provider: "river", baseUrl: "https://api.river.ai/v1", api: "openai-completions", input: ["text"], reasoning: false, contextWindow: 16384, maxTokens: 4096, cost: { input: 0.12, output: 0.48, cacheRead: 0.024, cacheWrite: 0 } }] },
	});
	const model = restored[0];
	assert.ok("maxTokens" in model);
	assert.equal(model.contextWindow, 1048576);
	assert.equal(model.maxTokens, 384000);
	assert.equal(model.name, DS1017);
	assert.deepEqual(model.input, ["text", "image"]);
	assert.equal(model.cost.cacheRead, 0.0024);
	assert.deepEqual(getSupportedThinkingLevels(model), ["off", "low", "high", "max"]);
});

test("offline restoration upgrades new models to their documented capabilities and limits", async () => {
	const config = await configuration();
	const restored = await config.refreshModels!({ allowNetwork: false, signal: new AbortController().signal, publish: async () => true,
		stored: { checkedAt: 0, models: [QWEN, KIMI, GLM3].map((id) => ({ type: "chat" as const, id, name: id, provider: "river", baseUrl: "https://api.river.ai/v1", api: "openai-completions" as const, input: ["text" as const], reasoning: false, contextWindow: 16384, maxTokens: 4096, cost: { input: 0.12, output: 0.48, cacheRead: 0.024, cacheWrite: 0 } })) },
	});
	const [qwen, kimi, glm3] = restored;
	assert.ok("maxTokens" in qwen && "maxTokens" in kimi && "maxTokens" in glm3);
	assert.equal(qwen.contextWindow, 262144);
	assert.equal(qwen.maxTokens, 262143);
	assert.deepEqual(qwen.input, ["text", "image"]);
	assert.deepEqual(getSupportedThinkingLevels(qwen), ["off", "low", "medium", "xhigh"]);
	assert.equal(qwen.cost.output, 2.00);
	assert.equal(kimi.contextWindow, 1048576);
	assert.equal(kimi.maxTokens, 32768);
	assert.deepEqual(kimi.input, ["text", "image"]);
	assert.deepEqual(getSupportedThinkingLevels(kimi), ["off", "max"]);
	assert.equal(kimi.cost.output, 15.00);
	assert.doesNotMatch(kimi.name, /unverified/i);
	assert.equal(kimi.name, KIMI);
	assert.equal(glm3.contextWindow, 1048576);
	assert.equal(glm3.maxTokens, 128000);
	assert.deepEqual(glm3.input, ["text"]);
	assert.deepEqual(getSupportedThinkingLevels(glm3), ["low", "high", "max"]);
	assert.equal(glm3.cost.cacheRead, 0.208);
	assert.equal(glm3.cost.output, 3.52);
	assert.equal(glm3.name, GLM3);
});

test("persistence errors are not converted to successful refreshes", async (t) => {
	t.mock.method(globalThis, "fetch", async () => Response.json(catalog([GLM])));
	const config = await configuration();
	await assert.rejects(config.refreshModels!({ allowNetwork: true, credential: { type: "api_key", key: "fake-test-key" }, signal: new AbortController().signal,
		publish: async () => { throw new Error("disk full"); },
	}), /disk full/);
});

test("cancelled refreshes do not publish a new catalog", async (t) => {
	let publishes = 0;
	const controller = new AbortController();
	t.mock.method(globalThis, "fetch", async () => { controller.abort(); return Response.json(catalog([DS])); });
	const config = await configuration();
	await config.refreshModels!({ allowNetwork: true, credential: { type: "api_key", key: "fake-test-key" }, signal: controller.signal,
		publish: async () => { publishes++; return true; },
	}).catch(() => {});
	assert.equal(publishes, 0);
});

test("cold factory seeds real catalog membership and persists it during offline initialization", async (t) => {
	env(t, "PI_OFFLINE", "0");
	let calls = 0;
	t.mock.method(globalThis, "fetch", async (url: unknown) => { calls++; assert.equal(String(url), "https://api.river.ai/v1/models"); return Response.json(catalog([UNKNOWN, GLM])); });
	const { models, options, config } = await runtime();
	assert.equal(calls, 1);
	assert.deepEqual(models.getModels("river").map((m: any) => m.id), [UNKNOWN, GLM]);
	const restored = await ModelRuntime.create(options);
	restored.registerProvider("river", config);
	await restored.refresh({ providers: ["river"], allowNetwork: false });
	assert.equal(restored.getModels("river").length, 2);
});

test("cold startup honors stored credentials before the environment key", async (t) => {
	env(t, "PI_OFFLINE", "0");
	const dir = mkdtempSync(join(tmpdir(), "river-auth-"));
	env(t, "PI_CODING_AGENT_DIR", dir);
	writeFileSync(join(dir, "auth.json"), JSON.stringify({ river: { type: "oauth", access: "stored-fake-key", refresh: "stored-fake-key", expires: Date.now() + 10000 } }));
	let auth: string | undefined;
	t.mock.method(globalThis, "fetch", async (_url: unknown, init: any) => { auth = init.headers.Authorization; return Response.json(catalog([GLM])); });
	await configuration();
	assert.equal(auth, "Bearer stored-fake-key");
});

test("cold discovery resolves stored environment and command key references through Pi", async (t) => {
	env(t, "PI_OFFLINE", "0");
	let auth: string | undefined;
	t.mock.method(globalThis, "fetch", async (_url: unknown, init: any) => { auth = init.headers.Authorization; return Response.json(catalog([GLM])); });
	for (const [credential, expected] of [
		[{ type: "api_key", key: "$RIVER_API_KEY" }, "Bearer fake-test-key"],
		[{ type: "api_key", key: "!printf command-fake-key" }, "Bearer command-fake-key"],
		[{ type: "api_key", key: "$LOCAL_RIVER_KEY", env: { LOCAL_RIVER_KEY: "scoped-fake-key" } }, "Bearer scoped-fake-key"],
	] as const) {
		const dir = mkdtempSync(join(tmpdir(), "river-key-reference-"));
		env(t, "PI_CODING_AGENT_DIR", dir);
		writeFileSync(join(dir, "auth.json"), JSON.stringify({ river: credential }));
		await configuration();
		assert.equal(auth, expected);
	}
});

test("offline startup does not fetch and startup failures still register a usable provider", async (t) => {
	let calls = 0;
	t.mock.method(globalThis, "fetch", async () => { calls++; return new Response("hidden body", { status: 401 }); });
	await configuration();
	assert.equal(calls, 0);
	env(t, "PI_OFFLINE", "0");
	const warnings: string[] = [];
	t.mock.method(console, "warn", (...args: unknown[]) => warnings.push(args.join(" ")));
	const config = await configuration();
	assert.ok(config.refreshModels);
	assert.equal(calls, 1);
	assert.ok(warnings.some((warning) => /401/.test(warning)));
	assert.ok(warnings.every((warning) => !/hidden body|fake-test-key/.test(warning)));
});
test("rejected publications do not install or consume a bootstrap catalog", async (t) => {
	env(t, "PI_OFFLINE", "0");
	t.mock.method(globalThis, "fetch", async () => Response.json(catalog([GLM])));
	const config = await configuration();
	const base = { allowNetwork: false, signal: new AbortController().signal };
	assert.deepEqual(await config.refreshModels!({ ...base, publish: async () => false }), []);
	const published: unknown[] = [];
	const accepted = await config.refreshModels!({ ...base, publish: async (value) => { published.push(value); return true; } });
	assert.equal(accepted[0]?.id, GLM);
	assert.equal(published.length, 1);
	assert.deepEqual(await config.refreshModels!({ ...base, allowNetwork: true, credential: { type: "api_key", key: "fake-test-key" }, publish: async () => false }), []);
});


for (const id of [GLM, KIMI]) test(`native ${id} requests preserve images, tools, JSON schema, and reasoning replay`, async (t) => {
	t.mock.method(globalThis, "fetch", async () => Response.json(catalog([id])));
	const { models } = await runtime();
	await models.refresh({ providers: ["river"], allowNetwork: true });
	const model = models.getModel("river", id)!;
	const schema = { type: "json_schema", json_schema: { name: "result", strict: true, schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } } };
	assert.deepEqual((await wire(model, "max", { response_format: schema, top_p: 0.9, stop: ["END"] })).response_format, schema);
	const tool = { name: "lookup", description: "test", parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } };
	const history: any = { messages: [{ role: "system", content: "test", toolsAdded: [tool], timestamp: 0 }, { role: "user", content: [{ type: "text", text: "Hello" }, { type: "image", data: "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg==", mimeType: "image/png" }], timestamp: 0 }] };
	let payload: any;
	const options = { apiKey: "fake-test-key", reasoning: "max", maxRetries: 0, fetch: async (_url: unknown, init: any) => {
		payload = JSON.parse(init.body);
		return reply([chunk({ reasoning_content: "Plan 🔍" }), chunk({ tool_calls: [{ index: 0, id: "call1", type: "function", function: { name: "lookup", arguments: '{"q":"' } }] }),
			chunk({ tool_calls: [{ index: 0, function: { arguments: 'café"}' } }] }, "tool_calls"), { choices: [], usage: { prompt_tokens: 100, completion_tokens: 25, prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 10 } } }]);
	} };
	const result = await streamSimple(model, history, options).result();
	assert.equal(result.stopReason, "toolUse", result.errorMessage);
	assert.deepEqual(result.content[1].arguments, { q: "café" });
	assert.equal(result.usage.totalTokens, 125);
	assert.equal(result.usage.reasoning, 10);
	assert.ok(result.usage.cost.total > 0);
	assert.equal(payload.stream, true);
	assert.ok(payload.messages.find((m: any) => m.role === "user").content.some((part: any) => part.type === "image_url" && part.image_url.url.startsWith("data:image/png;base64,")));
	assert.equal(payload.tools[0].function.name, "lookup");
	assert.equal(payload.tools[0].function.strict, undefined);
	assert.equal(payload.store, undefined);
	assert.equal(payload.messages[0].role, "system");
	history.messages.push(result, { role: "toolResult", toolCallId: "call1", toolName: "lookup", content: [{ type: "text", text: "found" }], isError: false, timestamp: 0 });
	await streamSimple(model, history, { ...options, fetch: async (_url: unknown, init: any) => { payload = JSON.parse(init.body); return reply([chunk({ content: "ok" }, "stop")]); } }).result();
	assert.equal(payload.messages.find((m: any) => m.role === "assistant").reasoning_content, "Plan 🔍");
	assert.equal(payload.messages.find((m: any) => m.role === "tool").tool_call_id, "call1");
});

test("Pi extension loader accepts the provider factory", async () => {
	const { loadExtensions } = await import(pathToFileURL(join(piDist, "core/extensions/loader.js")).href);
	const { createEventBus } = await import(pathToFileURL(join(piDist, "core/event-bus.js")).href);
	const loaded = await loadExtensions([join(process.cwd(), "index.ts")], process.cwd(), createEventBus());
	assert.deepEqual(loaded.errors, []);
	assert.equal(loaded.runtime.pendingProviderRegistrations[0]?.name, "river");
});

for (const entry of ["cli.js", "bundle/cli.js"]) {
	test(`cold Pi ${entry} lists discovered River models without a pre-existing cache`, () => {
		const dir = mkdtempSync(join(tmpdir(), "river-cli-"));
		// Pi configures undici during CLI setup. Keep the deliberately mocked HTTP boundary across that setup.
		const script = `const mockFetch = async (url) => { if (String(url) !== 'https://api.river.ai/v1/models') throw new Error('unexpected network'); return Response.json(${JSON.stringify(catalog([GLM, DS, DS1017, QWEN, GLM3, KIMI]))}); }; Object.defineProperty(globalThis, 'fetch', {configurable: true, get: () => mockFetch, set: () => {}}); process.argv = ['node', 'pi', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-mcp', '-e', '/workspace/index.ts', '--list-models', 'river']; await import(${JSON.stringify(pathToFileURL(join(piDist, entry)).href)});`;
		const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 20000, env: { ...process.env, PI_OFFLINE: "0", PI_CODING_AGENT_DIR: dir } });
		assert.equal(child.status, 0, child.stderr);
		assert.match(child.stdout, /zai-org\/GLM-5\.3-Flash/, child.stderr);
		assert.match(child.stdout, /deepseek-ai\/DeepSeek-V4\.1-Flash/);
		assert.match(child.stdout, /deepseek-ai\/DeepSeek-V4\.1-Flash-1017/);
		assert.match(child.stdout, /Qwen\/Qwen3\.8-27B-FP8/);
		assert.match(child.stdout, /moonshotai\/Kimi-K3/);
		assert.doesNotMatch(child.stderr, /fake-test-key|failed|error/i);
		assert.ok(child.stdout.split("\n").some((line) => line.includes("GLM-5.3") && !line.includes("GLM-5.3-Flash")), child.stdout);
	});
}
