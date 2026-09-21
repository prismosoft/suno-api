import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

export type AudioTags = {
  title?: string;
  artist?: string;
  album?: string;
  album_artist?: string;
  label?: string;
  genre?: string;
  year?: string;
  copyright?: string;
  composer?: string;
  comment?: string;
  lyrics?: string;
  track?: string;
  isrc?: string;
};

export type CoverArt = { data: Buffer; mime: string };

// ---------- WAV: RIFF LIST/INFO + "id3 " chunk, audio bytes untouched ----------

function riffChunk(id: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.write(id, 0, 4, "latin1");
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body, body.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

function infoList(tags: AudioTags): Buffer {
  const map: [string, string | undefined][] = [
    ["INAM", tags.title],
    ["IART", tags.artist],
    ["IPRD", tags.album],
    ["IGNR", tags.genre],
    ["ICRD", tags.year],
    ["ICOP", tags.copyright],
    ["IMUS", tags.composer],
    ["ICMT", tags.comment],
    ["IPUB", tags.label],
    ["ITRK", tags.track],
    ["ISRC", tags.isrc]
  ];
  const subs = map
    .filter(([, v]) => v)
    .map(([id, v]) => riffChunk(id, Buffer.concat([Buffer.from(String(v), "utf8"), Buffer.alloc(1)])));
  return riffChunk("LIST", Buffer.concat([Buffer.from("INFO", "latin1"), ...subs]));
}

function synchsafe(n: number): Buffer {
  const b = Buffer.alloc(4);
  b[0] = (n >> 21) & 0x7f;
  b[1] = (n >> 14) & 0x7f;
  b[2] = (n >> 7) & 0x7f;
  b[3] = n & 0x7f;
  return b;
}

function id3Frame(id: string, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from(id, "latin1"), synchsafe(body.length), Buffer.alloc(2), body]);
}

const UTF8 = Buffer.from([3]);
const NUL = Buffer.alloc(1);

function textFrame(id: string, v?: string): Buffer | null {
  return v ? id3Frame(id, Buffer.concat([UTF8, Buffer.from(String(v), "utf8")])) : null;
}

/** ID3v2.4 tag (UTF-8 text frames). */
export function buildId3(tags: AudioTags, cover?: CoverArt): Buffer {
  const frames: (Buffer | null)[] = [
    textFrame("TIT2", tags.title),
    textFrame("TPE1", tags.artist),
    textFrame("TALB", tags.album),
    textFrame("TPE2", tags.album_artist),
    textFrame("TPUB", tags.label),
    textFrame("TCON", tags.genre),
    textFrame("TDRC", tags.year),
    textFrame("TCOP", tags.copyright),
    textFrame("TCOM", tags.composer),
    textFrame("TRCK", tags.track),
    textFrame("TSRC", tags.isrc)
  ];
  if (tags.comment) {
    frames.push(id3Frame("COMM", Buffer.concat([UTF8, Buffer.from("eng", "latin1"), NUL, Buffer.from(tags.comment, "utf8")])));
  }
  if (tags.lyrics) {
    frames.push(id3Frame("USLT", Buffer.concat([UTF8, Buffer.from("eng", "latin1"), NUL, Buffer.from(tags.lyrics, "utf8")])));
  }
  if (cover) {
    // picture type 3 = front cover
    frames.push(id3Frame("APIC", Buffer.concat([UTF8, Buffer.from(cover.mime, "latin1"), NUL, Buffer.from([3]), NUL, cover.data])));
  }
  const body = Buffer.concat(frames.filter((f): f is Buffer => !!f));
  return Buffer.concat([Buffer.from("ID3", "latin1"), Buffer.from([4, 0, 0]), synchsafe(body.length), body]);
}

