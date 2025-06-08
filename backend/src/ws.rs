use axum::{
    extract::{ws::{Message, WebSocket, WebSocketUpgrade}, State},
    response::IntoResponse,
};
use futures::{SinkExt, StreamExt};
// use std::sync::{Arc, Mutex};
// use tokio::{sync::broadcast::Sender, time::{sleep, Duration, Instant}};
// use serde_json;
use std::sync::Arc;
use tokio::{
    sync::{broadcast::Sender, Mutex},
    time::{sleep, Duration, Instant},
};

use crate::game::{ClientMsg, ServerMsg, GameState, Rooms};

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State((tx, rooms)): State<(Sender<(String, ServerMsg)>, Rooms)>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, tx, rooms))
}

async fn handle_socket(
    socket: WebSocket,
    tx: Sender<(String, ServerMsg)>,
    rooms: Rooms,
) {
    // Split WebSocket into sender and receiver, wrap sender for shared use
    let (tx_sink, mut rx_ws) = socket.split();
    let tx_ws = Arc::new(Mutex::new(tx_sink));
    let mut rx_bc = tx.subscribe();

    // Shared state for the room and player name
    let my_room = Arc::new(Mutex::new(String::new()));
    let my_name = Arc::new(Mutex::new(None::<String>));

    // Broadcast task: forward non-feedback messages to all in room
    {
        let tx_ws = Arc::clone(&tx_ws);
        let my_room = Arc::clone(&my_room);
        tokio::spawn(async move {
            while let Ok((room, msg)) = rx_bc.recv().await {
                if let ServerMsg::Feedback { .. } = msg {
                    continue;
                }
                if room == *my_room.lock().await {
                    if let Ok(text) = serde_json::to_string(&msg) {
                        let _ = tx_ws.lock().await.send(Message::Text(text.into())).await;
                    }
                }
            }
        });
    }

   // Main loop: handle incoming messages and closure
    while let Some(Ok(msg)) = rx_ws.next().await {
        match msg {
            Message::Text(txt) => match serde_json::from_str::<ClientMsg>(&txt) {
                Ok(ClientMsg::Join { room, name, reconnect }) => {
                    println!("joining room: {}, player name: {}, reconnect {}", room, name, reconnect);
                    let mut all = rooms.lock().await;
                    let game = all.entry(room.clone()).or_insert_with(|| GameState {
                        players: Default::default(),
                        positions: Default::default(),
                        finishes: Vec::new(),
                        text: "The quick brown fox".into(),
                        race_start: None,
                    });

                    // 1) Reconnect case
                    if reconnect && game.players.contains(&name) {
                        // register locks
                        *my_room.lock().await = room.clone();
                        *my_name.lock().await = Some(name.clone());

                        // 2) Always send lobby state
                        let players = game.players.iter().cloned().collect();
                        let _ = tx.send((room.clone(), ServerMsg::LobbyUpdate { players }));

                        // 3) If we've already started the countdown but not the race
                        if let Some(start) = game.race_start {
                            let elapsed = start.elapsed().as_secs();
                            let remaining = if elapsed < 3 { 3 - elapsed } else { 0 };
                            if remaining > 0 {
                                let _ = tx.send((room.clone(), ServerMsg::Countdown { seconds_left: remaining as u8 }));
                            }
                        }
                        // 4) If race is running or done
                        if game.race_start.is_some() {
                            // tell them the text
                            let _ = tx.send((room.clone(), ServerMsg::StartRace { text: game.text.clone() }));
                            println!("4) If race is running or done");
                            // replay their own progress as Feedback
                            if let Some(&pos) = game.positions.get(&name) {
                                for i in 0..pos {
                                    println!("{}",i);
                                    let expected = game.text.chars().nth(i).unwrap().to_string();
                                    let _ = tx.send((room.clone(), ServerMsg::Feedback {
                                        char: expected.clone(),
                                        correct: true,
                                        position: i,
                                    }));
                                }
                            }
                            // broadcast everyone's cursor so their UI sees them
                            for (other, &pos) in &game.positions {
                                let _ = tx.send((room.clone(), ServerMsg::ProgressUpdate {
                                    name: other.clone(),
                                    position: pos,
                                }));
                            }
                            // if finished, replay results
                            if game.finishes.len() == game.players.len() {
                                let results = game.finishes.clone();
                                let _ = tx.send((room.clone(), ServerMsg::RaceResult { results }));
                            }
                        }
                    }
                    // 5) Brand-new join
                    else if game.players.contains(&name) {
                        // Send conflict message directly to the requester
                        println!("Error: name {} already in room {}", name, room);
                        let conflict_msg = serde_json::to_string(&ServerMsg::NameConflict).unwrap();
                        let _ = tx_ws.lock().await.send(Message::Text(conflict_msg.into())).await;
                    } else {
                        game.players.insert(name.clone());
                        game.positions.insert(name.clone(), 0);
                        *my_room.lock().await = room.clone();
                        *my_name.lock().await = Some(name.clone());
                        let players = game.players.iter().cloned().collect();
                        let _ = tx.send((room.clone(), ServerMsg::LobbyUpdate { players }));

                        if game.players.len() >= 3 {
                            let tx2 = tx.clone();
                            let room2 = room.clone();
                            let rooms2 = rooms.clone();
                            tokio::spawn(async move {
                                for sec in (1..=3).rev() {
                                    let _ = tx2.send((room2.clone(), ServerMsg::Countdown { seconds_left: sec }));
                                    sleep(Duration::from_secs(1)).await;
                                }
                                let text = {
                                    let g = rooms2.lock().await;
                                    g.get(&room2).unwrap().text.clone()
                                };
                                rooms2.lock().await.get_mut(&room2).unwrap().race_start = Some(Instant::now());
                                let _ = tx2.send((room2.clone(), ServerMsg::StartRace { text }));
                            });
                        }
                    }
                }
                Ok(ClientMsg::Keystroke { char }) => {
                    if let Some(name) = my_name.lock().await.as_ref() {
                        let room = my_room.lock().await.clone();
                        let mut all = rooms.lock().await;
                        if let Some(game) = all.get_mut(&room) {
                            if let Some(current_pos) = game.positions.get(name).copied() {
                                println!("keystroke: room {}, player {}, key {}, position {}", room, name, char, current_pos);
                                if let Some(expected) = game.text.chars().nth(current_pos) {
                                    let correct = expected.to_string() == char;
                                    if correct {
                                        game.positions.insert(name.clone(), current_pos + 1);
                                    }
                                    // Direct feedback to sender only
                                    let feedback_msg = serde_json::to_string(&ServerMsg::Feedback { char: char.clone(), correct, position: current_pos }).unwrap();
                                    let _ = tx_ws.lock().await.send(Message::Text(feedback_msg.into())).await;
                                    // Broadcast progress to all
                                    let _ = tx.send((room.clone(), ServerMsg::ProgressUpdate { name: name.clone(), position: game.positions[name] }));
                                    // If finished, broadcast finish/result as before
                                    if correct && game.positions[name] >= game.text.len() {
                                        if let Some(start) = game.race_start {
                                            let elapsed = start.elapsed().as_millis();
                                            game.finishes.push((name.clone(), elapsed));
                                            let _ = tx.send((room.clone(), ServerMsg::Finish { name: name.clone(), time_ms: elapsed }));
                                            if game.finishes.len() == game.players.len() {
                                                let results = game.finishes.clone();
                                                let _ = tx.send((room.clone(), ServerMsg::RaceResult { results }));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                Err(_) => {
                    let room = my_room.lock().await.clone();
                    let _ = tx.send((room, ServerMsg::Error { message: "Invalid message".into() }));
                }
            },
            Message::Close(_) => {
                if let Some(name) = my_name.lock().await.take() {
                    let room = my_room.lock().await.clone();
                    let mut all = rooms.lock().await;
                    if let Some(game) = all.get_mut(&room) {
                        // Only remove player if race NOT started
                        if game.race_start.is_none() {
                            game.players.remove(&name);
                            game.positions.remove(&name);
                            let players = game.players.iter().cloned().collect();
                            let _ = tx.send((room, ServerMsg::LobbyUpdate { players }));
                        } else {
                            // Race in progress — keep player data but maybe mark disconnected?
                            // Optionally, you can track disconnected players here if you want.
                            println!("Player {} disconnected during race, keeping state", name);
                        }
                    }
                }
                break;
            }
            _ => {}
        }
    }
}
