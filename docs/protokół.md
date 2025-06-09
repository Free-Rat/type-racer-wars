## Message Types (u8)

| Type | Name           | Direction | Payload Fields                                                              |
| ---- | -------------- | --------- | --------------------------------------------------------------------------- |
| 0    | Join           | C → S     | room_id (length + UTF‑8), player_name (length + UTF‑8), reconnect (u8: 0/1) |
| 1    | Keystroke      | C → S     | char (1‑byte ASCII or UTF‑8 sequence with length prefix)                    |
| 2    | LobbyUpdate    | S → C     | N (u16 big‑endian), then N × (name length + UTF‑8)                          |
| 3    | NameConflict   | S → C     | none                                                                        |
| 4    | Countdown      | S → C     | seconds_left (u8)                                                           |
| 5    | StartRace      | S → C     | text length (u16 BE) + UTF‑8 text                                           |
| 6    | Feedback       | S → C     | position (u16 BE), correct (u8:0/1), char (length+UTF‑8)                    |
| 7    | ProgressUpdate | S → C     | name length + UTF‑8, position (u16 BE)                                      |
| 8    | Finish         | S → C     | name length + UTF‑8, time_ms (u64 BE)                                       |
| 9    | RaceResult     | S → C     | M (u16 BE), then M × (name length+UTF‑8, time_ms u64 BE)                    |
