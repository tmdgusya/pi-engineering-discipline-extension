import { basename, resolve } from "path";

export function isSensitiveEnvPath(inputPath: string, cwd: string): boolean {
  const resolved = resolve(cwd, inputPath);
  const name = basename(resolved);
  return name === ".env" || name.startsWith(".env.");
}
