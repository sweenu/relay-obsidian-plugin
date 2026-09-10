import { LoginHarness } from "./support/loginManager";
import { flushMicrotasks } from "./support/time";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const DAY = 24 * 60 * MINUTE;

/**
 * The auth token is the whole session — there is no refresh token — so a
 * refresh that fails silently leaves the stored token counting down to its
 * original expiry with nothing scheduled for another 24 hours.
 */
describe("LoginManager token refresh retries", () => {
	let harness: LoginHarness;

	afterEach(() => {
		harness?.teardown();
	});

	it("refreshes once on startup and schedules nothing else when it succeeds", async () => {
		harness = await LoginHarness.create();

		expect(harness.refreshCount()).toBe(1);
		// Only the 24h interval remains; no retry is pending.
		expect(harness.time.pending()).toHaveLength(1);
		expect(harness.time.nextDelayMs()).toBe(DAY);
	});

	it("retries at 30s, 2m, 10m and 30m after a transient failure", async () => {
		harness = await LoginHarness.create({
			configure: (h) => {
				h.authRefresh = () => ({ status: 503, body: { message: "down" } });
			},
		});

		expect(harness.refreshCount()).toBe(1);

		for (const delay of [30 * SECOND, 2 * MINUTE, 10 * MINUTE, 30 * MINUTE]) {
			expect(harness.time.nextDelayMs()).toBe(delay);
			await harness.time.advance(delay);
		}

		// Startup attempt plus four retries.
		expect(harness.refreshCount()).toBe(5);
	});

	it("gives up after the last retry and waits for the daily cycle", async () => {
		harness = await LoginHarness.create({
			configure: (h) => {
				h.authRefresh = () => ({ status: 503, body: { message: "down" } });
			},
		});

		await harness.time.advance(30 * SECOND);
		await harness.time.advance(2 * MINUTE);
		await harness.time.advance(10 * MINUTE);
		await harness.time.advance(30 * MINUTE);

		const before = harness.refreshCount();
		expect(harness.time.pending()).toHaveLength(1); // the daily interval only

		await harness.time.advance(2 * 60 * MINUTE);
		expect(harness.refreshCount()).toBe(before);
	});

	it("stops retrying as soon as one succeeds", async () => {
		let failures = 2;
		harness = await LoginHarness.create({
			configure: (h) => {
				h.authRefresh = () => {
					if (failures-- > 0) return { status: 503, body: { message: "down" } };
					return { status: 200, body: { token: h.freshToken(), record: {} } };
				};
			},
		});

		await harness.time.advance(30 * SECOND);
		await harness.time.advance(2 * MINUTE);

		expect(harness.refreshCount()).toBe(3);
		expect(harness.time.pending()).toHaveLength(1); // daily interval only

		await harness.time.advance(60 * MINUTE);
		expect(harness.refreshCount()).toBe(3);
	});

	it("starts the backoff over on the next daily cycle", async () => {
		let failing = true;
		harness = await LoginHarness.create({
			configure: (h) => {
				h.authRefresh = () =>
					failing
						? { status: 503, body: { message: "down" } }
						: { status: 200, body: { token: h.freshToken(), record: {} } };
			},
		});

		// Exhaust the startup backoff.
		await harness.time.advance(30 * SECOND);
		await harness.time.advance(2 * MINUTE);
		await harness.time.advance(10 * MINUTE);
		await harness.time.advance(30 * MINUTE);
		const afterFirstCycle = harness.refreshCount();

		// Advance exactly to the daily interval; its refresh fails too, and the
		// backoff starts over from 30s rather than staying exhausted.
		const untilDailyTick = harness.time.nextDelayMs();
		expect(untilDailyTick).toBeDefined();
		await harness.time.advance(untilDailyTick as number);
		expect(harness.refreshCount()).toBe(afterFirstCycle + 1);
		expect(harness.time.nextDelayMs()).toBe(30 * SECOND);

		failing = false;
		await harness.time.advance(30 * SECOND);
		expect(harness.refreshCount()).toBe(afterFirstCycle + 2);
	});

	describe("failures that are not worth retrying", () => {
		it("does not retry a 401", async () => {
			harness = await LoginHarness.create({
				configure: (h) => {
					h.authRefresh = () => ({ status: 401, body: { message: "nope" } });
				},
			});

			expect(harness.refreshCount()).toBe(1);
			expect(harness.time.pending()).toHaveLength(1); // daily interval only
		});

		it("does not retry a 403", async () => {
			harness = await LoginHarness.create({
				configure: (h) => {
					h.authRefresh = () => ({ status: 403, body: { message: "nope" } });
				},
			});

			expect(harness.refreshCount()).toBe(1);
			expect(harness.time.pending()).toHaveLength(1);
		});

		it("does not retry an aborted refresh", async () => {
			// An abort means a newer refresh superseded this one, so retrying
			// would only duplicate work.
			harness = await LoginHarness.create({
				configure: (h) => {
					h.authRefresh = () => {
						throw new DOMException("aborted", "AbortError");
					};
				},
			});

			expect(harness.refreshCount()).toBe(1);
			expect(harness.time.pending()).toHaveLength(1); // daily interval only
		});
	});

	describe("teardown", () => {
		// A retry that outlives the manager is a leaked timer. Asserting on
		// request counts cannot see it — after logout the auth store is empty,
		// so a fired retry is a silent no-op — so assert the timer is gone.
		const pendingRetries = (h: LoginHarness) =>
			h.time.pending().filter((timer) => timer.delayMs < DAY);

		it("cancels a pending retry on logout", async () => {
			harness = await LoginHarness.create({
				configure: (h) => {
					h.authRefresh = () => ({ status: 503, body: { message: "down" } });
				},
			});
			expect(pendingRetries(harness)).toHaveLength(1);

			harness.loginManager.logout();
			await flushMicrotasks();

			expect(pendingRetries(harness)).toHaveLength(0);
		});

		it("cancels a pending retry on destroy", async () => {
			harness = await LoginHarness.create({
				configure: (h) => {
					h.authRefresh = () => ({ status: 503, body: { message: "down" } });
				},
			});
			expect(pendingRetries(harness)).toHaveLength(1);

			harness.loginManager.destroy();
			await flushMicrotasks();

			expect(pendingRetries(harness)).toHaveLength(0);
			// `destroy` nulls out `pb`, so a surviving retry would throw here
			// rather than merely doing nothing.
			await expect(harness.time.advance(60 * MINUTE)).resolves.toBeUndefined();
		});
	});
});
