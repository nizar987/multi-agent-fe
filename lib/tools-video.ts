/**
 * Video tools — AI-driven editing built on ffmpeg/ffprobe (same REST-less
 * pattern as tools-github/tools-tavily: toolDefs + a dispatch function).
 *
 * - Binaries are NOT bundled: resolved from PATH + common install locations
 *   (packaged Electron apps don't inherit the shell PATH — same gotcha as
 *   mcp-grafana). Missing binary → friendly install hint.
 * - Executed via execFile with an args ARRAY (no shell → no injection).
 * - Relative paths resolve against the run's working directory (workspace
 *   working folder / agent working_dir), passed in by the runtime.
 * - Outputs never overwrite an existing file unless overwrite=true.
 * - video_transcribe sends the (compressed) audio to the ACTIVE AI
 *   connection's OpenAI-compatible /v1/audio/transcriptions endpoint
 *   (Whisper-style) and writes .srt/.vtt/.txt next to the video.
 */
import { execFile } from "child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import type { AiTool } from "./ai";
import { getConfig, getSecret } from "./config";
import { logger } from "./logger";

/* ---------------- binary resolution ---------------- */

const IS_WINDOWS = process.platform === "win32";

/** Common install locations — packaged apps don't inherit the shell PATH. */
const BIN_DIRS = IS_WINDOWS
  ? [
      "C:\\ffmpeg\\bin",
      "C:\\Program Files\\ffmpeg\\bin",
      path.join(process.env.LOCALAPPDATA ?? "", "Microsoft\\WinGet\\Links"),
      path.join(process.env.ProgramData ?? "", "chocolatey\\bin"),
    ].filter(Boolean)
  : ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/opt/local/bin", "/snap/bin"];

/** Executable file names to try, in order (Windows needs the extension). */
function binNames(name: "ffmpeg" | "ffprobe"): string[] {
  return IS_WINDOWS ? [`${name}.exe`, `${name}.com`, name] : [name];
}

/** Every directory to search: the common locations plus the real PATH. */
function searchDirs(): string[] {
  const fromPath = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  return [...BIN_DIRS, ...fromPath];
}

/** Absolute path of the binary, or the bare name so execFile can use PATH. */
export function resolveBin(name: "ffmpeg" | "ffprobe"): string {
  return findBin(name) ?? name;
}

function findBin(name: "ffmpeg" | "ffprobe"): string | null {
  for (const dir of searchDirs()) {
    for (const file of binNames(name)) {
      const p = path.join(dir, file);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/** True when ffmpeg is reachable — used by the tool-status page. */
export function ffmpegAvailable(): boolean {
  return findBin("ffmpeg") !== null;
}

const INSTALL_HINT =
  "ffmpeg was not found. Install it first — macOS: `brew install ffmpeg`, " +
  "Ubuntu/Debian: `sudo apt install ffmpeg`, Windows: `winget install ffmpeg` — then try again.";

function run(bin: "ffmpeg" | "ffprobe", args: string[], timeoutMs = 15 * 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      resolveBin(bin),
      args,
      { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") return reject(new Error(INSTALL_HINT));
          if ((err as any).killed) return reject(new Error(`${bin} timed out after ${Math.round(timeoutMs / 60000)} min.`));
          const tail = String(stderr || err.message).split("\n").filter(Boolean).slice(-8).join("\n");
          return reject(new Error(`${bin} failed:\n${tail}`));
        }
        resolve(String(stdout || stderr));
      }
    );
  });
}

/* ---------------- helpers ---------------- */

interface Ctx { cwd: string }

function resolvePath(cwd: string, p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(cwd, p);
}

function requireInput(cwd: string, p: unknown, field = "input"): string {
  const s = String(p ?? "").trim();
  if (!s) throw new Error(`"${field}" is required.`);
  const abs = resolvePath(cwd, s);
  if (!existsSync(abs)) throw new Error(`File not found: ${abs}`);
  return abs;
}

/** Default output path: <dir>/<base>_<suffix><ext> (never the input itself). */
function outPath(cwd: string, input: string, suffix: string, ext: string, requested?: unknown, overwrite?: boolean): string {
  let out: string;
  if (typeof requested === "string" && requested.trim()) {
    out = resolvePath(cwd, requested.trim());
  } else {
    const base = path.basename(input, path.extname(input));
    out = path.join(path.dirname(input), `${base}_${suffix}${ext}`);
  }
  if (path.resolve(out) === path.resolve(input)) throw new Error("Output must differ from the input file.");
  if (!overwrite && existsSync(out)) throw new Error(`Output already exists: ${out} — pass overwrite=true to replace it.`);
  return out;
}

