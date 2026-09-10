import { EndpointManager, type EndpointSettings } from "src/EndpointManager";
import { makeNamespacedSettings } from "./support/settings";

const DEFAULT_API = "https://api.system3.md";
const DEFAULT_AUTH = "https://auth.system3.md";

async function makeManager(initial: Record<string, unknown> = {}) {
	const settings = await makeNamespacedSettings<EndpointSettings>(
		"endpoints",
		initial,
	);
	return { manager: new EndpointManager(settings), settings };
}

describe("EndpointManager custom endpoints", () => {
	it("falls back to the compiled-in defaults when nothing is configured", async () => {
		const { manager } = await makeManager();

		expect(manager.getApiUrl()).toBe(DEFAULT_API);
		expect(manager.getAuthUrl()).toBe(DEFAULT_AUTH);
		expect(manager.hasCustomEndpoints()).toBe(false);
	});

	it("serves the configured endpoints once they are set", async () => {
		const { manager } = await makeManager();

		const result = await manager.setEndpoints(
			"https://relay.example.com",
			"https://auth.example.com",
		);

		expect(result).toEqual({ success: true });
		expect(manager.getApiUrl()).toBe("https://relay.example.com");
		expect(manager.getAuthUrl()).toBe("https://auth.example.com");
		expect(manager.hasCustomEndpoints()).toBe(true);
	});

	it("persists the endpoints into the settings namespace", async () => {
		const { manager, settings } = await makeManager();

		await manager.setEndpoints(
			"https://relay.example.com",
			"https://auth.example.com",
		);

		expect(settings.get()).toMatchObject({
			apiUrl: "https://relay.example.com",
			authUrl: "https://auth.example.com",
		});
	});

	it("reads endpoints that were already persisted", async () => {
		const { manager } = await makeManager({
			endpoints: {
				apiUrl: "https://stored.example.com",
				authUrl: "https://stored-auth.example.com",
			},
		});

		expect(manager.getApiUrl()).toBe("https://stored.example.com");
		expect(manager.getAuthUrl()).toBe("https://stored-auth.example.com");
		expect(manager.hasCustomEndpoints()).toBe(true);
	});

	it("keeps the rest of the endpoint settings intact", async () => {
		const { manager, settings } = await makeManager({
			endpoints: {
				activeTenantId: "tenant-1",
				tenants: [
					{
						id: "tenant-1",
						name: "Tenant One",
						tenantUrl: "https://tenant.example.com",
						isValidated: true,
					},
				],
			},
		});

		await manager.setEndpoints(
			"https://relay.example.com",
			"https://auth.example.com",
		);

		const stored = settings.get();
		expect(stored.activeTenantId).toBe("tenant-1");
		expect(stored.tenants).toHaveLength(1);
	});

	describe("validation", () => {
		it("rejects a non-HTTPS endpoint on a production build", async () => {
			const { manager, settings } = await makeManager();

			const result = await manager.setEndpoints("http://relay.example.com");

			expect(result.success).toBe(false);
			expect(result.error).toMatch(/HTTPS/);
			expect(settings.get().apiUrl).toBeUndefined();
			expect(manager.getApiUrl()).toBe(DEFAULT_API);
		});

		it("rejects a malformed URL", async () => {
			const { manager } = await makeManager();

			const result = await manager.setEndpoints("not-a-url");

			expect(result.success).toBe(false);
			expect(result.error).toMatch(/Invalid URL/);
			expect(manager.hasCustomEndpoints()).toBe(false);
		});

		it("rejects a bad auth URL without applying the good api URL", async () => {
			const { manager } = await makeManager();

			const result = await manager.setEndpoints(
				"https://relay.example.com",
				"http://auth.example.com",
			);

			expect(result.success).toBe(false);
			expect(manager.getApiUrl()).toBe(DEFAULT_API);
			expect(manager.getAuthUrl()).toBe(DEFAULT_AUTH);
		});
	});

	describe("clearCustomEndpoints", () => {
		it("restores the defaults", async () => {
			const { manager } = await makeManager({
				endpoints: {
					apiUrl: "https://stored.example.com",
					authUrl: "https://stored-auth.example.com",
				},
			});

			await manager.clearCustomEndpoints();

			expect(manager.hasCustomEndpoints()).toBe(false);
			expect(manager.getApiUrl()).toBe(DEFAULT_API);
			expect(manager.getAuthUrl()).toBe(DEFAULT_AUTH);
		});

		it("is what an empty setEndpoints call does not do", async () => {
			// setEndpoints(undefined, undefined) also clears, which is the path
			// the settings UI takes when the field is emptied.
			const { manager } = await makeManager({
				endpoints: { apiUrl: "https://stored.example.com" },
			});

			const result = await manager.setEndpoints(undefined, undefined);

			expect(result).toEqual({ success: true });
			expect(manager.hasCustomEndpoints()).toBe(false);
			expect(manager.getApiUrl()).toBe(DEFAULT_API);
		});
	});
});
