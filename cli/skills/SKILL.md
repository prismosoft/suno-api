# Suno CLI Skill

Use the `suno-cli` command to generate music, lyrics, and stems via the Suno API.

## When to use

- User asks to generate music, songs, or audio
- User asks to write or generate lyrics
- User asks to extend, remix, or split audio stems
- User asks to check their Suno credit balance

## Prerequisites

The `suno-cli` command must be installed (`npm install -g suno-cli` or `npm link`).
Environment variables must be set:
- `SUNO_API_URL` — the deployed API URL
- `SUNO_API_TOKEN` — the bearer token

## Commands

### Generate music
```bash
suno-cli generate --prompt "A heavy metal song about war" [--instrumental] [--wait]
```

### Custom generate (lyrics + style + title)
```bash
suno-cli custom-generate --prompt "lyrics here" --tags "rock, upbeat" --title "My Song"
```

### Generate lyrics
```bash
suno-cli lyrics --prompt "A song about the ocean"
```

### Extend audio
```bash
suno-cli extend --id <clip_id> --prompt "more lyrics" --continue-at 01:30
```

### Generate stems (separate vocals/music)
```bash
suno-cli stems --id <audio_id>
```

### Concatenate (full song from extensions)
```bash
suno-cli concat --id <clip_id>
```

### Get music info
```bash
suno-cli get --ids <id1,id2>    # specific songs
suno-cli get                     # all songs
```

### Get clip info
```bash
suno-cli clip --id <clip_id>
```

### Get aligned lyrics (word timestamps)
```bash
suno-cli aligned-lyrics --id <song_id>
```

### Get credit/quota info
```bash
suno-cli limit
```

### Wait for song completion
```bash
suno-cli wait --ids <id1,id2> --interval 5 --timeout 120
```

### Interactive mode
```bash
suno-cli interactive
```

## Output

All commands output JSON to stdout. Errors go to stderr with exit code 1.

## Typical agent workflow

1. Generate: `suno-cli generate --prompt "..."` → get clip IDs
2. Wait: `suno-cli wait --ids <ids>` → poll until complete
3. Get: `suno-cli get --ids <ids>` → retrieve audio_url
4. Return audio URLs to user

## OpenAI-compatible endpoint

```bash
suno-cli chat --messages '[{"role":"user","content":"Generate a song about cats"}]'
```