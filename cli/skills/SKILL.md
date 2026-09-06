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
- `SUNO_API_URL` — the deployed API URL (default: https://suno.prismosoft.com)
- `SUNO_API_TOKEN` — the bearer token

If env vars are not set, the CLI will prompt interactively to configure them
and optionally save to `~/.suno-cli.env`.

## Generation modes

There are three ways to generate music depending on your workflow:

### Async (default) — fire and forget
```bash
suno-cli generate --prompt "A song about cats"
```
Returns clip IDs immediately (a few seconds). Suno renders in the background.
Output includes `id` and `status: "queued"` for each clip.

### Sync — block until done
```bash
suno-cli generate --prompt "A song about cats" --wait
```
Holds the connection for up to 100s, polls internally, returns final results
with `audio_url` when ready (or `error` if it failed).
Same as `wait_audio: true` in the API.

### Async + separate polling (best for agents)
```bash
# Step 1: fire — returns clip IDs immediately
suno-cli generate --prompt "A song about cats"
# → [{"id": "abc123", "status": "queued"}, {"id": "def456", "status": "queued"}]

# Step 2: poll — prints progress to stderr, final JSON to stdout
suno-cli wait --ids abc123,def456 --interval 5 --timeout 120
# → stderr: Waiting... abc123: queued, def456: streaming
# → stdout: [{"id": "abc123", "status": "complete", "audio_url": "https://..."}]

# Step 3: get final info anytime
suno-cli get --ids abc123,def456
# → includes audio_url, video_url, status, duration, lyrics
```

The `wait` command keeps stderr for progress and stdout for clean JSON,
so it can be piped in scripts: `suno-cli wait --ids abc123 | jq '.[0].audio_url'`.
Exit code 1 on timeout.

**For agents:** use the async + polling pattern. Generate without `--wait`,
then `suno-cli wait` to poll. This lets the agent do other things between
checks rather than blocking on a single call.

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

1. Generate (async): `suno-cli generate --prompt "..."` → get clip IDs from JSON output
2. Poll: `suno-cli wait --ids <id1,id2> --interval 5` → waits until status is `complete` or `streaming`
3. Retrieve: `suno-cli get --ids <id1,id2>` → get `audio_url` and `video_url`
4. Return audio URLs to user

### Sync alternative (simpler, slower)
1. Generate: `suno-cli generate --prompt "..." --wait` → blocks up to 100s, returns final result
2. Return `audio_url` from output

### Multiple songs
Each `generate` call returns 2 clips (Suno generates 2 variations). To create
multiple songs, fire several `generate` calls (sequentially, 1-2s apart to
avoid rate limits), collect all IDs, then `suno-cli wait --ids <all-ids>` to
poll them all at once. Suno renders them in parallel on its side.

## OpenAI-compatible endpoint

```bash
suno-cli chat --messages '[{"role":"user","content":"Generate a song about cats"}]'
```