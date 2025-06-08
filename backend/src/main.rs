use axum::{routing::get, Router};
use std::sync::Arc;
use tokio::sync::Mutex;
// use std::net::SocketAddr;
use tokio::net::TcpListener;
use tokio::sync::broadcast;

mod game;
mod ws;

#[tokio::main]
async fn main() {
    // Broadcast channel for server-to-client messages: (room, ServerMsg)
    let (tx, _) = broadcast::channel::<(String, game::ServerMsg)>(100);

    // Shared map of room_id -> GameState
    // let rooms: game::Rooms = std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new()));
    let rooms: game::Rooms = Arc::new(Mutex::new(std::collections::HashMap::new()));

    // Build our application with a route
    let app = Router::new()
        .route("/ws", get(ws::ws_handler))
        // Pass both the broadcast sender and rooms map into handlers
        .with_state((tx.clone(), rooms.clone()));

    // Bind to a TCP listener
    let listener = TcpListener::bind("0.0.0.0:3000")
        .await
        .expect("Failed to bind to address");

    println!("🚀 Serwer działa pod adresem http://0.0.0.0:3000");

    // Uruchamianie serwera Axum z dostarczonym gniazdem i routerem
    axum::serve(listener, app)
        .await
        .expect("Błąd podczas uruchamiania serwera");

    // // Serve using axum
    // axum::Server::from_tcp(listener)
    //     .unwrap()
    //     .serve(app.into_make_service())
    //     .await
    //     .expect("Server error");
}



