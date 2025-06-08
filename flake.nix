{
  description = "Multiplayer Type Racer with Axum backend and JS frontend";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-23.11";
    flake-utils.url = "github:numtide/flake-utils";
    # rust-overlay.url = "github:oxalica/rust-overlay";
  };

  outputs = {
    self,
    nixpkgs,
    flake-utils,
    # rust-overlay,
  }:
    flake-utils.lib.eachDefaultSystem (system: let
      # overlays = [rust-overlay.overlay];
      pkgs = import nixpkgs {
        inherit system;
        # overlays = overlays;
      };
      # rust = pkgs.rust-bin.stable.latest.default;
    in {
      devShells.default = pkgs.mkShell {
        buildInputs = with pkgs; [
          # rust
          nodejs
          # trunk # if you want to add WASM later
          cargo-watch
        ];

        shellHook = ''
          ln -s ./frontend ./static
          alias start="cargo run --manifest-path backend/Cargo.toml"
          echo "📦 DevShell ready: Rust + Node.js"
        '';
      };

      packages.backend = pkgs.rustPlatform.buildRustPackage {
        pname = "type-racer-backend";
        version = "0.1.0";
        src = ./.;
        cargoLock = null; # set if you have Cargo.lock
        doCheck = false;

        buildInputs = [pkgs.openssl];
      };
    });
}
