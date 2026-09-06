#!/usr/bin/env node

import { program } from "commander";
import prompts from "prompts";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8"));

// Auto-load env files: ~/.suno-cli.env, then ./.env (in order, latter wins)
function loadEnvFiles() {
  const envPaths = [
    join(homedir(), ".suno-cli.env"),
    join(process.cwd(), ".env"),
  ];
  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, "utf8");
      for (const line of content.split("\n")) {
        const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s#]+))/);
        if (match) {
          const key = match[1];
          const value = match[2] ?? match[3] ?? match[4] ?? "";
          if (!process.env[key]) process.env[key] = value;
        }
      }
    }
  }
}

loadEnvFiles();

// Map API_BEARER_TOKEN (app .env) to SUNO_API_TOKEN (CLI env) if not already set
if (!process.env.SUNO_API_TOKEN && process.env.API_BEARER_TOKEN) {
  process.env.SUNO_API_TOKEN = process.env.API_BEARER_TOKEN;
}

function getConfig() {
  const apiUrl = process.env.SUNO_API_URL || "https://suno.prismosoft.com";
  const apiToken = process.env.SUNO_API_TOKEN;
  return { apiUrl, apiToken };
}

function getHeaders(token) {
  if (!token) {
    console.error("Error: SUNO_API_TOKEN environment variable is required.");
    console.error("Set it to your API_BEARER_TOKEN value:");
    console.error('  export SUNO_API_TOKEN="your-token-here"');
    console.error("\nOr run 'suno-cli interactive' to configure it.");
    process.exit(1);
  }
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

async function apiGet(path) {
  const { apiUrl, apiToken } = getConfig();
  const res = await fetch(`${apiUrl}${path}`, { headers: getHeaders(apiToken) });
  const data = await res.json();
  if (!res.ok) {
    console.error(`Error ${res.status}:`, data.error || data);
    process.exit(1);
  }
  return data;
}

async function apiPost(path, body) {
  const { apiUrl, apiToken } = getConfig();
  const res = await fetch(`${apiUrl}${path}`, {
    method: "POST",
    headers: getHeaders(apiToken),
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

function parseTimeToSeconds(time) {
  const parts = time.split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return 0;
}

let configConfirmed = false;

async function confirmConfig() {
  if (configConfirmed) return getConfig();

  const { apiUrl, apiToken } = getConfig();

  if (apiToken) {
    const choice = await prompts({
      type: "select",
      name: "value",
      message: `API token detected. Continue with current config?`,
      choices: [
        { title: `Yes, use current settings (${apiUrl})`, value: "use" },
        { title: "Reconfigure (enter new URL + token)", value: "reconfigure" },
      ],
    });
    if (choice.value === "use") {
      configConfirmed = true;
      return { apiUrl, apiToken };
    }
  } else {
    console.log("Welcome to suno-cli! No API token detected.\n");
  }

  const response = await prompts([
    {
      type: "text",
      name: "url",
      message: "API URL",
      initial: apiUrl || "https://suno.prismosoft.com",
    },
    {
      type: "password",
      name: "token",
      message: "API Bearer Token",
    },
  ]);

  if (!response.token) {
    console.error("Token is required.");
    process.exit(1);
  }

  process.env.SUNO_API_URL = response.url;
  process.env.SUNO_API_TOKEN = response.token;

  const localEnvPath = join(process.cwd(), ".env");
  const homeEnvPath = join(homedir(), ".suno-cli.env");
  const localEnvExists = existsSync(localEnvPath);

  const save = await prompts({
    type: "select",
    name: "value",
    message: "Where should I save these?",
    choices: [
      ...(localEnvExists
        ? [{ title: `Update ./.env (API_BEARER_TOKEN + SUNO_API_URL)`, value: "local" }]
        : [{ title: `Create ./.env (API_BEARER_TOKEN + SUNO_API_URL)`, value: "local" }]),
      { title: "Save to ~/.suno-cli.env (SUNO_API_URL + SUNO_API_TOKEN)", value: "home" },
      { title: "Save to both", value: "both" },
      { title: "Don't save — use this session only", value: "none" },
    ],
  });

  function updateLocalEnv(url, token) {
    let lines = [];
    if (existsSync(localEnvPath)) {
      lines = readFileSync(localEnvPath, "utf8").split("\n");
    }
    let foundUrl = false;
    let foundToken = false;
    lines = lines.map((line) => {
      if (/^\s*(?:export\s+)?SUNO_API_URL\s*=/.test(line)) {
        foundUrl = true;
        return `SUNO_API_URL="${url}"`;
      }
      if (/^\s*(?:export\s+)?API_BEARER_TOKEN\s*=/.test(line)) {
        foundToken = true;
        return `API_BEARER_TOKEN="${token}"`;
      }
      return line;
    });
    if (!foundUrl) lines.push(`SUNO_API_URL="${url}"`);
    if (!foundToken) lines.push(`API_BEARER_TOKEN="${token}"`);
    writeFileSync(localEnvPath, lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n");
  }

  function updateHomeEnv(url, token) {
    writeFileSync(
      homeEnvPath,
      `export SUNO_API_URL="${url}"\nexport SUNO_API_TOKEN="${token}"\n`
    );
  }

  if (save.value === "local" || save.value === "both") {
    updateLocalEnv(response.url, response.token);
    console.log(`\n  Updated ${localEnvPath}`);
  }
  if (save.value === "home" || save.value === "both") {
    updateHomeEnv(response.url, response.token);
    console.log(`\n  Updated ${homeEnvPath}`);
    console.log("  Add this to your shell profile if not already loading it:");
    console.log(`  [ -f ~/.suno-cli.env ] && source ~/.suno-cli.env`);
  }
  if (save.value === "none") {
    console.log("\n  Using for this session only.");
  }
  console.log("");

  configConfirmed = true;
  return { apiUrl: response.url, apiToken: response.token };
}

// ─── Commands ──────────────────────────────────────────────────────────────

program
  .name("suno-cli")
  .description("CLI for the Suno API — generate music, lyrics, and stems")
  .version(pkg.version)
  .option("-y, --yes", "Skip all confirmations — non-interactive mode for agents/scripts")
  .hook("preAction", async (thisCommand) => {
    if (thisCommand.opts().yes) configConfirmed = true;
  });

// limit
program
  .command("limit")
  .description("Get credit/quota info")
  .action(async () => {
    await confirmConfig();
    const data = await apiGet("/api/get_limit");
    printJson(data);
  });

// generate
program
  .command("generate")
  .description("Generate music from a text prompt")
  .option("-p, --prompt <text>", "Text prompt describing the music")
  .option("-i, --instrumental", "Generate instrumental only (no vocals)")
  .option("-m, --model <model>", "Model name (default: chirp-v3-5)")
  .option("-w, --wait", "Wait for audio to finish generating")
  .action(async (opts) => {
    await confirmConfig();
    let prompt = opts.prompt;
    if (!prompt) {
      const response = await prompts({
        type: "text",
        name: "value",
        message: "Describe the music you want to generate:",
      });
      prompt = response.value;
    }
    if (!prompt) {
      console.error("Prompt is required.");
      process.exit(1);
    }
    const payload = {
      prompt,
      make_instrumental: !!opts.instrumental,
      model: opts.model || undefined,
      wait_audio: !!opts.wait,
    };
    const data = await apiPost("/api/generate", payload);
    printJson(data);
  });

// custom-generate
program
  .command("custom-generate")
  .description("Generate music with custom mode (lyrics, style, title)")
  .option("-p, --prompt <lyrics>", "Lyrics text")
  .option("-t, --tags <style>", "Music style/genre tags")
  .option("--title <title>", "Song title")
  .option("-i, --instrumental", "Instrumental only")
  .option("-m, --model <model>", "Model name")
  .option("-w, --wait", "Wait for audio to finish")
  .option("--negative-tags <tags>", "Tags to avoid")
  .action(async (opts) => {
    await confirmConfig();
    let prompt = opts.prompt;
    let tags = opts.tags;
    let title = opts.title;
    if (!prompt || !tags) {
      const questions = [];
      if (!prompt) questions.push({
        type: "text",
        name: "prompt",
        message: "Enter lyrics:",
      });
      if (!tags) questions.push({
        type: "text",
        name: "tags",
        message: "Music style/genre:",
      });
      if (!title) questions.push({
        type: "text",
        name: "title",
        message: "Song title (optional):",
      });
      const response = await prompts(questions);
      prompt = prompt || response.prompt;
      tags = tags || response.tags;
      title = title || response.title;
    }
    const payload = {
      prompt,
      tags: tags || "",
      title: title || "",
      make_instrumental: !!opts.instrumental,
      model: opts.model || undefined,
      wait_audio: !!opts.wait,
      negative_tags: opts.negativeTags || undefined,
    };
    const data = await apiPost("/api/custom_generate", payload);
    printJson(data);
  });

// lyrics
program
  .command("lyrics")
  .description("Generate lyrics from a prompt")
  .option("-p, --prompt <text>", "Prompt for lyric generation")
  .action(async (opts) => {
    await confirmConfig();
    let prompt = opts.prompt;
    if (!prompt) {
      const response = await prompts({
        type: "text",
        name: "value",
        message: "What should the lyrics be about?",
      });
      prompt = response.value;
    }
    if (!prompt) {
      console.error("Prompt is required.");
      process.exit(1);
    }
    const data = await apiPost("/api/generate_lyrics", { prompt });
    printJson(data);
  });

// extend
program
  .command("extend")
  .description("Extend an existing audio clip")
  .option("-i, --id <audio_id>", "Audio clip ID to extend")
  .option("-p, --prompt <text>", "Prompt for the extension")
  .option("-c, --continue-at <mm:ss>", "Continue from this timestamp")
  .option("-t, --tags <style>", "Music style/genre")
  .option("--title <title>", "Song title")
  .option("-m, --model <model>", "Model name")
  .option("-w, --wait", "Wait for audio to finish")
  .action(async (opts) => {
    await confirmConfig();
    let id = opts.id;
    if (!id) {
      const response = await prompts({
        type: "text",
        name: "value",
        message: "Audio clip ID to extend:",
      });
      id = response.value;
    }
    if (!id) {
      console.error("Audio ID is required.");
      process.exit(1);
    }
    const continueAt = opts.continueAt ? parseTimeToSeconds(opts.continueAt) : 0;
    const payload = {
      audio_id: id,
      prompt: opts.prompt || "",
      continue_at: continueAt,
      tags: opts.tags || "",
      negative_tags: "",
      title: opts.title || "",
      model: opts.model || undefined,
      wait_audio: !!opts.wait,
    };
    const data = await apiPost("/api/extend_audio", payload);
    printJson(data);
  });

// stems
program
  .command("stems")
  .description("Generate stem tracks (separate vocals and music)")
  .option("-i, --id <audio_id>", "Audio clip ID")
  .action(async (opts) => {
    await confirmConfig();
    let id = opts.id;
    if (!id) {
      const response = await prompts({
        type: "text",
        name: "value",
        message: "Audio clip ID:",
      });
      id = response.value;
    }
    if (!id) {
      console.error("Audio ID is required.");
      process.exit(1);
    }
    const data = await apiPost("/api/generate_stems", { audio_id: id });
    printJson(data);
  });

// concat
program
  .command("concat")
  .description("Generate the whole song from extensions")
  .option("-i, --id <clip_id>", "Clip ID to concatenate")
  .action(async (opts) => {
    await confirmConfig();
    let id = opts.id;
    if (!id) {
      const response = await prompts({
        type: "text",
        name: "value",
        message: "Clip ID to concatenate:",
      });
      id = response.value;
    }
    if (!id) {
      console.error("Clip ID is required.");
      process.exit(1);
    }
    const data = await apiPost("/api/concat", { clip_id: id });
    printJson(data);
  });

// get
program
  .command("get")
  .description("Get music info by IDs, or all music if no IDs")
  .option("-i, --ids <id1,id2,...>", "Comma-separated song IDs")
  .option("--page <page>", "Page number")
  .action(async (opts) => {
    await confirmConfig();
    const ids = opts.ids ? `?ids=${opts.ids}` : "";
    const page = opts.page ? `${ids ? "&" : "?"}page=${opts.page}` : "";
    const data = await apiGet(`/api/get${ids}${page}`);
    printJson(data);
  });

// clip
program
  .command("clip")
  .description("Get clip information by ID")
  .option("-i, --id <clip_id>", "Clip ID")
  .action(async (opts) => {
    await confirmConfig();
    let id = opts.id;
    if (!id) {
      const response = await prompts({
        type: "text",
        name: "value",
        message: "Clip ID:",
      });
      id = response.value;
    }
    if (!id) {
      console.error("Clip ID is required.");
      process.exit(1);
    }
    const data = await apiGet(`/api/clip?id=${id}`);
    printJson(data);
  });

// aligned-lyrics
program
  .command("aligned-lyrics")
  .description("Get word-level timestamps for lyrics")
  .option("-i, --id <song_id>", "Song ID")
  .action(async (opts) => {
    await confirmConfig();
    let id = opts.id;
    if (!id) {
      const response = await prompts({
        type: "text",
        name: "value",
        message: "Song ID:",
      });
      id = response.value;
    }
    if (!id) {
      console.error("Song ID is required.");
      process.exit(1);
    }
    const data = await apiGet(`/api/get_aligned_lyrics?song_id=${id}`);
    printJson(data);
  });

// persona
program
  .command("persona")
  .description("Get persona info by ID")
  .option("-i, --id <persona_id>", "Persona ID")
  .option("--page <page>", "Page number")
  .action(async (opts) => {
    await confirmConfig();
    let id = opts.id;
    if (!id) {
      const response = await prompts({
        type: "text",
        name: "value",
        message: "Persona ID:",
      });
      id = response.value;
    }
    if (!id) {
      console.error("Persona ID is required.");
      process.exit(1);
    }
    const page = opts.page ? `&page=${opts.page}` : "";
    const data = await apiGet(`/api/persona?id=${id}${page}`);
    printJson(data);
  });

// chat (OpenAI-compatible)
program
  .command("chat")
  .description("OpenAI-compatible chat completions endpoint")
  .option("-m, --messages <json>", "JSON array of messages")
  .option("--model <model>", "Model name (default: suno)")
  .option("--stream", "Stream response")
  .action(async (opts) => {
    await confirmConfig();
    let messages = opts.messages;
    if (!messages) {
      const response = await prompts({
        type: "text",
        name: "value",
        message: "Message content:",
      });
      messages = JSON.stringify([{ role: "user", content: response.value }]);
    }
    if (typeof messages === "string") {
      messages = JSON.parse(messages);
    }
    const payload = {
      model: opts.model || "suno",
      messages,
      stream: !!opts.stream,
    };
    const data = await apiPost("/v1/chat/completions", payload);
    printJson(data);
  });

// wait
program
  .command("wait")
  .description("Poll for song completion by IDs")
  .option("-i, --ids <id1,id2,...>", "Comma-separated song IDs")
  .option("--interval <seconds>", "Poll interval in seconds", "5")
  .option("--timeout <seconds>", "Timeout in seconds", "120")
  .action(async (opts) => {
    await confirmConfig();
    let ids = opts.ids;
    if (!ids) {
      const response = await prompts({
        type: "text",
        name: "value",
        message: "Song IDs (comma-separated):",
      });
      ids = response.value;
    }
    if (!ids) {
      console.error("IDs are required.");
      process.exit(1);
    }
    const interval = parseInt(opts.interval, 10) * 1000;
    const timeout = parseInt(opts.timeout, 10) * 1000;
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
  });

// interactive
program
  .command("interactive")
  .description("Interactive mode — guided menu for all commands")
  .action(async () => {
    await confirmConfig();

    const { apiUrl, apiToken } = getConfig();
    console.log(`\nSuno CLI Interactive Mode`);
    console.log(`API: ${apiUrl}\n`);

    let running = true;
    while (running) {
      const response = await prompts({
        type: "select",
        name: "action",
        message: "What would you like to do?",
        choices: [
          { title: "Generate music from prompt", value: "generate" },
          { title: "Custom generate (lyrics, style, title)", value: "custom" },
          { title: "Generate lyrics", value: "lyrics" },
          { title: "Extend audio", value: "extend" },
          { title: "Generate stems", value: "stems" },
          { title: "Concatenate (full song)", value: "concat" },
          { title: "Get music info", value: "get" },
          { title: "Get clip info", value: "clip" },
          { title: "Get aligned lyrics", value: "aligned" },
          { title: "Get credit/quota info", value: "limit" },
          { title: "Wait for song completion", value: "wait" },
          { title: "Exit", value: "exit" },
        ],
      });

      switch (response.action) {
        case "generate": {
          const r = await prompts([
            { type: "text", name: "prompt", message: "Describe the music:" },
            { type: "confirm", name: "instrumental", message: "Instrumental only?", initial: false },
            { type: "confirm", name: "wait", message: "Wait for completion?", initial: false },
          ]);
          const data = await apiPost("/api/generate", {
            prompt: r.prompt,
            make_instrumental: r.instrumental,
            wait_audio: r.wait,
          });
          printJson(data);
          break;
        }
        case "custom": {
          const r = await prompts([
            { type: "text", name: "prompt", message: "Enter lyrics:" },
            { type: "text", name: "tags", message: "Music style/genre:" },
            { type: "text", name: "title", message: "Song title:" },
            { type: "confirm", name: "instrumental", message: "Instrumental only?", initial: false },
            { type: "confirm", name: "wait", message: "Wait for completion?", initial: false },
          ]);
          const data = await apiPost("/api/custom_generate", {
            prompt: r.prompt,
            tags: r.tags,
            title: r.title,
            make_instrumental: r.instrumental,
            wait_audio: r.wait,
          });
          printJson(data);
          break;
        }
        case "lyrics": {
          const r = await prompts({ type: "text", name: "prompt", message: "What should the lyrics be about?" });
          const data = await apiPost("/api/generate_lyrics", { prompt: r.prompt });
          printJson(data);
          break;
        }
        case "extend": {
          const r = await prompts([
            { type: "text", name: "id", message: "Audio clip ID to extend:" },
            { type: "text", name: "prompt", message: "Extension prompt (optional):" },
            { type: "text", name: "continueAt", message: "Continue from (mm:ss, blank=end):" },
            { type: "text", name: "tags", message: "Music style (optional):" },
          ]);
          const data = await apiPost("/api/extend_audio", {
            audio_id: r.id,
            prompt: r.prompt || "",
            continue_at: r.continueAt ? parseTimeToSeconds(r.continueAt) : 0,
            tags: r.tags || "",
            negative_tags: "",
            title: "",
          });
          printJson(data);
          break;
        }
        case "stems": {
          const r = await prompts({ type: "text", name: "id", message: "Audio clip ID:" });
          const data = await apiPost("/api/generate_stems", { audio_id: r.id });
          printJson(data);
          break;
        }
        case "concat": {
          const r = await prompts({ type: "text", name: "id", message: "Clip ID:" });
          const data = await apiPost("/api/concat", { clip_id: r.id });
          printJson(data);
          break;
        }
        case "get": {
          const r = await prompts({ type: "text", name: "ids", message: "Song IDs (comma-separated, blank=all):" });
          const ids = r.ids ? `?ids=${r.ids}` : "";
          const data = await apiGet(`/api/get${ids}`);
          printJson(data);
          break;
        }
        case "clip": {
          const r = await prompts({ type: "text", name: "id", message: "Clip ID:" });
          const data = await apiGet(`/api/clip?id=${r.id}`);
          printJson(data);
          break;
        }
        case "aligned": {
          const r = await prompts({ type: "text", name: "id", message: "Song ID:" });
          const data = await apiGet(`/api/get_aligned_lyrics?song_id=${r.id}`);
          printJson(data);
          break;
        }
        case "limit": {
          const data = await apiGet("/api/get_limit");
          printJson(data);
          break;
        }
        case "wait": {
          const r = await prompts([
            { type: "text", name: "ids", message: "Song IDs (comma-separated):" },
            { type: "number", name: "interval", message: "Poll interval (seconds):", initial: 5 },
            { type: "number", name: "timeout", message: "Timeout (seconds):", initial: 120 },
          ]);
          const interval = r.interval * 1000;
          const timeout = r.timeout * 1000;
          const start = Date.now();
          while (Date.now() - start < timeout) {
            const songs = await apiGet(`/api/get?ids=${r.ids}`);
            const allDone = songs.every((s) => s.status === "streaming" || s.status === "complete");
            const allError = songs.every((s) => s.status === "error");
            if (allDone || allError) {
              printJson(songs);
              break;
            }
            const statuses = songs.map((s) => `${s.id}: ${s.status}`).join(", ");
            console.error(`Waiting... ${statuses}`);
            await new Promise((res) => setTimeout(res, interval));
          }
          break;
        }
        case "exit":
          running = false;
          break;
      }
      console.log("");
    }
  });

// skills install
program
  .command("skills:install [dir]")
  .description("Install agent skill files into a project directory (default: ./.agents/skills)")
  .option("--force", "Overwrite existing files")
  .action(async (targetDir, opts) => {
    const { existsSync, mkdirSync, copyFileSync, rmSync } = await import("fs");
    const { homedir } = await import("os");
    const target = targetDir || join(process.cwd(), ".agents", "skills", "suno-cli");
    const skillsDir = join(__dirname, "skills");

    if (existsSync(target) && !opts.force) {
      console.error(`Target already exists: ${target}`);
      console.error("Use --force to overwrite.");
      process.exit(1);
    }

    if (existsSync(target) && opts.force) {
      rmSync(target, { recursive: true });
    }

    mkdirSync(target, { recursive: true });
    mkdirSync(join(target, "scripts"), { recursive: true });

    // Copy skill files
    const skillSource = join(skillsDir, "SKILL.md");
    const scriptSource = join(skillsDir, "scripts", "suno-wrapper.sh");
    const envSource = join(skillsDir, "suno-env.example");

    copyFileSync(skillSource, join(target, "SKILL.md"));
    if (existsSync(scriptSource)) copyFileSync(scriptSource, join(target, "scripts", "suno-wrapper.sh"));
    if (existsSync(envSource)) copyFileSync(envSource, join(target, "suno-env.example"));

    console.log(`\nSkill files installed to: ${target}\n`);
    console.log("Files:");
    console.log(`  ${target}/SKILL.md`);
    console.log(`  ${target}/suno-env.example`);
    if (existsSync(scriptSource)) console.log(`  ${target}/scripts/suno-wrapper.sh`);
    console.log("\nMake sure SUNO_API_URL and SUNO_API_TOKEN are set in your environment.");
    console.log("See suno-env.example for reference.\n");
  });

program.parse();