const ov = (overwrite?: boolean) => (overwrite ? ["-y"] : ["-n"]);

function clip(s: string, max = 20_000): string {
  return s.length > max ? s.slice(0, max) + "\n… [truncated]" : s;
}

/**
 * Numeric option with a fallback. `Number(v) || fallback` would silently turn a
 * legitimate 0 (e.g. noise_db=0) into the default, so test for a finite number.
 */
function numOr(v: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  const n = Number(v);
  if (v === undefined || v === null || v === "" || !Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(n, max));
}

/* ---------------- tool definitions ---------------- */

const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });
const bool = (description: string) => ({ type: "boolean", description });

export const videoToolDefs: AiTool[] = [
  {
    name: "video_probe",
    description: "Inspect a video/audio file: duration, resolution, codecs, streams, bitrate (ffprobe). Always probe before editing.",
    input_schema: { type: "object", properties: { input: str("path to the media file") }, required: ["input"] },
  },
  {
    name: "video_trim",
    description: "Cut a section out of a video. Give start and end (or duration). Fast stream-copy by default; set reencode=true for frame-exact cuts.",
    input_schema: {
      type: "object",
      properties: {
        input: str("source video"),
        start: str("start time, e.g. '00:01:20' or '80'"),
        end: str("end time (same format); omit if duration is given"),
        duration: str("length of the cut, e.g. '45' or '00:00:45'"),
        output: str("output path (default: <input>_trim.<ext>)"),
        reencode: bool("re-encode for frame-exact cutting (slower). Default false"),
        overwrite: bool("replace the output if it exists. Default false"),
      },
      required: ["input", "start"],
    },
  },
  {
    name: "video_concat",
    description: "Join multiple videos into one, in order. Files should share codec/resolution (probe them first); otherwise transcode them to matching formats before concat.",
    input_schema: {
      type: "object",
      properties: {
        inputs: { type: "array", items: { type: "string" }, description: "video paths in playback order (min 2)" },
        output: str("output path"),
        overwrite: bool("replace the output if it exists. Default false"),
      },
      required: ["inputs", "output"],
    },
  },
  {
    name: "video_transcode",
    description: "Convert/resize/compress a video (H.264 + AAC). Use for changing resolution, shrinking file size (higher crf = smaller), changing fps or container.",
    input_schema: {
      type: "object",
      properties: {
        input: str("source video"),
        output: str("output path, extension decides the container (default: <input>_out.mp4)"),
        width: num("target width, e.g. 1280 (height auto, keeps aspect)"),
        height: num("target height, e.g. 720 (width auto)"),
        crf: num("quality 18–35 (default 23; 28+ = strong compression)"),
        fps: num("target frame rate"),
        no_audio: bool("strip the audio track"),
        overwrite: bool("replace the output if it exists. Default false"),
      },
      required: ["input"],
    },
  },
  {
    name: "video_extract_audio",
    description: "Extract the audio track of a video to mp3/m4a/wav.",
    input_schema: {
      type: "object",
      properties: {
        input: str("source video"),
        format: { type: "string", enum: ["mp3", "m4a", "wav"], description: "audio format (default mp3)" },
        output: str("output path (default: <input>.<format>)"),
        overwrite: bool("replace the output if it exists. Default false"),
      },
      required: ["input"],
    },
  },
  {
    name: "video_thumbnail",
    description: "Grab a still frame as a PNG image.",
    input_schema: {
      type: "object",
      properties: {
        input: str("source video"),
        time: str("timestamp of the frame, e.g. '00:00:05' (default: 1s in)"),
        output: str("output .png path (default: <input>_thumb.png)"),
        overwrite: bool("replace the output if it exists. Default false"),
      },
      required: ["input"],
    },
  },
  {
    name: "video_speed",
    description: "Speed a video up or slow it down (video + audio stay in sync). factor 2 = twice as fast, 0.5 = half speed.",
    input_schema: {
      type: "object",
      properties: {
        input: str("source video"),
        factor: num("speed multiplier, 0.5–4"),
        output: str("output path (default: <input>_speed.<ext>)"),
        overwrite: bool("replace the output if it exists. Default false"),
      },
      required: ["input", "factor"],
    },
  },
  {
    name: "video_remove_silence",
    description: "Remove silent parts from a video (jump-cut style, video and audio together).",
    input_schema: {
      type: "object",
      properties: {
        input: str("source video"),
        noise_db: num("silence threshold in dB below full scale (default 30 → -30dB)"),
        min_silence: num("minimum silence length in seconds to cut (default 0.7)"),
        output: str("output path (default: <input>_nosilence.<ext>)"),
        overwrite: bool("replace the output if it exists. Default false"),
      },
      required: ["input"],
    },
  },
  {
    name: "video_burn_subtitles",
    description: "Burn a subtitle file (.srt/.vtt/.ass) permanently into the video image (hardsubs).",
    input_schema: {
      type: "object",
      properties: {
        input: str("source video"),
        subtitles: str("subtitle file (.srt/.vtt/.ass) — create one with video_transcribe"),
        output: str("output path (default: <input>_subbed.mp4)"),
        overwrite: bool("replace the output if it exists. Default false"),
      },
      required: ["input", "subtitles"],
    },
  },
  {
    name: "video_transcribe",
    description:
      "Transcribe a video/audio file with an AI speech model (Whisper-compatible) and save subtitles/text next to it. " +
      "Needs the active AI connection to offer an OpenAI-format /audio/transcriptions endpoint.",
    input_schema: {
      type: "object",
      properties: {
        input: str("video or audio file"),
        format: { type: "string", enum: ["srt", "vtt", "txt"], description: "output format (default srt — ready for video_burn_subtitles)" },
        language: str("ISO language hint, e.g. 'id' or 'en' (optional)"),
        model: str("transcription model id (default 'whisper-1')"),
        output: str("output path (default: <input>.<format>)"),
        overwrite: bool("replace the output if it exists. Default false"),
      },
      required: ["input"],
    },
  },
];

