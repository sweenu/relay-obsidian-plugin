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
            version = "0.7.4";

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

            npmDepsHash = "sha256-SB3lIaR4fYBQLcYRjQHkG70QYpelR8xdqXVCNLL2fKo=";
            makeCacheWritable = true;

            postPatch = ''
              substituteInPlace esbuild.config.mjs \
                --replace-fail 'execSync("git describe --tags --always", {' "" \
                --replace-fail $'\tencoding: "utf8",' "" \
                --replace-fail '}).trim()' '"${version}"'
            '';

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
