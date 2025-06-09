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

// use crate::game::{ClientMsg, ServerMsg, GameState, Rooms};
use crate::game::{GameState, Rooms};

fn encode_str(s: &str) -> Vec<u8> {
    let mut v = (s.len() as u16).to_be_bytes().to_vec();
    v.extend(s.as_bytes());
    v
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State((tx, rooms)): State<(Sender<(String, u8, Vec<u8>)>, Rooms)>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, tx, rooms))
}

async fn handle_socket(
    socket: WebSocket,
    tx: Sender<(String, u8, Vec<u8>)>,
    rooms: Rooms,
) {
    // Split into sink and stream
    let (ws_tx, mut ws_rx) = socket.split();
    let ws_tx = Arc::new(Mutex::new(ws_tx));
    let mut rx_bc = tx.subscribe();

    // Shared per-connection state
    let my_room = Arc::new(Mutex::new(String::new()));
    let my_name = Arc::new(Mutex::new(None::<String>));

    // 1) Spawn broadcast task: send non-feedback messages to this client
    {
        let my_room = Arc::clone(&my_room);
        let ws_tx_for_broadcaster = Arc::clone(&ws_tx);
        tokio::spawn(async move {
            while let Ok((room_id, tag, payload)) = rx_bc.recv().await {
                if tag == 6 {
                    continue; // skip per-keystroke feedback
                }
                if room_id == *my_room.lock().await {
                    let mut frame = Vec::with_capacity(1 + payload.len());
                    frame.push(tag);
                    frame.extend(&payload);
                    let _ = ws_tx_for_broadcaster
                        .lock()
                        .await
                        .send(Message::Binary(frame.into()))
                        .await;
                }
            }
        });
    }

    // Main loop: handle incoming messages and closure
    while let Some(Ok(msg)) = ws_rx.next().await {
        match msg {
            Message::Binary(buf) => {
                let tag = buf[0];
                let data = &buf[1..];
                match tag {
                    0 => { // Join
                        let mut off = 0;
                        let room_len = u16::from_be_bytes([data[off], data[off+1]]) as usize;
                        off += 2;
                        let room = String::from_utf8_lossy(&data[off..off+room_len]).to_string();
                        off += room_len;
                        let name_len = u16::from_be_bytes([data[off], data[off+1]]) as usize;
                        off += 2;
                        let name = String::from_utf8_lossy(&data[off..off+name_len]).to_string();
                        off += name_len;
                        let reconnect = data[off] != 0;

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

                            // Always send lobby state
                            // let players = game.players.iter().cloned().collect();
                            // let _ = tx.send((room.clone(), ServerMsg::LobbyUpdate { players }));

                            // Send LobbyUpdate
                            let players: Vec<_> = game.players.iter().cloned().collect();
                            let mut payload = (players.len() as u16).to_be_bytes().to_vec();
                            for p in &players { payload.extend(encode_str(p)); }
                            let _ = tx.send((room.clone(), 2, payload));

                            // if we've already started the countdown but not the race
                            if let Some(start) = game.race_start {
                                let elapsed = start.elapsed().as_secs();
                                let remaining = if elapsed < 3 { 3 - elapsed as u8 } else { 0 };
                                let _ = tx.send((room.clone(), 4, vec![remaining]));
                            }
                            // If race is running or done
                            if game.race_start.is_some() {
                                // Send StartRace (tag=5): text length + UTF-8
                                let text_bytes = game.text.as_bytes();
                                let mut race_payload = (text_bytes.len() as u16).to_be_bytes().to_vec();
                                race_payload.extend(text_bytes);
                                let _ = tx.send((room.clone(), 5, race_payload));

                                println!("If race is running or done");
                                // Replay Feedback (tag=6) for each correct char
                                if let Some(&pos) = game.positions.get(&name) {
                                    for i in 0..pos {
                                        println!("(reconn) send feedback position {}",i);
                                        let ch = game.text.chars().nth(i).unwrap().to_string();
                                        let mut fb = (i as u16).to_be_bytes().to_vec();
                                        fb.push(1); // correct = true
                                        fb.extend(encode_str(&ch));
                                        let _ = tx.send((room.clone(), 6, fb));
                                    }
                                }
                                // broadcast everyone's cursor so their UI sees them
                                //
                                // Replay ProgressUpdate (tag=7) for each player
                                for (other, &pos) in &game.positions {
                                    let mut pu = encode_str(other);
                                    pu.extend((pos as u16).to_be_bytes());
                                    let _ = tx.send((room.clone(), 7, pu));
                                }
                                // If already finished, send RaceResult (tag=9)
                                if game.finishes.len() == game.players.len() {
                                    let mut rr = (game.finishes.len() as u16).to_be_bytes().to_vec();
                                    for (n, t) in &game.finishes {
                                        rr.extend(encode_str(n));
                                        rr.extend((*t as u64).to_be_bytes());
                                    }
                                    let _ = tx.send((room.clone(), 9, rr));
                                }
                            }
                        }
                        // 5) Brand-new join
                        else if game.players.contains(&name) {
                            // Send conflict message directly to the requester
                            println!("Error: name {} already in room {}", name, room);
                            // let conflict_msg = serde_json::to_string(&ServerMsg::NameConflict).unwrap();
                            // let _ = tx_ws.lock().await.send(Message::Text(conflict_msg.into())).await;
                            let _ = ws_tx.lock().await.send(Message::Binary(vec![3].into())).await;
                        } else {
                            game.players.insert(name.clone());
                            game.positions.insert(name.clone(), 0);
                            *my_room.lock().await = room.clone();
                            *my_name.lock().await = Some(name.clone());

                            // Send LobbyUpdate
                            let players: Vec<_> = game.players.iter().cloned().collect();
                            let mut payload = (players.len() as u16).to_be_bytes().to_vec();
                            for p in &players { payload.extend(encode_str(p)); }
                            let _ = tx.send((room.clone(), 2, payload));

                            if game.players.len() >= 3 {
                                let tx2 = tx.clone();
                                let room2 = room.clone();
                                let rooms2 = rooms.clone();
                                tokio::spawn(async move {
                                    // Countdown: broadcast tag=4 (Countdown) frames
                                    for sec in (1..=3).rev() {
                                        let _ = tx2.send((room2.clone(), 4, vec![sec]));
                                        sleep(Duration::from_secs(1)).await;
                                    }

                                    // Start the race: grab the text and record the start time
                                    let text = {
                                        let g = rooms2.lock().await;
                                        g.get(&room2).unwrap().text.clone()
                                    };
                                    rooms2.lock().await
                                        .get_mut(&room2)
                                        .unwrap()
                                        .race_start = Some(Instant::now());

                                    // Send StartRace (tag=5): u16 BE length + UTF-8 payload
                                    let text_bytes = text.as_bytes();
                                    let mut payload = (text_bytes.len() as u16).to_be_bytes().to_vec();
                                    payload.extend(text_bytes);
                                    let _ = tx2.send((room2.clone(), 5, payload));
                                });
                            }
                        }
                    }

                    1 => { // Keystroke (type 1)
                        // Parse char: length-prefixed UTF-8
                        let mut off = 0;
                        let char_len = u16::from_be_bytes([data[off], data[off+1]]) as usize;
                        off += 2;
                        let ch = String::from_utf8_lossy(&data[off..off+char_len]).to_string();
                        off += char_len;

                        // Game logic
                        if let Some(name) = my_name.lock().await.as_ref() {
                            let room_id = my_room.lock().await.clone();
                            let mut rooms_map = rooms.lock().await;
                            if let Some(game) = rooms_map.get_mut(&room_id) {
                                if let Some(&pos) = game.positions.get(name) {
                                    let correct = game.text.chars().nth(pos).map_or(false, |exp| exp.to_string() == ch);
                                    if correct {
                                        game.positions.insert(name.clone(), pos + 1);
                                    }
                                    // Send Feedback (tag=6)
                                    let mut fb = (pos as u16).to_be_bytes().to_vec();
                                    fb.push(if correct { 1 } else { 0 });
                                    fb.extend(encode_str(&ch));
                                    let _ = ws_tx.lock().await.send(Message::Binary([vec![6], fb].concat().into())).await;

                                    // Broadcast ProgressUpdate (tag=7)
                                    let new_pos = *game.positions.get(name).unwrap();
                                    let mut pu = encode_str(name);
                                    pu.extend((new_pos as u16).to_be_bytes());
                                    let _ = tx.send((room_id.clone(), 7, pu));

                                    // If finished, send Finish (tag=8) and possibly RaceResult (tag=9)
                                    if correct && new_pos >= game.text.len() {
                                        if let Some(start) = game.race_start {
                                            let elapsed = start.elapsed().as_millis();
                                            game.finishes.push((name.clone(), elapsed));
                                            // Finish
                                            let mut fin = encode_str(name);
                                            fin.extend(elapsed.to_be_bytes());
                                            let _ = tx.send((room_id.clone(), 8, fin));

                                            // If all finished, RaceResult
                                            if game.finishes.len() == game.players.len() {
                                                let mut rr = (game.finishes.len() as u16).to_be_bytes().to_vec();
                                                for (n, t) in &game.finishes {
                                                    rr.extend(encode_str(n));
                                                    rr.extend((*t as u64).to_be_bytes());
                                                }
                                                let _ = tx.send((room_id.clone(), 9, rr));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    _ => {
                        // Unknown or invalid binary message: reply with error tag 255
                        let room = my_room.lock().await.clone();
                        let err_msg = encode_str("Invalid message");
                        // use broadcast so reconnect clients also see errors if needed
                        let _ = tx.send((room.clone(), 255, err_msg));
                    }, 
                }
            }
            Message::Close(_) => {
                // Client disconnected: clean up lobby if race not started
                if let Some(name) = my_name.lock().await.take() {
                    let room = my_room.lock().await.clone();
                    let mut all = rooms.lock().await;
                    if let Some(game) = all.get_mut(&room) {
                        if game.race_start.is_none() {
                            game.players.remove(&name);
                            game.positions.remove(&name);
                            // Broadcast updated lobby: tag 2
                            let players: Vec<_> = game.players.iter().cloned().collect();
                            let mut buf = (players.len() as u16).to_be_bytes().to_vec();
                            for p in &players { buf.extend(encode_str(p)); }
                            let _ = tx.send((room.clone(), 2, buf));
                        } else {
                            // Race in progress: keep state
                            println!("Player {} disconnected during race", name);
                        }
                    }
                }
                break;
            }
            _ => {
                // Ignore other message types
            }
        } 
    }
}
