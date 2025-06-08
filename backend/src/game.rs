use std::collections::HashMap;
use uuid::Uuid;

#[derive(Clone)]
pub struct PlayerState {
    pub id: Uuid,
    pub words_typed: usize,
    pub current_word: String,
}

pub struct GameState {
    pub players: HashMap<Uuid, PlayerState>,
    pub text: Vec<String>,
}

impl GameState {
    pub fn new(text: Vec<String>) -> Self {
        Self {
            players: HashMap::new(),
            text,
        }
    }

    pub fn register_player(&mut self, id: Uuid) {
        self.players.insert(
            id,
            PlayerState {
                id,
                words_typed: 0,
                current_word: String::new(),
            },
        );
    }

    pub fn update_word(&mut self, id: Uuid, word: &str) -> Option<(bool, Option<Uuid>)> {
        let player = self.players.get_mut(&id)?;

        // Sprawdź czy to słowo, które powinien wpisać
        let expected = self.text.get(player.words_typed)?;

        if word == expected {
            player.words_typed += 1;
            player.current_word = String::new();
            return Some((true, None));
        }

        // Sprawdź, czy to słowo innego gracza
        for (other_id, other_player) in &mut self.players {
            if other_id != &id && word == other_player.current_word {
                other_player.words_typed = other_player.words_typed.saturating_sub(2);
                return Some((false, Some(*other_id)));
            }
        }

        Some((false, None))
    }

    pub fn update_typing(&mut self, id: Uuid, partial: String) {
        if let Some(p) = self.players.get_mut(&id) {
            p.current_word = partial;
        }
    }
}
