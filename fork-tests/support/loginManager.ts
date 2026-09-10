import { EndpointManager, type EndpointSettings } from "src/EndpointManager";
import { LoginManager, type LoginSettings } from "src/LoginManager";
import { makeNamespacedSettings } from "./settings";
import { ManualTimeProvider, flushMicrotasks } from "./time";
import {
	jsonResponse,
	setRequestHandler,
	resetRequestHandler,
	type RequestUrlParam,
	type RequestUrlResponse,
} from "./obsidian";

export const AUTH_URL = "https://auth.test.example";
export const API_URL = "https://api.test.example";
const USER_ID = "user123";

function base64url(value: string): string {
	return Buffer.from(value)
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

/**
 * A structurally valid JWT. PocketBase's `isValid` only base64-decodes the
 * payload to read `exp`, so the signature never has to verify.
 */
export function makeToken(expiresInSeconds: number, id = USER_ID): string {
	const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
	const payload = base64url(
		JSON.stringify({
			id,
			email: "someone@example.com",
			exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
		}),
	);
	return `${header}.${payload}.${base64url("signature")}`;
}

export interface Reply {
	status: number;
	body?: unknown;
}

type Responder = () => Reply | Promise<Reply>;

const OK: Reply = { status: 200, body: {} };

/**
 * Drives a real `LoginManager` — real PocketBase client, real auth store, real
 * `customFetch` — against scripted server replies.
 */
export class LoginHarness {
	readonly time = new ManualTimeProvider();
	readonly requests: RequestUrlParam[] = [];

	/** Reply for `POST /api/collections/users/auth-refresh`. */
	authRefresh: Responder = () => ({
		status: 200,
		body: { token: makeToken(60 * 60 * 24 * 30), record: { id: USER_ID } },
	});

	/** Reply for `GET /api/collections/users/records/:id`. */
	userLookup: Responder = () => ({ status: 200, body: { id: USER_ID } });

	private constructor(readonly loginManager: LoginManager) {}

	static async create(
		options: { token?: string; configure?: (harness: LoginHarness) => void } = {},
	): Promise<LoginHarness> {
		const vaultName = "test-vault";
		const token = options.token ?? makeToken(60 * 60 * 24 * 30);
		(globalThis as { window: { localStorage: Storage } }).window.localStorage.setItem(
			`pocketbase_auth_${vaultName}`,
			JSON.stringify({ token, model: { id: USER_ID, email: "someone@example.com" } }),
		);

		const endpointSettings = await makeNamespacedSettings<EndpointSettings>(
			"endpoints",
			{ endpoints: { apiUrl: API_URL, authUrl: AUTH_URL } },
		);
		const loginSettings = await makeNamespacedSettings<LoginSettings>("login");

		// The harness has to exist before the LoginManager does: the constructor
		// fires the first token refresh, which the tests need to script.
		const harness = new LoginHarness(undefined as unknown as LoginManager);
		options.configure?.(harness);
		setRequestHandler((request) => harness.handle(request));

		const loginManager = new LoginManager(
			vaultName,
			async () => {},
			harness.time,
			() => {},
			loginSettings,
			new EndpointManager(endpointSettings),
		);
		(harness as { loginManager: LoginManager }).loginManager = loginManager;
		await flushMicrotasks();
		return harness;
	}

	private async handle(request: RequestUrlParam): Promise<RequestUrlResponse> {
		this.requests.push(request);
		const { url } = request;

		if (url.includes("/api/collections/users/auth-refresh")) {
			const reply = await this.authRefresh();
			return jsonResponse(reply.status, reply.body ?? {});
		}
		if (url.includes(`/api/collections/users/records/${USER_ID}`)) {
			const reply = await this.userLookup();
			return jsonResponse(reply.status, reply.body ?? {});
		}
		if (url.includes("/flags")) {
			return jsonResponse(200, []);
		}
		return jsonResponse(OK.status, OK.body);
	}

	/** A token the client will accept as valid, for scripted success replies. */
	freshToken(): string {
		return makeToken(60 * 60 * 24 * 30);
	}

	/** How many auth-refresh calls the server has seen. */
	refreshCount(): number {
		return this.requests.filter((request) =>
			request.url.includes("/api/collections/users/auth-refresh"),
		).length;
	}

	/** Whether the stored session survived. */
	isSignedIn(): boolean {
		return this.loginManager.pb.authStore.isValid;
	}

	teardown(): void {
		resetRequestHandler();
		this.time.destroy();
		(globalThis as { window: { localStorage: Storage } }).window.localStorage.clear();
	}
}