/* ---------------- implementations ---------------- */

async function probe(ctx: Ctx, inp: any): Promise<string> {
  const input = requireInput(ctx.cwd, inp.input);
  const out = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration,size,bit_rate:stream=index,codec_type,codec_name,width,height,r_frame_rate,channels,sample_rate",
    "-of", "json", input,
  ]);
  return clip(`${input}\n${out}`);
}

async function trim(ctx: Ctx, inp: any): Promise<string> {
  const input = requireInput(ctx.cwd, inp.input);
  const ext = path.extname(input) || ".mp4";
  const output = outPath(ctx.cwd, input, "trim", ext, inp.output, inp.overwrite);
  const args = [...ov(inp.overwrite), "-ss", String(inp.start)];
  if (inp.end) args.push("-to", String(inp.end));
  else if (inp.duration) args.push("-t", String(inp.duration));
  args.push("-i", input);
  if (inp.reencode) args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac");
  else args.push("-c", "copy");
  args.push(output);
  await run("ffmpeg", args);
  return `Trimmed → ${output}`;
}

async function concat(ctx: Ctx, inp: any): Promise<string> {
  const list: string[] = Array.isArray(inp.inputs) ? inp.inputs : [];
  if (list.length < 2) throw new Error("Give at least 2 inputs.");
  const files = list.map((p) => requireInput(ctx.cwd, p, "inputs"));
  const output = outPath(ctx.cwd, files[0], "concat", path.extname(String(inp.output || files[0])) || ".mp4", inp.output, inp.overwrite);
  // concat demuxer needs a list file; escape single quotes in paths
  const listFile = path.join(tmpdir(), `concat_${Date.now()}.txt`);
  writeFileSync(listFile, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  try {
    await run("ffmpeg", [...ov(inp.overwrite), "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", output]);
  } catch (e) {
    // stream-copy concat fails on mismatched codecs — retry with re-encode
    await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-c:a", "aac", output]);
  } finally {
    try { unlinkSync(listFile); } catch { /* ignore */ }
  }
  return `Concatenated ${files.length} files → ${output}`;
}

async function transcode(ctx: Ctx, inp: any): Promise<string> {
  const input = requireInput(ctx.cwd, inp.input);
  const output = outPath(ctx.cwd, input, "out", inp.output ? path.extname(String(inp.output)) || ".mp4" : ".mp4", inp.output, inp.overwrite);
  const args = [...ov(inp.overwrite), "-i", input];
  // -2 = "keep the aspect ratio, round to an even number" for the missing side.
  const w = numOr(inp.width, -2, 2, 16384);
  const h = numOr(inp.height, -2, 2, 16384);
  if (w > 0 || h > 0) args.push("-vf", `scale=${w}:${h}`);
  args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", String(numOr(inp.crf, 23, 0, 51)));
  if (inp.fps !== undefined && inp.fps !== null) args.push("-r", String(numOr(inp.fps, 30, 1, 240)));
  if (inp.no_audio) args.push("-an");
  else args.push("-c:a", "aac");
  args.push(output);
  await run("ffmpeg", args);
  return `Transcoded → ${output}`;
}

async function extractAudio(ctx: Ctx, inp: any): Promise<string> {
  const input = requireInput(ctx.cwd, inp.input);
  const format = ["mp3", "m4a", "wav"].includes(inp.format) ? inp.format : "mp3";
  const output = outPath(ctx.cwd, input, "audio", `.${format}`, inp.output, inp.overwrite);
  const codec = format === "mp3" ? ["-c:a", "libmp3lame", "-q:a", "3"] : format === "m4a" ? ["-c:a", "aac"] : ["-c:a", "pcm_s16le"];
  await run("ffmpeg", [...ov(inp.overwrite), "-i", input, "-vn", ...codec, output]);
  return `Audio extracted → ${output}`;
}

async function thumbnail(ctx: Ctx, inp: any): Promise<string> {
  const input = requireInput(ctx.cwd, inp.input);
  const output = outPath(ctx.cwd, input, "thumb", ".png", inp.output, inp.overwrite);
  await run("ffmpeg", [...ov(inp.overwrite), "-ss", String(inp.time || "00:00:01"), "-i", input, "-frames:v", "1", output]);
  return `Frame saved → ${output}`;
}

async function speed(ctx: Ctx, inp: any): Promise<string> {
  const input = requireInput(ctx.cwd, inp.input);
  const factor = Number(inp.factor);
  if (!Number.isFinite(factor) || factor < 0.25 || factor > 4) throw new Error("factor must be between 0.25 and 4.");
  const ext = path.extname(input) || ".mp4";
  const output = outPath(ctx.cwd, input, "speed", ext, inp.output, inp.overwrite);
  // atempo supports 0.5–2 per filter; chain two for the full 0.25–4 range
  const atempo = factor >= 0.5 && factor <= 2
    ? `atempo=${factor}`
    : `atempo=${Math.sqrt(factor)},atempo=${Math.sqrt(factor)}`;
  await run("ffmpeg", [
    ...ov(inp.overwrite), "-i", input,
    "-filter_complex", `[0:v]setpts=PTS/${factor}[v];[0:a]${atempo}[a]`,
    "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-c:a", "aac", output,
  ]);
  return `Speed ×${factor} → ${output}`;
}

async function removeSilence(ctx: Ctx, inp: any): Promise<string> {
  const input = requireInput(ctx.cwd, inp.input);
  const db = numOr(inp.noise_db, 30, 0, 100);
  const minSil = numOr(inp.min_silence, 0.7, 0.05, 60);
  const ext = path.extname(input) || ".mp4";
  const output = outPath(ctx.cwd, input, "nosilence", ext, inp.output, inp.overwrite);
  // Detect silences, then keep the non-silent segments via select/aselect.
  const det = await run("ffmpeg", ["-i", input, "-af", `silencedetect=noise=-${db}dB:d=${minSil}`, "-f", "null", "-"]);
  const starts = [...det.matchAll(/silence_start: ([\d.]+)/g)].map((m) => parseFloat(m[1]));
  const ends = [...det.matchAll(/silence_end: ([\d.]+)/g)].map((m) => parseFloat(m[1]));
  if (starts.length === 0) return `No silences ≥${minSil}s below -${db}dB found — nothing to cut. (${input})`;
  // Build keep-intervals between silences.
  const keeps: Array<[number, number | null]> = [];
  let cursor = 0;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] > cursor + 0.05) keeps.push([cursor, starts[i]]);
    cursor = ends[i] ?? cursor;
  }
  keeps.push([cursor, null]); // tail to EOF
  const expr = keeps.map(([a, b]) => (b === null ? `gte(t,${a.toFixed(3)})` : `between(t,${a.toFixed(3)},${b.toFixed(3)})`)).join("+");
  await run("ffmpeg", [
    ...ov(inp.overwrite), "-i", input,
    "-vf", `select='${expr}',setpts=N/FRAME_RATE/TB`,
    "-af", `aselect='${expr}',asetpts=N/SR/TB`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-c:a", "aac", output,
  ]);
  return `Removed ${starts.length} silent section(s) → ${output}`;
}

