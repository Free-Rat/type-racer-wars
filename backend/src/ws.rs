use axum::{
    extract::{ws::{WebSocket, Message, WebSocketUpgrade}, State},
    response::IntoResponse,
};
use tokio::sync::broadcast::Sender;
use uuid::Uuid;
use crate::game::{GameState};

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(_tx): State<Sender<String>>,
) -> impl IntoResponse {
    ws.on_upgrade(handle_socket)
}

async fn handle_socket(mut socket: WebSocket) {
    let player_id = Uuid::new_v4();
    println!("🔗 Player connected: {player_id}");

    // TODO: dodaj logikę gry tutaj (wczytaj GameState, odbieraj Message, przetwarzaj)

    while let Some(Ok(msg)) = socket.recv().await {
        match msg {
            Message::Text(text) => {
                println!("📥 Text from {player_id}: {text}");
                // tutaj parsuj np. `TypedWord:<word>`
            }
            Message::Close(_) => {
                println!("❌ Player {player_id} disconnected");
                break;
            }
            _ => {}
        }
    }
}
