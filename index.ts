import { ModelRuntime, type ExtensionAPI, type ProviderConfig } from "@earendil-works/pi-coding-agent";

const BASE_URL = "https://api.river.ai/v1";
const GLM = "zai-org/GLM-5.3-Flash";
const DEEPSEEK = "deepseek-ai/DeepSeek-V4.1-Flash";
const DEEPSEEK_1017 = "deepseek-ai/DeepSeek-V4.1-Flash-1017";
const NEMOTRON = "nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-NVFP4";
const QWEN = "Qwen/Qwen3.8-27B-FP8";
const KIMI = "moonshotai/Kimi-K3";

const COMPAT = {
	supportsStore: false,
	supportsDeveloperRole: false,
	supportsReasoningEffort: false,
	supportsLongCacheRetention: false,
	maxTokensField: "max_tokens" as const,
	thinkingFormat: "openai" as const,
	supportsStrictMode: false,
	supportsOpenAIGrammarTools: false,
	zaiToolStream: false,
	requiresToolResultName: false,
	requiresAssistantAfterToolResult: false,
	requiresReasoningContentOnAssistantMessages: false,
};

// Metadata, not catalog membership: only /models decides which IDs exist.
// https://docs.river.ai/guides/inference-models/
const METADATA: Record<string, { contextWindow: number; maxTokens: number }> = {
	[DEEPSEEK]: { contextWindow: 1_048_576, maxTokens: 384_000 },
	[DEEPSEEK_1017]: { contextWindow: 1_048_576, maxTokens: 384_000 },
	// River prints 128K; use 128,000 without assuming binary units.
	[GLM]: { contextWindow: 1_048_576, maxTokens: 128_000 },
	[NEMOTRON]: { contextWindow: 1_048_576, maxTokens: 128_000 },
	[QWEN]: { contextWindow: 262_144, maxTokens: 262_143 },
	[KIMI]: { contextWindow: 1_048_576, maxTokens: 32_768 },
};
// https://console.river.ai/api/public/pricing (inference, not training_and_sampling)
const PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
	[DEEPSEEK]: { input: 0.12, output: 0.48, cacheRead: 0.0024, cacheWrite: 0 },
	[DEEPSEEK_1017]: { input: 0.12, output: 0.48, cacheRead: 0.0024, cacheWrite: 0 },
	[GLM]: { input: 0.12, output: 0.40, cacheRead: 0.024, cacheWrite: 0 },
	[NEMOTRON]: { input: 0.07, output: 0.37, cacheRead: 0.024, cacheWrite: 0 },
	[QWEN]: { input: 0.10, output: 2.00, cacheRead: 0.02, cacheWrite: 0 },
	[KIMI]: { input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite: 0 },
};

export function riverModelIds(body: unknown): string[] {
	const data = body && typeof body === "object" && "data" in body ? body.data : undefined;
	if (!Array.isArray(data)) throw new Error("River model list returned an invalid catalog");
	const ids = data.map((item) => {
		if (!item || typeof item !== "object" || typeof item.id !== "string" || item.id.trim().length === 0) {
			throw new Error("River model list contains an invalid model ID");
		}
		return item.id as string;
	});
	return [...new Set(ids)];
}

