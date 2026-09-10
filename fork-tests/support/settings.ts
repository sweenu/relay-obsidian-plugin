import {
	NamespacedSettings,
	Settings,
	type SettingsTree,
	type StorageAdapter,
} from "src/SettingsStorage";

class MemoryAdapter implements StorageAdapter<Record<string, unknown>> {
	private data: Record<string, unknown> | null = null;

	async loadData() {
		return this.data;
	}

	async saveData(data: Record<string, unknown>) {
		this.data = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
	}
}

/**
 * A loaded, in-memory settings tree. `Settings.update` silently no-ops until
 * `load()` has run, so the tests always go through it rather than constructing
 * `Settings` directly.
 */
export async function makeSettingsTree(
	initial: Record<string, unknown> = {},
): Promise<SettingsTree> {
	const settings = new Settings<Record<string, unknown>>(
		new MemoryAdapter(),
		initial,
	);
	await settings.load();
	return settings;
}

export async function makeNamespacedSettings<T extends object>(
	namespace: string,
	initial: Record<string, unknown> = {},
): Promise<NamespacedSettings<T>> {
	const tree = await makeSettingsTree(initial);
	return new NamespacedSettings<T>(tree, namespace);
}
