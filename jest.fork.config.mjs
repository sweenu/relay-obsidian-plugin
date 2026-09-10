/** @type {import('ts-jest').JestConfigWithTsJest} */

// Tests for this fork's own patches.
//
// Upstream's suite lives under `__tests__/` and is git-crypt encrypted, so it
// cannot run here — including its shared mocks and setup files. This config is
// deliberately standalone: it only covers `fork-tests/`, which carries its own
// stubs and is outside the `__tests__/**` git-crypt pattern.

export default {
	rootDir: ".",
	roots: ["<rootDir>/fork-tests"],
	testEnvironment: "node",
	moduleNameMapper: {
		"^src/(.*)$": "<rootDir>/src/$1",
		// The published `obsidian` package is types-only; there is nothing to
		// import at runtime.
		"^obsidian$": "<rootDir>/fork-tests/support/obsidian.ts",
	},
	setupFiles: ["<rootDir>/fork-tests/support/browserGlobals.ts"],
	testPathIgnorePatterns: ["/fork-tests/support/"],
	// esbuild `define`s these at build time.
	globals: {
		BUILD_TYPE: "production",
		GIT_TAG: "fork-tests",
		API_URL: "https://api.system3.md",
		AUTH_URL: "https://auth.system3.md",
	},
	// pocketbase publishes only an ESM bundle under its default export
	// condition. Transpiling it keeps these tests on plain CommonJS, so `jest`
	// runs without --experimental-vm-modules.
	transformIgnorePatterns: ["node_modules[\\/](?!pocketbase[\\/])"],
	transform: {
		// No `isolatedModules` here: type errors in these tests should fail the
		// run. `npm run release` only typechecks `src/`.
		"\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/fork-tests/tsconfig.json" }],
		"node_modules[\\/]pocketbase[\\/].+\\.mjs$": [
			"ts-jest",
			{ isolatedModules: true },
		],
	},
};
