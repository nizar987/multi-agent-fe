/**
 * .env reader tool — lets an agent read environment files from the
 * allowed working folder. Sensitive: contents are sent to the AI model,
 * so every read is approval-gated (unless the user picked Act mode).
 */
import fs from "fs";
import path from "path";
import { AiTool } from "./ai";
import { shellCwd } from "./shell";

const MAX_SIZE = 16 * 1024; // 16 KB

export const envToolDefs: AiTool[] = [
  {
    name: "read_env",
    description:
      "Read an environment file (.env, .env.local, …) from the allowed working folder. " +
      "The file contents may include secrets, so the user must approve each read.",
    input_schema: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          description: 'env file name, e.g. ".env" or ".env.local" (default ".env")',
        },
      },
    },
  },
];

/** Validate the requested name: .env / .env.* only, no path traversal. */
export function resolveEnvPath(filename?: string): string {
  const name = (filename ?? ".env").trim();
  if (!/^\.env(\.[A-Za-z0-9._-]+)?$/.test(name)) {
    throw new Error(`Invalid env file name "${name}" — only .env or .env.* is allowed.`);
  }
  return path.join(shellCwd(), name);
}

export async function callEnvTool(name: string, input: unknown): Promise<string> {
  if (name !== "read_env") throw new Error("Unknown env tool.");
  const filePath = resolveEnvPath((input as { filename?: string })?.filename);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw new Error(`File not found: ${filePath}`);
  }
  if (!stat.isFile()) throw new Error(`${filePath} is not a file.`);
  if (stat.size > MAX_SIZE) throw new Error(`File is too large (${stat.size} bytes, max ${MAX_SIZE}).`);
  const content = fs.readFileSync(filePath, "utf8");
  return `# ${filePath}\n${content}`;
}