/** Rewrites a WAV: keeps every chunk except existing LIST/INFO + id3, then appends fresh ones. */
export function tagWav(wav: Buffer, tags: AudioTags, cover?: CoverArt): Buffer {
  if (wav.toString("latin1", 0, 4) !== "RIFF" || wav.toString("latin1", 8, 12) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }
  const kept: Buffer[] = [];
  let off = 12;
  while (off + 8 <= wav.length) {
    const id = wav.toString("latin1", off, off + 4);
    let size = wav.readUInt32LE(off + 4);
    // some encoders write 0/garbage sizes for "data" — clamp to file end
    if (off + 8 + size > wav.length) size = wav.length - off - 8;
    const end = off + 8 + size + (size % 2);
    const isInfo = id === "LIST" && wav.toString("latin1", off + 8, off + 12) === "INFO";
    const isId3 = id.toLowerCase() === "id3 ";
    if (!isInfo && !isId3) kept.push(wav.subarray(off, Math.min(end, wav.length)));
    off = end;
  }
  const bodyParts = [Buffer.from("WAVE", "latin1"), ...kept, infoList(tags), riffChunk("id3 ", buildId3(tags, cover))];
  const body = Buffer.concat(bodyParts);
  const head = Buffer.alloc(8);
  head.write("RIFF", 0, 4, "latin1");
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

// ---------- M4A: ffmpeg, audio stream copied (no re-encode) ----------

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.slice(-800)}`))));
  });
}

function runOut(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.slice(-800)}`))));
  });
}

const FFMPEG = () => process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = () => process.env.FFPROBE_PATH || "ffprobe";

/** Front-cover art normalized to a 3000x3000 JPEG (release-spec size; JPEG instead of PNG keeps it ~1-3MB rather than ~13MB). */
export async function coverToJpeg(cover: CoverArt): Promise<CoverArt> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cover-"));
  try {
    const inC = path.join(dir, "in");
    const out = path.join(dir, "out.jpg");
    await fs.writeFile(inC, cover.data);
    await run(FFMPEG(), ["-hide_banner", "-y", "-i", inC, "-vf", "scale=3000:3000", "-q:v", "2", out]);
    return { data: await fs.readFile(out), mime: "image/jpeg" };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/**
 * Square cover art normalized to an exact pixel size.
 *
 * Release artwork has to be 3000x3000, and no image model on Runware renders that directly --
 * they cap total pixels well below it (Qwen-Image at 2048x2048, gpt-image at 2880x2880), so the
 * final size is always reached here rather than at generation time. Lanczos is used instead of
 * ffmpeg's default bicubic because this is usually an upscale and bicubic visibly softens edges
 * and lettering.
 */
export async function resizeCover(cover: CoverArt, size = 3000, format: "png" | "jpeg" = "png"): Promise<CoverArt> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cover-"));
  try {
    const inC = path.join(dir, "in");
    const out = path.join(dir, format === "png" ? "out.png" : "out.jpg");
    await fs.writeFile(inC, cover.data);
    const args = ["-hide_banner", "-y", "-i", inC, "-vf", `scale=${size}:${size}:flags=lanczos`];
    // Release artwork is opaque; keeping an alpha channel only inflates the PNG and risks
    // stores rejecting it. rgb24 is lossless here, just without the unused channel.
    if (format === "png") args.push("-pix_fmt", "rgb24");
    if (format === "jpeg") args.push("-q:v", "2");
    args.push(out);
    await run(FFMPEG(), args);
    return { data: await fs.readFile(out), mime: format === "png" ? "image/png" : "image/jpeg" };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export async function tagM4a(audio: Buffer, tags: AudioTags, cover?: CoverArt): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tag-"));
  try {
    const inA = path.join(dir, "in.m4a");
    const out = path.join(dir, "out.m4a");
    await fs.writeFile(inA, audio);
    // Suno's "m4a" is Opus-in-MP4, which the m4a (ipod) muxer and Apple players reject -> AAC 256k unless already AAC
    const codec = (await runOut(FFPROBE(), ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0", inA])).trim();
    const audioCodec = codec === "aac" ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "256k"];
    const args = ["-hide_banner", "-y", "-i", inA];
    if (cover) {
      const inC = path.join(dir, "cover.jpg");
      await fs.writeFile(inC, cover.data);
      args.push("-i", inC, "-map", "0:a", "-map", "1:v", ...audioCodec, "-c:v", "copy", "-disposition:v:0", "attached_pic");
    } else {
      args.push("-map", "0:a", ...audioCodec);
    }
    args.push("-map_metadata", "-1");
    const meta: [string, string | undefined][] = [
      ["title", tags.title],
      ["artist", tags.artist],
      ["album", tags.album],
      ["album_artist", tags.album_artist],
      ["genre", tags.genre],
      ["date", tags.year],
      ["copyright", tags.copyright],
      ["composer", tags.composer],
      ["comment", tags.comment],
      ["lyrics", tags.lyrics],
      ["track", tags.track]
    ];
    for (const [k, v] of meta) if (v) args.push("-metadata", `${k}=${v}`);
    args.push("-f", "ipod", out);
    await run(FFMPEG(), args);
    return await fs.readFile(out);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
