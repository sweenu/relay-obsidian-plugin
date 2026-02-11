{ pkgs, ... }:

{
  packages = with pkgs; [
    nodePackages.npm
  ];

  languages.javascript = {
    enable = true;
    npm.install.enable = true;
  };

  languages.python = {
    enable = true;
    libraries = with pkgs.python3Packages; [
      click
      gitpython
      pygithub
    ];
  };
}
