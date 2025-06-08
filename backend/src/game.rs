use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    // sync::{Arc, Mutex},
    sync::Arc,
};
use tokio::time::Instant;

// — Protocol:
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type", content = "payload", rename_all = "camelCase")]
pub enum ServerMsg {
    LobbyUpdate {
        players: Vec<String>,
    },
    NameConflict,
    Countdown {
        seconds_left: u8,
    },
    StartRace {
        text: String,
    },
    Feedback {
        char: String,
        correct: bool,
        position: usize,
    },
    ProgressUpdate {
        name: String,
        position: usize,
    },
    Finish {
        name: String,
        time_ms: u128,
    },
    RaceResult {
        results: Vec<(String, u128)>,
    },
    Error {
        message: String,
    },
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "camelCase")]
pub enum ClientMsg {
    Join {
        room: String,
        name: String,
        reconnect: bool,
    },
    Keystroke {
        char: String,
    },
}

// — Per‐game state & alias:
pub struct GameState {
    pub players: HashSet<String>,
    pub positions: HashMap<String, usize>,
    pub finishes: Vec<(String, u128)>,
    pub text: String,
    pub race_start: Option<Instant>,
}

// pub type Rooms = Arc<Mutex<HashMap<String, GameState>>>;
pub type Rooms = Arc<tokio::sync::Mutex<HashMap<String, GameState>>>;
