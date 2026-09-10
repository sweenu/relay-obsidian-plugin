import { LoginHarness } from "./support/loginManager";
import { flushMicrotasks } from "./support/time";

/**
 * The startup user lookup used to sign the user out on any 404. PocketBase
 * answers 404 for a deleted account, but so does a reverse proxy that isn't up
 * yet, a stale auth URL, or a captive portal — and signing out clears the
 * stored token, which is the entire session.
 */
describe("LoginManager account existence check", () => {
	let harness: LoginHarness;

	afterEach(() => {
		harness?.teardown();
	});

	const lookupMissing = () => ({ status: 404, body: { message: "not found" } });

	it("keeps the session when the lookup 404s but the token still refreshes", async () => {
		harness = await LoginHarness.create({
			configure: (h) => {
				h.userLookup = lookupMissing;
			},
		});
		await flushMicrotasks();

		expect(harness.isSignedIn()).toBe(true);
	});

	it("keeps the session when the account check itself fails transiently", async () => {
		harness = await LoginHarness.create({
			configure: (h) => {
				h.userLookup = lookupMissing;
				// The proxy is down: both the lookup and the corroborating
				// refresh fail, but neither says the token is bad.
				h.authRefresh = () => ({ status: 503, body: { message: "down" } });
			},
		});
		await flushMicrotasks();

		expect(harness.isSignedIn()).toBe(true);
	});

	it.each([401, 403, 404])(
		"signs out when the corroborating refresh is refused with %i",
		async (status) => {
			harness = await LoginHarness.create({
				configure: (h) => {
					h.userLookup = lookupMissing;
					h.authRefresh = () => ({ status, body: { message: "gone" } });
				},
			});
			await flushMicrotasks();

			expect(harness.isSignedIn()).toBe(false);
		},
	);

	it("does not run the account check when the lookup succeeds", async () => {
		harness = await LoginHarness.create();
		await flushMicrotasks();

		// One refresh only: the startup one. No corroborating check was needed.
		expect(harness.refreshCount()).toBe(1);
		expect(harness.isSignedIn()).toBe(true);
	});

	it("runs alongside the startup refresh without disturbing it", async () => {
		// The account check issues a second auth-refresh while the startup one
		// may still be in flight. Both must run to completion.
		let releaseStartupRefresh: (() => void) | undefined;
		const startupRefreshHeld = new Promise<void>((resolve) => {
			releaseStartupRefresh = resolve;
		});

		let refreshCalls = 0;
		harness = await LoginHarness.create({
			configure: (h) => {
				h.userLookup = lookupMissing;
				h.authRefresh = async () => {
					refreshCalls += 1;
					if (refreshCalls === 1) await startupRefreshHeld;
					return { status: 200, body: { token: h.freshToken(), record: {} } };
				};
			},
		});

		await flushMicrotasks();
		releaseStartupRefresh?.();
		await flushMicrotasks();

		expect(refreshCalls).toBe(2);
		expect(harness.isSignedIn()).toBe(true);
	});
});