// https://docs.river.ai/guides/inference-controls/
// Kimi: https://platform.kimi.ai/docs/guide/kimi-k3-quickstart
export function riverThinking(id: string): { effort: boolean; map?: Record<string, string | null> } {
	if (id === GLM || id === KIMI) {
		return { effort: true, map: { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" } };
	}
	if (id === DEEPSEEK || id === DEEPSEEK_1017) {
		return { effort: true, map: { off: "none", minimal: null, low: null, medium: null, high: "high", xhigh: null, max: "max" } };
	}
	if (id === NEMOTRON || id === QWEN) {
		// Pi has no "automatic" label: keep one enabled slot, never a fake Off control.
		return { effort: false, map: { off: null, minimal: null, low: null, medium: null, high: "auto", xhigh: null, max: null } };
	}
	return { effort: false };
}

function modelConfig(id: string) {
	const metadata = Object.hasOwn(METADATA, id) ? METADATA[id] : undefined;
	const pricing = Object.hasOwn(PRICING, id) ? PRICING[id] : undefined;
	const thinking = riverThinking(id);
	let name = id;
	if (!metadata) name += pricing ? " (unverified capabilities and limits)" : " (unverified metadata; estimated pricing)";
	if (thinking.map && !thinking.effort) name += " (automatic reasoning)";
	return {
		id,
		name,
		api: "openai-completions" as const,
		reasoning: Boolean(thinking.map),
		input: (metadata ? ["text", "image"] : ["text"]) as ("text" | "image")[],
		// Pi requires numeric rates: unknown IDs use explicitly labeled placeholders, not a claim of free inference.
		cost: pricing ?? { input: 0.12, output: 0.48, cacheRead: 0.024, cacheWrite: 0 },
		contextWindow: metadata?.contextWindow ?? 16_384,
		maxTokens: metadata?.maxTokens ?? 4_096,
		thinkingLevelMap: thinking.map,
		compat: { ...COMPAT, supportsReasoningEffort: thinking.effort },
	};
}

type RiverModel = ReturnType<typeof modelConfig>;

function storedConfigs(stored: { models?: readonly { id?: string; type?: string }[] } | undefined) {
	return (stored?.models ?? []).flatMap((model) => {
		if (!model.id || (model.type && model.type !== "chat")) return [];
		return [modelConfig(model.id)];
	});
}

function credentialKey(credential: { type?: string; key?: string; access?: string } | undefined): string | undefined {
	if (credential?.type === "api_key" && credential.key) return credential.key;
	if (credential?.type === "oauth" && credential.access) return credential.access;
	return process.env.RIVER_API_KEY;
}

async function listIds(key: string, signal: AbortSignal): Promise<string[]> {
	const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(5_000)]);
	let response: Response;
	try {
		response = await fetch(`${BASE_URL}/models`, {
			headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: requestSignal,
		});
	} catch {
		throw new Error("River model list request failed (network, timeout, or cancellation)");
	}
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(`River model list failed: HTTP ${response.status}`);
	}
	let body: unknown;
	try { body = await response.json(); }
	catch { throw new Error("River model list returned invalid JSON"); }
	requestSignal.throwIfAborted();
	return riverModelIds(body);
}

function snapshot(models: RiverModel[]) {
	return { models: models.map((model) => ({ ...model, type: "chat" as const, provider: "river", baseUrl: BASE_URL })), checkedAt: Date.now() };
}

async function bootstrapKey(config: ProviderConfig): Promise<string | undefined> {
	try {
		// Use Pi's own stored-key/env/command resolver, not raw auth.json configuration values.
		const authRuntime = await ModelRuntime.create({ refreshOnCreate: false });
		authRuntime.registerProvider("river", { ...config, refreshModels: undefined });
		return (await authRuntime.getAuth("river"))?.auth.apiKey;
	} catch {
		throw new Error("River catalog authentication could not be resolved; check /login river");
	}
}

export default async function (pi: ExtensionAPI) {
	let bootstrap: RiverModel[] | undefined;
	const config: ProviderConfig = {
		name: "River",
		baseUrl: BASE_URL,
		api: "openai-completions",
		apiKey: "$RIVER_API_KEY",
		authHeader: true,
		models: bootstrap,
		oauth: {
			name: "River",
			login: async (callbacks) => {
				const key = (await callbacks.onPrompt({ message: "River API key", placeholder: "rv_..." })).trim();
				if (!key) throw new Error("River API key is required");
				return { access: key, refresh: key, expires: Number.MAX_SAFE_INTEGER };
			},
			refreshToken: async (credentials) => ({ ...credentials, expires: Number.MAX_SAFE_INTEGER }),
			getApiKey: (credentials) => credentials.access,
		},
		refreshModels: async (context) => {
			const previous = storedConfigs(context.stored);
			if (context.signal.aborted) return previous;
			if (bootstrap !== undefined) {
				const initial = bootstrap;
				if (!(await context.publish({ persist: snapshot(initial) }))) return previous;
				bootstrap = undefined;
				return initial;
			}
			if (!context.allowNetwork) return previous;
			const key = credentialKey(context.credential);
			if (!key) return previous;
			const models = (await listIds(key, context.signal)).map(modelConfig);
			if (context.signal.aborted) return previous;
			if (!(await context.publish({ persist: snapshot(models) }))) return previous;
			return models;
		},
	};
	// Pi 1.1 initializes extension refresh hooks offline. Await a real catalog for cold CLI/model selection.
	if (!/^(1|true|yes)$/i.test(process.env.PI_OFFLINE ?? "")) {
		try {
			const key = await bootstrapKey(config);
			if (key) bootstrap = (await listIds(key, new AbortController().signal)).map(modelConfig);
		} catch (error) {
			console.warn(error instanceof Error ? error.message : "River catalog initialization failed");
		}
	}
	config.models = bootstrap;
	pi.registerProvider("river", config);
}
