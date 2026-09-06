# Suno CLI Skill

Use the `suno-cli` command to generate music, lyrics, and stems via the Suno API.
All commands output JSON to stdout. Errors go to stderr with exit code 1.

## When to use

- User asks to generate music, songs, or audio
- User asks to write or generate lyrics
- User asks to extend, remix, or split audio stems
- User asks to check their Suno credit balance
- User asks to concatenate extensions into a full song
- User asks for word-level lyric timestamps (karaoke alignment)
- User asks to generate a song **with a specific voice/persona**
- User asks to **create a voice** from an existing song
- User asks to look up or **edit a persona/voice**

## Prerequisites

The `suno-cli` command must be installed (`npm install -g suno-cli` or `npm link`).
Environment variables must be set:
- `SUNO_API_URL` — the deployed API URL (default: https://suno.prismosoft.com)
- `SUNO_API_TOKEN` — the bearer token

### Environment loading (automatic)

The CLI auto-loads env vars from `~/.suno-cli.env` and `./.env` (in the
current directory). It also maps `API_BEARER_TOKEN` (the app's env var
convention) to `SUNO_API_TOKEN` automatically, so a project `.env` with
`API_BEARER_TOKEN=...` works out of the box.

### Non-interactive mode (for agents)

**Always pass `--yes` when calling suno-cli from scripts or agents.**
This skips all confirmation prompts. If a token is found in the
environment or `.env` files, commands run directly with zero prompts:

```bash
suno-cli generate --prompt "A song about cats" --yes --yessuno-cli wait --ids abc123 --yes --yessuno-cli limit --yes --yes```

Without `--yes`, the CLI may prompt interactively (config confirmation,
missing args) which will hang non-interactive callers. When configuring
for the first time, the CLI can save credentials to `./.env` (as
`API_BEARER_TOKEN`), `~/.suno-cli.env`, or both.

---

## Generation modes

Three ways to generate music depending on your workflow:

### Async (default) — fire and forget
```bash
suno-cli generate --prompt "A song about cats" --yes```
Returns clip IDs immediately (a few seconds). Suno renders in the background.
Output includes `id` and `status: "queued"` for each clip.

### Sync — block until done
```bash
suno-cli generate --prompt "A song about cats" --wait --yes```
Holds the connection for up to 100s, polls internally, returns final results
with `audio_url` when ready (or `error` if it failed).

### Async + separate polling (best for agents)
```bash
# Step 1: fire — returns clip IDs immediately
suno-cli generate --prompt "A song about cats" --yes# → [{"id": "abc123", "status": "queued"}, {"id": "def456", "status": "queued"}]

# Step 2: poll — prints progress to stderr, final JSON to stdout
suno-cli wait --ids abc123,def456 --interval 5 --timeout 120 --yes# → stderr: Waiting... abc123: queued, def456: streaming
# → stdout: [{"id": "abc123", "status": "complete", "audio_url": "https://..."}]

# Step 3: get final info anytime
suno-cli get --ids abc123,def456 --yes# → includes audio_url, video_url, status, duration, lyrics
```

The `wait` command keeps stderr for progress and stdout for clean JSON,
so it can be piped: `suno-cli wait --ids abc123 | jq '.[0].audio_url'`.
Exit code 1 on timeout.

**For agents:** use async + polling. Generate without `--wait`, then
`suno-cli wait` to poll. This lets the agent do other things between checks.

---

## All commands — agent reference

### `generate` — Generate music from a text prompt
```bash
suno-cli generate --prompt "A heavy metal song about war" --yes```
| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `-p, --prompt` | string | required | Text prompt describing the music |
| `-i, --instrumental` | boolean | false | Instrumental only (no vocals) |
| `-m, --model` | string | chirp-v3-5 | Model name |
| `-w, --wait` | boolean | false | Block until audio is ready |

**Agent usage:** Call without `--wait` to get IDs fast, then poll with `wait`.
Returns array of 2 clips (Suno generates 2 variations per request).
If `--prompt` is omitted, the CLI prompts interactively (not for agents).

**Output fields:** `id`, `title`, `status`, `audio_url`, `video_url`, `image_url`, `lyric`, `tags`, `duration`, `model_name`, `created_at`

### `custom-generate` — Generate with full control (lyrics, style, title)
```bash
suno-cli custom-generate --prompt "Verse 1...\nChorus..." --tags "rock, upbeat" --title "My Song" --yes```
| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `-p, --prompt` | string | required | Lyrics text |
| `-t, --tags` | string | "" | Music style/genre tags |
| `--title` | string | "" | Song title |
| `-i, --instrumental` | boolean | false | Instrumental only |
| `-m, --model` | string | chirp-v3-5 | Model name |
| `-w, --wait` | boolean | false | Block until audio is ready |
| `--negative-tags` | string | undefined | Tags to avoid |

**Agent usage:** Use when the user provides specific lyrics or wants a particular
style. The `prompt` should contain the full lyrics with section markers like
`[Verse]`, `[Chorus]`, `[Bridge]`. Returns 2 clips.

### `lyrics` — Generate lyrics from a prompt
```bash
suno-cli lyrics --prompt "A song about the ocean, themes of loneliness and hope" --yes```
| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `-p, --prompt` | string | required | What the lyrics should be about |

**Agent usage:** Use when the user wants lyrics only (no music). Returns an
object with `text` containing the generated lyrics, `status`, and `id`.
Can be used as a pre-step before `custom-generate` if the user wants to
review/edit lyrics before generating music.

### `extend` — Extend an existing audio clip
```bash
suno-cli extend --id abc123 --prompt "more lyrics here" --continue-at 01:30 --tags "rock" --yes```
| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `-i, --id` | string | required | Audio clip ID to extend |
| `-p, --prompt` | string | "" | Lyrics/prompt for the extension |
| `-c, --continue-at` | mm:ss | 0 (end) | Timestamp to continue from |
| `-t, --tags` | string | "" | Music style for the extension |
| `--title` | string | "" | Title for the extension |
| `-m, --model` | string | chirp-v3-5 | Model name |
| `-w, --wait` | boolean | false | Block until audio is ready |

**Agent usage:** Use when the user has an existing song and wants to make it
longer. `--continue-at` uses `mm:ss` format (e.g. `01:30` = 90 seconds).
If omitted, extends from the end of the song. Returns 2 new clips that are
extensions of the original.

### `stems` — Separate vocals and music (stem tracks)
```bash
suno-cli stems --id abc123 --yes```
| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `-i, --id` | string | required | Audio clip ID |

**Agent usage:** Use when the user wants to isolate vocals or instruments.
Returns array of stem clips with `id`, `status`, `title`, `stem_from_id`,
`duration`, `created_at`. Poll with `wait` using the returned IDs.

### `concat` — Generate full song from extensions
```bash
suno-cli concat --id abc123 --yes```
| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `-i, --id` | string | required | Clip ID to concatenate |

**Agent usage:** Use after extending a song multiple times. Takes the base clip
ID and concatenates all its extensions into one full song. Returns a single
`AudioInfo` object with the concatenated result.

### `get` — Get music info by IDs or list all
```bash
suno-cli get --ids abc123,def456    # specific songs --yessuno-cli get                         # all songs --yessuno-cli get --page 2                # paginated --yes```
| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `-i, --ids` | string | undefined | Comma-separated song IDs |
| `--page` | string | undefined | Page number for pagination |

**Agent usage:** Use to check song status (`queued`, `streaming`, `complete`,
`error`) and retrieve `audio_url` / `video_url` when ready. Without `--ids`,
returns all songs for the account (useful for listing recent creations).

**Output fields:** `id`, `title`, `status`, `audio_url`, `video_url`,
`image_url`, `lyric`, `prompt`, `tags`, `negative_tags`, `duration`,
`model_name`, `created_at`, `type`, `error_message`

### `clip` — Get single clip info
```bash
suno-cli clip --id abc123 --yes
```
| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `-i, --id` | string | required | Clip ID |

**Agent usage:** Use to get detailed info about a single clip. Returns the raw
clip object from Suno (more fields than `get`).

### `aligned-lyrics` — Word-level timestamps (karaoke alignment)
```bash
suno-cli aligned-lyrics --id abc123 --yes
```
| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `-i, --id` | string | required | Song ID |

**Agent usage:** Use when the user wants karaoke-style timing data. Returns
array of word objects: `word`, `start_s`, `end_s`, `success`, `p_align`.
Song must be fully generated (`status: complete`) before this works.

### `limit` — Get credit/quota info
```bash
suno-cli limit --yes```
No flags.

**Agent usage:** Check before generating to see if credits are available.
Returns: `credits_left`, `period`, `monthly_limit`, `monthly_usage`.
Pro accounts have higher limits. Each `generate` call uses credits.

### `wait` — Poll for song completion
```bash
suno-cli wait --ids abc123,def456 --interval 5 --timeout 120 --yes```
| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `-i, --ids` | string | required | Comma-separated song IDs |
| `--interval` | number | 5 | Poll interval in seconds |
| `--timeout` | number | 120 | Timeout in seconds |

**Agent usage:** Use after `generate` (without `--wait`) to poll until songs
are ready. Prints progress to stderr (`Waiting... abc123: queued`), final JSON
to stdout. Exit 0 when all songs are `complete`/`streaming` or `error`.
Exit 1 on timeout. Safe to pipe: `suno-cli wait --ids abc123 | jq '.[0].audio_url'`.

### `persona` — Get persona (voice) info
```bash
suno-cli persona --id persona123 --page 1 --yes
```
| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `-i, --id` | string | required | Persona ID |
| `--page` | number | 1 | Page number |

**Agent usage:** Use to look up a Suno persona (voice profile). Returns
persona details including `name`, `description`, `image`, clips, and metadata.

### `persona-create` — Create a voice from a song you own
```bash
suno-cli persona-create --clip <clip_id> --name "My Voice" --description "soulful R&B vocals" --styles "soulful vocals, R&B" --yes
```
| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `-c, --clip` | string | required | Root clip ID (a completed song owned by the account) |
| `-n, --name` | string | required | Persona display name |
| `-d, --description` | string | "" | Persona description |
| `--styles` | string | undefined | Style description (e.g. "soulful vocals, R&B") |
| `--public` | boolean | false | Make persona public (default private) |

**Agent usage:** Use when the user wants to create a reusable voice from a
generated song. The clip must be a **completed** song owned by the account.
Returns the created persona object — its `id` is the `persona_id` to pass to
`generate` / `custom-generate` with `--persona`.

### `persona-update` — Edit an existing voice
```bash
suno-cli persona-update --id <persona_id> --name "New Name" --yes
suno-cli persona-update --id <persona_id> --public --yes
```
| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `-i, --id` | string | required | Persona ID |
| `-n, --name` | string | undefined | New name |
| `-d, --description` | string | undefined | New description |
| `--public` / `--private` | boolean | undefined | Toggle visibility |

**Agent usage:** Use to rename, redescribe, or toggle visibility of a voice.
Only pass the fields you want to change.

### `generate` / `custom-generate` with a voice
```bash
suno-cli generate --prompt "A song about cats" --persona <persona_id> --yes
suno-cli custom-generate --prompt "lyrics..." --tags "rock" --title "My Song" --persona <persona_id> --yes
```
| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `-V, --persona` | string | undefined | Persona (voice) ID to generate with |

**Agent usage:** Pass `--persona <id>` to generate songs using a specific
voice. Combine with lyrics (`custom-generate --prompt`) and styles
(`--tags`) for full control: voice + lyrics + style in one call.

### `chat` — OpenAI-compatible chat completions
```bash
suno-cli chat --yes --messages '[{"role":"user","content":"Generate a song about cats"}]'
```
| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `-m, --messages` | JSON string | required | Array of message objects |
| `--model` | string | suno | Model name |
| `--stream` | boolean | false | Stream response |

**Agent usage:** Use when integrating with OpenAI-compatible tooling. The
content of the user message becomes the generation prompt. Returns an
OpenAI-format chat completion response with the generated song info.

### `interactive` — Guided interactive menu
```bash
suno-cli interactive
```
No flags.

**Agent usage:** Not for agents — this is for human users. Presents a menu
to pick a command and prompts for all required inputs interactively.

### `skills:install` — Install skill files into a project
```bash
suno-cli skills:install                    # installs to ./.agents/skills/suno-cli/
suno-cli skills:install /path/to/project   # custom target
suno-cli skills:install --force            # overwrite existing
```
| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `[dir]` | string | ./.agents/skills/suno-cli | Target directory |
| `--force` | boolean | false | Overwrite existing files |

**Agent usage:** Use to install this skill into another project so other
agents can discover and use `suno-cli`. Copies `SKILL.md`,
`suno-env.example`, and `scripts/suno-wrapper.sh`.

---

## Typical agent workflows

### Generate and return audio URL (async — recommended)
```bash
# 1. Generate — returns 2 clip IDs immediately
suno-cli generate --prompt "A jazz song about rainy nights" --yes
# 2. Poll — waits until songs are ready
suno-cli wait --ids <id1>,<id2> --interval 5 --timeout 120 --yes
# 3. Return audio URLs to user
# audio_url and video_url are in the final JSON output
```

### Generate and return audio URL (sync — simpler, blocks up to 100s)
```bash
suno-cli generate --prompt "A jazz song about rainy nights" --wait --yes# audio_url is directly in the output
```

### Generate with custom lyrics and style
```bash
# Optionally generate lyrics first
suno-cli lyrics --prompt "A song about overcoming adversity" --yes
# Then generate with the lyrics
suno-cli custom-generate \ --yes  --prompt "[Verse 1]\nI was lost in the dark...\n[Chorus]\nBut I found my way" \
  --tags "uplifting pop, acoustic guitar, warm vocals" \
  --title "Finding My Way"

# Poll for completion
suno-cli wait --ids <id1>,<id2> --yes```

### Extend a song
```bash
# Get the original song ID
suno-cli get --yes
# Extend from 01:30
suno-cli extend --id <clip_id> --continue-at 01:30 --tags "rock" --yes
# Poll for the extension
suno-cli wait --ids <new_id1>,<new_id2> --yes
# Concatenate all extensions into full song
suno-cli concat --id <base_clip_id> --yes```

### Generate multiple songs at once
```bash
# Fire multiple generate calls (1-2s apart to avoid rate limits)
suno-cli generate --prompt "A jazz song" --yessuno-cli generate --prompt "A rock song" --yessuno-cli generate --prompt "A pop song" --yes
# Collect all IDs, poll them all at once
suno-cli wait --ids <jazz1>,<jazz2>,<rock1>,<rock2>,<pop1>,<pop2> --interval 5 --yes
# Suno renders them in parallel on its side
```

### Check credits before generating
```bash
suno-cli limit --yes# → {"credits_left": 2375, "monthly_limit": 2500, "monthly_usage": 140}
# If credits_left is low, warn the user before generating
```

### Separate vocals from music
```bash
suno-cli stems --id <clip_id> --yes
suno-cli wait --ids <stem_id1>,<stem_id2>,<stem_id3>,<stem_id4> --yes
suno-cli get --ids <stem_ids> --yes
```

### Create a voice from a song, then generate with it
```bash
# 1. Generate a song with a voice the user likes
suno-cli generate --prompt "A soulful female R&B vocalist singing about love" --yes
suno-cli wait --ids <id1>,<id2> --yes

# 2. Create a persona (voice) from the completed clip
suno-cli persona-create --clip <clip_id> --name "Soulful Voice" \
  --description "Warm soulful female R&B vocals" --styles "soulful vocals, R&B" --yes
# → returns persona with "id"

# 3. Generate new songs using that voice + custom lyrics + style
suno-cli custom-generate \
  --prompt "[Verse]\nYour lyrics here...\n[Chorus]\n..." \
  --tags "R&B, smooth, 80 BPM" \
  --title "New Song" \
  --persona <persona_id> --yes

# 4. Poll and return
suno-cli wait --ids <id1>,<id2> --yes
```

---

## REST API reference (for direct HTTP calls)

All endpoints require `Authorization: Bearer <token>` header.
Base URL: `SUNO_API_URL` (default https://suno.prismosoft.com)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/generate` | Generate music. Body: `prompt`, `make_instrumental`, `model`, `wait_audio`, `persona_id` |
| POST | `/api/custom_generate` | Generate with lyrics/style/title. Body adds: `tags`, `title`, `negative_tags`, `persona_id` |
| POST | `/api/generate_lyrics` | Generate lyrics. Body: `prompt` |
| POST | `/api/extend_audio` | Extend a clip. Body: `audio_id`, `prompt`, `continue_at`, `tags`, `title` |
| POST | `/api/generate_stems` | Split stems. Body: `audio_id` |
| POST | `/api/concat` | Concatenate extensions. Body: `clip_id` |
| GET | `/api/get` | List songs. Query: `ids`, `page` |
| GET | `/api/clip` | Clip info. Query: `id` |
| GET | `/api/get_aligned_lyrics` | Word timestamps. Query: `song_id` |
| GET | `/api/get_limit` | Credit info |
| GET | `/api/persona` | Persona info. Query: `id`, `page` |
| POST | `/api/persona` | Create persona. Body: `root_clip_id`, `name`, `description`, `is_public`, `user_input_styles` |
| PUT | `/api/persona` | Update persona. Body: `persona_id`, `name`, `description`, `is_public` |
| POST | `/v1/chat/completions` | OpenAI-compatible endpoint |

---

## Output format

All commands output JSON to stdout. Example `generate` output:
```json
[
  {
    "id": "841d2c43-54aa-4c42-aa4c-990870996c45",
    "title": "My Song",
    "status": "complete",
    "audio_url": "https://cdn2.suno.ai/audio_841d2c43....mp3",
    "video_url": "https://cdn2.suno.ai/video_841d2c43....mp4",
    "image_url": "https://cdn2.suno.ai/image_841d2c43....jpeg",
    "lyric": "Verse 1...\nChorus...",
    "tags": "rock, upbeat",
    "duration": 248.6,
    "model_name": "chirp-v3-5",
    "created_at": "2026-09-04T17:00:00.000Z"
  }
]
```

Status values: `queued` → `streaming` → `complete` (or `error`)

When status is `queued` or `streaming`, `audio_url` may be empty or
`https://studio-api.prod.suno.com/api/forbidden`. Wait for `complete`
before using the URLs.