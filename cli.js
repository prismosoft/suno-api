#!/usr/bin/env node

const API_URL = process.env.SUNO_API_URL || "https://suno.prismosoft.com";
const API_TOKEN = process.env.SUNO_API_TOKEN;

if (!API_TOKEN) {
  console.error("Error: SUNO_API_TOKEN environment variable is required.");
  console.error("Set it to your API_BEARER_TOKEN value:");
  console.error('  export SUNO_API_TOKEN="your-token-here"');
  process.exit(1);
}

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${API_TOKEN}`,
};

async function apiGet(path) {
  const res = await fetch(`${API_URL}${path}`, { headers });
  const data = await res.json();
  if (!res.ok) {
    console.error(`Error ${res.status}:`, data.error || data);
    process.exit(1);
  }
  return data;
}

async function apiPost(path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(`Error ${res.status}:`, data.error || data);
    process.exit(1);
  }
  return data;
}

function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}

const commands = {
  generate: {
    desc: "Generate music from a text prompt",
    usage: "generate --prompt <text> [--instrumental] [--model <model>] [--wait]",
    async run(args) {
      const prompt = args.prompt || args.p;
      if (!prompt) {
        console.error("Error: --prompt is required");
        process.exit(1);
      }
      const payload = {
        prompt,
        make_instrumental: !!args.instrumental,
        model: args.model || undefined,
        wait_audio: !!args.wait,
      };
      const result = await apiPost("/api/generate", payload);
      printJson(result);
    },
  },

  "custom-generate": {
    desc: "Generate music with custom mode (lyrics, style, title)",
    usage:
      "custom-generate --prompt <lyrics> --tags <style> --title <title> [--instrumental] [--model <model>] [--wait] [--negative-tags <tags>]",
    async run(args) {
      const prompt = args.prompt || args.p;
      if (!prompt) {
        console.error("Error: --prompt is required");
        process.exit(1);
      }
      const payload = {
        prompt,
        tags: args.tags || "",
        title: args.title || "",
        make_instrumental: !!args.instrumental,
        model: args.model || undefined,
        wait_audio: !!args.wait,
        negative_tags: args["negative-tags"] || undefined,
      };
      const result = await apiPost("/api/custom_generate", payload);
      printJson(result);
    },
  },

  lyrics: {
    desc: "Generate lyrics from a prompt",
    usage: "lyrics --prompt <text>",
    async run(args) {
      const prompt = args.prompt || args.p;
      if (!prompt) {
        console.error("Error: --prompt is required");
        process.exit(1);
      }
      const result = await apiPost("/api/generate_lyrics", { prompt });
      printJson(result);
    },
  },

  extend: {
    desc: "Extend an existing audio clip",
    usage:
      "extend --id <audio_id> [--prompt <text>] [--continue-at <mm:ss>] [--tags <style>] [--title <title>] [--model <model>] [--wait]",
    async run(args) {
      const audioId = args.id;
      if (!audioId) {
        console.error("Error: --id is required");
        process.exit(1);
      }
      const continueAt = args["continue-at"]
        ? parseTimeToSeconds(args["continue-at"])
        : 0;
      const payload = {
        audio_id: audioId,
        prompt: args.prompt || "",
        continue_at: continueAt,
        tags: args.tags || "",
        negative_tags: args["negative-tags"] || "",
        title: args.title || "",
        model: args.model || undefined,
        wait_audio: !!args.wait,
      };
      const result = await apiPost("/api/extend_audio", payload);
      printJson(result);
    },
  },

  stems: {
    desc: "Generate stem tracks (separate vocals and music)",
    usage: "stems --id <audio_id>",
    async run(args) {
      const audioId = args.id;
      if (!audioId) {
        console.error("Error: --id is required");
        process.exit(1);
      }
      const result = await apiPost("/api/generate_stems", { audio_id: audioId });
      printJson(result);
    },
  },

  concat: {
    desc: "Generate the whole song from extensions",
    usage: "concat --id <clip_id>",
    async run(args) {
      const clipId = args.id;
      if (!clipId) {
        console.error("Error: --id is required");
        process.exit(1);
      }
      const result = await apiPost("/api/concat", { clip_id: clipId });
      printJson(result);
    },
  },

  get: {
    desc: "Get music info by IDs (comma-separated), or all music if no IDs",
    usage: "get [--ids <id1,id2,...>] [--page <page>]",
    async run(args) {
      const ids = args.ids ? `?ids=${args.ids}` : "";
      const page = args.page ? `${ids ? "&" : "?"}page=${args.page}` : "";
      const result = await apiGet(`/api/get${ids}${page}`);
      printJson(result);
    },
  },

  clip: {
    desc: "Get clip information by ID",
    usage: "clip --id <clip_id>",
    async run(args) {
      const clipId = args.id;
      if (!clipId) {
        console.error("Error: --id is required");
        process.exit(1);
      }
      const result = await apiGet(`/api/clip?id=${clipId}`);
      printJson(result);
    },
  },

  "aligned-lyrics": {
    desc: "Get word-level timestamps for lyrics",
    usage: "aligned-lyrics --id <song_id>",
    async run(args) {
      const songId = args.id;
      if (!songId) {
        console.error("Error: --id is required");
        process.exit(1);
      }
      const result = await apiGet(`/api/get_aligned_lyrics?song_id=${songId}`);
      printJson(result);
    },
  },

  limit: {
    desc: "Get credit/quota info",
    usage: "limit",
    async run() {
      const result = await apiGet("/api/get_limit");
      printJson(result);
    },
  },

  persona: {
    desc: "Get persona info by ID",
    usage: "persona --id <persona_id> [--page <page>]",
    async run(args) {
      const personaId = args.id;
      if (!personaId) {
        console.error("Error: --id is required");
        process.exit(1);
      }
      const page = args.page ? `&page=${args.page}` : "";
      const result = await apiGet(`/api/persona?id=${personaId}${page}`);
      printJson(result);
    },
  },

  chat: {
    desc: "OpenAI-compatible chat completions endpoint",
    usage: 'chat --messages \'[{"role":"user","content":"Generate a song about cats"}]\'',
    async run(args) {
      let messages = args.messages;
      if (!messages) {
        console.error("Error: --messages is required (JSON array)");
        process.exit(1);
      }
      if (typeof messages === "string") {
        messages = JSON.parse(messages);
      }
      const payload = {
        model: args.model || "suno",
        messages,
        stream: !!args.stream,
      };
      const result = await apiPost("/v1/chat/completions", payload);
      printJson(result);
    },
  },

  wait: {
    desc: "Poll for song completion by IDs until status is streaming/complete",
    usage: "wait --ids <id1,id2> [--interval <seconds>] [--timeout <seconds>]",
    async run(args) {
      const ids = args.ids;
      if (!ids) {
        console.error("Error: --ids is required");
        process.exit(1);
      }
      const interval = parseInt(args.interval || "5", 10) * 1000;
      const timeout = parseInt(args.timeout || "120", 10) * 1000;
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const songs = await apiGet(`/api/get?ids=${ids}`);
        const allDone = songs.every(
          (s) => s.status === "streaming" || s.status === "complete"
        );
        const allError = songs.every((s) => s.status === "error");
        if (allDone || allError) {
          printJson(songs);
          return;
        }
        const statuses = songs.map((s) => `${s.id}: ${s.status}`).join(", ");
        console.error(`Waiting... ${statuses}`);
        await new Promise((r) => setTimeout(r, interval));
      }
      console.error("Timeout waiting for completion");
      process.exit(1);
    },
  },
};

function parseArgs(argv) {
  const args = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { args, positional };
}

function parseTimeToSeconds(time) {
  const parts = time.split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return 0;
}

function printHelp() {
  console.log(`suno-api CLI

Usage: suno-cli <command> [options]

Environment:
  SUNO_API_URL    API base URL (default: https://suno.prismosoft.com)
  SUNO_API_TOKEN  Bearer token (required)

Commands:`);
  for (const [name, cmd] of Object.entries(commands)) {
    console.log(`  ${name.padEnd(20)} ${cmd.desc}`);
  }
  console.log(`
Run 'suno-cli <command>' without args to see its options.
`);
}

const { args, positional } = parseArgs(process.argv.slice(2));
const commandName = positional[0];

if (!commandName || commandName === "help" || commandName === "--help" || commandName === "-h") {
  printHelp();
  process.exit(0);
}

const command = commands[commandName];
if (!command) {
  console.error(`Unknown command: ${commandName}`);
  printHelp();
  process.exit(1);
}

command.run(args).catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});