async function burnSubtitles(ctx: Ctx, inp: any): Promise<string> {
  const input = requireInput(ctx.cwd, inp.input);
  const subs = requireInput(ctx.cwd, inp.subtitles, "subtitles");
  const output = outPath(ctx.cwd, input, "subbed", ".mp4", inp.output, inp.overwrite);
  // The subtitles filter parses its argument — escape the troublemakers.
  const escaped = subs.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
  await run("ffmpeg", [
    ...ov(inp.overwrite), "-i", input,
    "-vf", `subtitles='${escaped}'`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-c:a", "copy", output,
  ]);
  return `Subtitles burned in → ${output}`;
}

/* ---------------- transcription (Whisper-compatible API) ---------------- */

function transcriptionUrl(): string {
  const base = getConfig().ai.baseUrl.replace(/\/+$/, "");
  return /\/v1$/.test(base) ? `${base}/audio/transcriptions` : `${base}/v1/audio/transcriptions`;
}

async function transcribe(ctx: Ctx, inp: any): Promise<string> {
  const input = requireInput(ctx.cwd, inp.input);
  const format = ["srt", "vtt", "txt"].includes(inp.format) ? inp.format : "srt";
  const output = outPath(ctx.cwd, input, "transcript", `.${format}`, inp.output, inp.overwrite);
  const apiKey = getSecret("aiApiKey");
  if (!apiKey) throw new Error("No AI API key configured.");

  // Shrink the audio first: mono 16 kHz mp3 keeps uploads small (API limits ~25 MB).
  const tmp = path.join(tmpdir(), `transcribe_${Date.now()}.mp3`);
  await run("ffmpeg", ["-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", tmp]);

  try {
    const buf = readFileSync(tmp);
    if (buf.length > 24 * 1024 * 1024) {
      throw new Error("Audio is over ~24 MB even after compression — trim the video into parts first (video_trim), then transcribe each part.");
    }
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buf)], { type: "audio/mpeg" }), "audio.mp3");
    form.append("model", String(inp.model || "whisper-1"));
    form.append("response_format", format === "txt" ? "text" : format);
    if (inp.language) form.append("language", String(inp.language));

    const resp = await fetch(transcriptionUrl(), {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const text = await resp.text();
    if (!resp.ok) {
      const hint = resp.status === 404
        ? " The active AI connection has no /audio/transcriptions endpoint — switch the active AI connection to an OpenAI-compatible provider that offers Whisper (e.g. OpenAI or Groq) and retry."
        : "";
      throw new Error(`Transcription failed (HTTP ${resp.status}): ${text.slice(0, 300)}${hint}`);
    }
    writeFileSync(output, text);
    logger.info(`video_transcribe: ${input} → ${output} (${text.length} chars)`);
    return clip(`Transcript saved → ${output}\n\n${text}`, 8000);
  } finally {
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }
}

/* ---------------- dispatch ---------------- */

export async function callVideoTool(name: string, input: unknown, cwd: string): Promise<string> {
  const inp: any = input ?? {};
  const ctx: Ctx = { cwd };
  switch (name) {
    case "video_probe": return probe(ctx, inp);
    case "video_trim": return trim(ctx, inp);
    case "video_concat": return concat(ctx, inp);
    case "video_transcode": return transcode(ctx, inp);
    case "video_extract_audio": return extractAudio(ctx, inp);
    case "video_thumbnail": return thumbnail(ctx, inp);
    case "video_speed": return speed(ctx, inp);
    case "video_remove_silence": return removeSilence(ctx, inp);
    case "video_burn_subtitles": return burnSubtitles(ctx, inp);
    case "video_transcribe": return transcribe(ctx, inp);
    default: throw new Error(`Unknown video tool: ${name}`);
  }
}
