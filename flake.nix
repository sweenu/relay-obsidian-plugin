{
  description = "Relay - Real-time collaborative workspace for Obsidian";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs =
    { nixpkgs, ... }:
    let
      forAllSystems = nixpkgs.lib.genAttrs nixpkgs.lib.systems.flakeExposed;
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          relay-obsidian-plugin = pkgs.buildNpmPackage rec {
            pname = "relay-obsidian-plugin";
            version = "0.8.5";

            src = pkgs.lib.fileset.toSource {
              root = ./.;
              fileset =
                pkgs.lib.fileset.intersection (pkgs.lib.fileset.fromSource (pkgs.lib.sources.cleanSource ./.))
                  (
                    pkgs.lib.fileset.unions [
                      ./package.json
                      ./package-lock.json
                      ./esbuild.config.mjs
                      ./tsconfig.json
                      ./src
                      ./manifest.json
                      ./styles.css
                    ]
                  );
            };

            npmDepsHash = "sha256-6aUroPu5yPTs7zKSSalF1ZpKRrHeF5aYuHaTWveupTU=";
            makeCacheWritable = true;

            # esbuild.config.mjs reads RELEASE_TAG before falling back to
            # `git describe`, which is unavailable in the nix sandbox.
            env.RELEASE_TAG = version;

            npmBuildScript = "release";
            dontNpmInstall = true;

            installPhase = ''
              runHook preInstall
              mkdir -p $out/share/obsidian/plugins/relay
              cp main.js manifest.json styles.css $out/share/obsidian/plugins/relay/
              runHook postInstall
            '';

            meta = {
              description = "Real-time collaborative workspace for Obsidian";
              homepage = "https://github.com/sweenu/relay-obsidian-plugin";
              license = pkgs.lib.licenses.mit;
              platforms = pkgs.lib.platforms.all;
            };
          };
        in
        {
          inherit relay-obsidian-plugin;
          default = relay-obsidian-plugin;
        }
      );
    };
}
