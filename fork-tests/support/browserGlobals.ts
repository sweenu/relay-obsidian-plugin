/**
 * Minimal `window` shim.
 *
 * `LocalAuthStore` persists the PocketBase session to `window.localStorage`
 * and falls back to a private per-instance object when there is no window.
 * That fallback would make every `LoginManager` start signed out, so the tests
 * would never reach the token-refresh path they exist to cover.
 */

class MemoryStorage {
	private entries = new Map<string, string>();

	getItem(key: string): string | null {
		return this.entries.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		this.entries.set(key, String(value));
	}

	removeItem(key: string): void {
		this.entries.delete(key);
	}

	clear(): void {
		this.entries.clear();
	}
}

const globals = globalThis as Record<string, unknown>;

globals.window = {
	localStorage: new MemoryStorage(),
	addEventListener: () => {},
	removeEventListener: () => {},
};
