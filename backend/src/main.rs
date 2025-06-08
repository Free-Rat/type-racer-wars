use axum::{routing::get, Router};
// use std::net::SocketAddr;
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use ws::ws_handler;

mod game;
mod ws;

#[tokio::main]
async fn main() {
    // Tworzenie kanału broadcast do komunikacji między zadaniami
    let (tx, _) = broadcast::channel(100);

    // Definiowanie routera aplikacji z trasą WebSocket
    let app = Router::new()
        .route("/ws", get(ws_handler))
        .with_state(tx);

    // Tworzenie nasłuchującego gniazda TCP
    let listener = TcpListener::bind("0.0.0.0:3000")
        .await
        .expect("Nie można powiązać z adresem");

    println!("🚀 Serwer działa pod adresem http://0.0.0.0:3000");

    // Uruchamianie serwera Axum z dostarczonym gniazdem i routerem
    axum::serve(listener, app)
        .await
        .expect("Błąd podczas uruchamiania serwera");
}
