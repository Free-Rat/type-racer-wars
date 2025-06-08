type-racer-wars/
├── flake.nix
├── flake.lock
├── README.md
├── backend/
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs
│       ├── game.rs         # logika gry, GameState, gracz, teksty itd.
│       └── ws.rs           # obsługa WebSocketów
├── frontend/
│   ├── index.html          # canvas, input, podstawowy UI
│   ├── style.css
│   └── main.js             # logika klienta: sockety, rysowanie, interakcje
├── static/                 # katalog serwowany przez Axum (frontend)
│   └── (symboliczny link do ../frontend lub build)
└── scripts/
    └── dev.sh              # pomocniczy serwer np. do hot reload
