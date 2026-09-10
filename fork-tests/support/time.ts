import type { TimeProvider } from "src/TimeProvider";

interface Scheduled {
	id: number;
	dueAt: number;
	callback: () => void;
	intervalMs?: number;
}

/**
 * A TimeProvider whose clock only moves when the test moves it.
 *
 * The retry backoff is the thing under test, so the tests need to assert on
 * *when* a retry fires, not merely that one eventually does.
 */
export class ManualTimeProvider implements TimeProvider {
	private current = 0;
	private nextId = 1;
	private scheduled = new Map<number, Scheduled>();

	now(): number {
		return this.current;
	}

	setTimeout(callback: () => void, ms: number): number {
		const id = this.nextId++;
		this.scheduled.set(id, { id, dueAt: this.current + ms, callback });
		return id;
	}

	clearTimeout(timerId: number): void {
		this.scheduled.delete(timerId);
	}

	setInterval(callback: () => unknown, ms: number): number {
		const id = this.nextId++;
		this.scheduled.set(id, {
			id,
			dueAt: this.current + ms,
			callback: () => callback(),
			intervalMs: ms,
		});
		return id;
	}

	clearInterval(timerId: number): void {
		this.scheduled.delete(timerId);
	}

	debounce<Args extends unknown[]>(
		func: (...args: Args) => void,
		delay: number,
	): (...args: Args) => void {
		let timer: number | undefined;
		return (...args: Args) => {
			if (timer !== undefined) this.clearTimeout(timer);
			timer = this.setTimeout(() => func(...args), delay);
		};
	}

	destroy(): void {
		this.scheduled.clear();
	}

	/** Timers currently waiting to fire, soonest first. */
	pending(): Array<{ id: number; delayMs: number }> {
		return [...this.scheduled.values()]
			.sort((a, b) => a.dueAt - b.dueAt)
			.map((entry) => ({ id: entry.id, delayMs: entry.dueAt - this.current }));
	}

	/** Delay of the soonest pending timer, or undefined if none is scheduled. */
	nextDelayMs(): number | undefined {
		return this.pending()[0]?.delayMs;
	}

	/**
	 * Advance the clock, firing everything that comes due and draining the
	 * microtask queue after each callback so promise chains settle.
	 */
	async advance(ms: number): Promise<void> {
		const target = this.current + ms;
		for (;;) {
			const due = [...this.scheduled.values()]
				.filter((entry) => entry.dueAt <= target)
				.sort((a, b) => a.dueAt - b.dueAt);
			const next = due[0];
			if (!next) break;

			this.current = next.dueAt;
			if (next.intervalMs !== undefined) {
				next.dueAt = this.current + next.intervalMs;
			} else {
				this.scheduled.delete(next.id);
			}
			next.callback();
			await flushMicrotasks();
		}
		this.current = target;
	}
}

/** Let already-queued promise callbacks run. */
export async function flushMicrotasks(): Promise<void> {
	for (let i = 0; i < 10; i++) {
		await Promise.resolve();
	}
	await new Promise((resolve) => setImmediate(resolve));
}
