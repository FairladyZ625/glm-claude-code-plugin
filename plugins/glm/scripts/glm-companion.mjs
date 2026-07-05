#!/usr/bin/env node

import { spawn, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_MODEL = "GLM-5.2[1m]";
const STATE_DIR = path.join(os.homedir(), ".claude", "glm-scale", "jobs");
const SCRIPT_PATH = fileURLToPath(import.meta.url);

function nowIso() {
  return new Date().toISOString();
}

function fail(message) {
  process.stderr.write(`[glm-scale] ${message}\n`);
  process.exit(1);
}

function commandAvailable(command, args = ["--version"]) {
  try {
    const output = execFileSync(command, args, {
      encoding: "utf8",
      timeout: 8000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return { available: true, output: output.split(/\r?\n/)[0] || "" };
  } catch (error) {
    return { available: false, error: error.message };
  }
}

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
}

function jobPath(jobId, file = "job.json") {
  return path.join(STATE_DIR, jobId, file);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
}

function updateJob(jobId, patch) {
  const file = jobPath(jobId);
  const job = readJson(file);
  const next = { ...job, ...patch, updatedAt: nowIso() };
  writeJson(file, next);
  return next;
}

function append(file, text) {
  fs.appendFileSync(file, text);
}

function firstEnv(names, env = process.env) {
  for (const name of names) {
    const value = env[name];
    if (value) return value;
  }
  return "";
}

function tokenLabel(value) {
  if (!value) return "missing";
  const tail = value.slice(-6);
  const hash = crypto.createHash("sha256").update(value).digest("hex").slice(0, 10);
  return `set tail=${tail} sha256=${hash}`;
}

function loadZshGlmEnv() {
  try {
    const out = execFileSync(
      "zsh",
      [
        "-lc",
        "source ~/.zshrc >/dev/null 2>&1; printf '%s\\0%s\\0%s' \"$ANTHROPIC_GLM_BASE_URL\" \"$ANTHROPIC_GLM_AUTH_TOKEN\" \"$GLM_API_KEY\"",
      ],
      { encoding: "buffer", timeout: 8000 }
    );
    const [baseUrl = "", authToken = "", apiKey = ""] = out.toString("utf8").split("\0");
    return {
      baseUrl,
      authToken: authToken || apiKey,
      authTokenRaw: authToken,
      apiKeyRaw: apiKey,
    };
  } catch {
    return { baseUrl: "", authToken: "", authTokenRaw: "", apiKeyRaw: "" };
  }
}

function resolveGlmEnv() {
  const processBaseUrl = firstEnv(["ANTHROPIC_GLM_BASE_URL"]);
  const processAuthToken = firstEnv(["ANTHROPIC_GLM_AUTH_TOKEN"]);
  const processApiKey = firstEnv(["GLM_API_KEY"]);
  let baseUrl = processBaseUrl;
  let authToken = processAuthToken || processApiKey;
  let source = processAuthToken ? "process:ANTHROPIC_GLM_AUTH_TOKEN" : processApiKey ? "process:GLM_API_KEY" : null;

  if (!baseUrl || !authToken) {
    const zshEnv = loadZshGlmEnv();
    baseUrl ||= zshEnv.baseUrl;
    if (!authToken && zshEnv.authToken) {
      authToken = zshEnv.authToken;
      source = zshEnv.authTokenRaw ? "zshrc:ANTHROPIC_GLM_AUTH_TOKEN" : "zshrc:GLM_API_KEY";
    }
  }

  if (!baseUrl) fail("missing GLM base URL env: set ANTHROPIC_GLM_BASE_URL in ~/.zshrc");
  if (!authToken) fail("missing GLM auth env: set ANTHROPIC_GLM_AUTH_TOKEN or GLM_API_KEY in ~/.zshrc");

  return { baseUrl, authToken, source: source || "unknown" };
}

function childEnv() {
  const { baseUrl, authToken } = resolveGlmEnv();
  const env = { ...process.env };

  for (const key of [
    "ANTHROPIC_API_KEY",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
  ]) {
    delete env[key];
  }

  env.ANTHROPIC_BASE_URL = baseUrl;
  env.ANTHROPIC_AUTH_TOKEN = authToken;

  return env;
}

function splitArgs(argv, config = {}) {
  const out = { options: {}, positional: [] };
  const bools = new Set(config.bools || []);
  const values = new Set(config.values || []);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      out.positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (bools.has(key)) out.options[key] = true;
      else if (values.has(key)) {
        const value = argv[++i];
        if (!value) fail(`--${key} requires a value`);
        out.options[key] = value;
      } else out.positional.push(arg);
    } else {
      out.positional.push(arg);
    }
  }

  return out;
}

function taskFromArgs(args) {
  return args.join(" ").trim();
}

function generateJobId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const rand = Math.random().toString(36).slice(2, 8);
  return `glm-${stamp}-${rand}`;
}

function summarize(text, limit = 120) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit - 3)}...` : clean;
}

function createJob({ task, write, cwd }) {
  ensureStateDir();
  const id = generateJobId();
  const dir = path.join(STATE_DIR, id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, "task.txt"), task, { mode: 0o600 });

  const job = {
    id,
    status: "queued",
    model: process.env.GLM_SCALE_MODEL || DEFAULT_MODEL,
    write,
    cwd,
    taskPreview: summarize(task),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    pid: null,
    sessionId: null,
    exitCode: null,
    error: null,
    files: {
      task: path.join(dir, "task.txt"),
      progress: path.join(dir, "progress.log"),
      events: path.join(dir, "events.jsonl"),
      result: path.join(dir, "result.md"),
    },
  };
  writeJson(path.join(dir, "job.json"), job);
  return job;
}

function buildClaudeArgs(task, write) {
  const model = process.env.GLM_SCALE_MODEL || DEFAULT_MODEL;
  const tools = write
    ? ["Read", "Grep", "Glob", "Edit", "Write", "Bash"]
    : ["Read", "Grep", "Glob", "Bash(git:*)"];

  return [
    "-p",
    task,
    "--model",
    model,
    "--setting-sources",
    "project",
    "--allowed-tools",
    ...tools,
    "--permission-mode",
    write ? "bypassPermissions" : "default",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--include-hook-events",
  ];
}

function shortJson(value, limit = 180) {
  const text = JSON.stringify(value);
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function summarizeEvent(event) {
  if (event.type === "stream_event") {
    return null;
  }
  if (event.type === "system") {
    if (event.subtype === "thinking_tokens") return null;
    return `system:${event.subtype || "event"}`;
  }
  if (event.type === "assistant") {
    const content = event.message?.content;
    if (Array.isArray(content)) {
      const tool = content.find((item) => item?.type === "tool_use");
      if (tool) return `tool:${tool.name || "unknown"} ${tool.input ? shortJson(tool.input) : ""}`.trim();
      const text = content.find((item) => item?.type === "text")?.text;
      if (text) return `assistant:${summarize(text, 160)}`;
    }
    return null;
  }
  if (event.type === "user") {
    const content = event.message?.content;
    if (Array.isArray(content) && content.some((item) => item?.type === "tool_result")) {
      return "tool-result";
    }
    return "user";
  }
  if (event.type === "result") {
    return `result:${event.is_error ? "error" : "ok"}`;
  }
  if (event.type) return event.type;
  return "event";
}

function runWorker(jobId, { mirror = false } = {}) {
  const job = updateJob(jobId, { status: "running", pid: process.pid, startedAt: nowIso() });
  const task = fs.readFileSync(job.files.task, "utf8");
  const claudeBin = process.env.GLM_SCALE_CLAUDE_BIN || "claude";
  const args = buildClaudeArgs(task, job.write);

  append(job.files.progress, `[${nowIso()}] start model=${job.model} write=${job.write} cwd=${job.cwd}\n`);
  const child = spawn(claudeBin, args, {
    cwd: job.cwd,
    env: childEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });

  updateJob(jobId, { childPid: child.pid });

  let stdoutBuf = "";
  let stderr = "";
  let finalResult = "";
  let sessionId = null;
  let isError = false;

  child.stdout.on("data", (chunk) => {
    stdoutBuf += chunk.toString("utf8");
    let idx;
    while ((idx = stdoutBuf.indexOf("\n")) >= 0) {
      const line = stdoutBuf.slice(0, idx);
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (!line.trim()) continue;
      append(job.files.events, `${line}\n`);
      try {
        const event = JSON.parse(line);
        const summary = summarizeEvent(event);
        if (summary) {
          append(job.files.progress, `[${nowIso()}] ${summary}\n`);
          if (mirror) process.stderr.write(`[glm-scale] ${summary}\n`);
        }
        if (event.session_id) sessionId = event.session_id;
        if (event.type === "result") {
          finalResult = event.result || "";
          sessionId = event.session_id || sessionId;
          isError = Boolean(event.is_error);
          updateJob(jobId, { sessionId, status: isError ? "failed" : "succeeded" });
        }
      } catch {
        append(job.files.progress, `[${nowIso()}] non-json:${summarize(line)}\n`);
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    stderr += text;
    append(job.files.progress, text);
    if (mirror) process.stderr.write(text);
  });

  child.on("error", (error) => {
    updateJob(jobId, { status: "failed", error: error.message });
    append(job.files.progress, `[${nowIso()}] spawn-error:${error.message}\n`);
    if (mirror) process.stderr.write(`[glm-scale] spawn-error:${error.message}\n`);
  });

  child.on("close", (code) => {
    if (stdoutBuf.trim()) append(job.files.events, `${stdoutBuf.trim()}\n`);
    const current = readJson(jobPath(jobId));
    const status = current.status === "canceled" ? "canceled" : finalResult && !isError && code === 0 ? "succeeded" : "failed";
    const error = status === "failed" ? summarize(stderr || finalResult || `claude exited with code ${code}`, 2000) : null;

    fs.writeFileSync(job.files.result, finalResult || "", { mode: 0o600 });
    updateJob(jobId, {
      status,
      sessionId,
      exitCode: code,
      finishedAt: nowIso(),
      error,
    });

    append(job.files.progress, `[${nowIso()}] finish status=${status} exit=${code} session=${sessionId || "?"}\n`);
    if (mirror) {
      if (finalResult) process.stdout.write(`${finalResult}\n`);
      process.stderr.write(`[glm-scale] ${status} | job: ${jobId} | session: ${sessionId || "?"}\n`);
    }
    process.exit(status === "succeeded" ? 0 : 1);
  });
}

function startBackground(job) {
  const child = spawn(process.execPath, [SCRIPT_PATH, "worker", "--job-id", job.id], {
    cwd: job.cwd,
    env: process.env,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  updateJob(job.id, { status: "running", supervisorPid: child.pid });
  return child.pid;
}

function handleRun(argv) {
  const { options, positional } = splitArgs(argv, {
    bools: ["background", "wait", "write", "read-only"],
    values: ["cwd"],
  });
  if (options.background && options.wait) fail("choose either --background or --wait");
  if (options.write && options["read-only"]) fail("choose either --write or --read-only");

  const task = taskFromArgs(positional);
  if (!task) fail("missing task");

  const cwd = path.resolve(options.cwd || process.cwd());
  const job = createJob({ task, write: !options["read-only"], cwd });

  if (options.background) {
    startBackground(job);
    process.stdout.write([
      `job: ${job.id}`,
      `status: ${job.status}`,
      `progress: ${job.files.progress}`,
      `events: ${job.files.events}`,
      `result: ${job.files.result}`,
      `status command: node ${SCRIPT_PATH} status ${job.id}`,
      `result command: node ${SCRIPT_PATH} result ${job.id}`,
      "",
    ].join("\n"));
    return;
  }

  runWorker(job.id, { mirror: true });
}

function listJobs() {
  ensureStateDir();
  return fs.readdirSync(STATE_DIR)
    .map((id) => {
      try {
        return readJson(jobPath(id));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function handleStatus(argv) {
  const { options, positional } = splitArgs(argv, { bools: ["all", "json"] });
  const id = positional[0];
  const jobs = id ? [readJson(jobPath(id))] : listJobs().slice(0, options.all ? 20 : 8);
  if (options.json) {
    process.stdout.write(JSON.stringify(jobs, null, 2) + "\n");
    return;
  }

  if (!jobs.length) {
    process.stdout.write("No GLM scale jobs.\n");
    return;
  }

  for (const job of jobs) {
    process.stdout.write(`${job.id} | ${job.status} | ${job.model} | ${job.write ? "write" : "read"} | ${job.taskPreview}\n`);
    process.stdout.write(`  progress: ${job.files.progress}\n`);
    process.stdout.write(`  result:   ${job.files.result}\n`);
    if (job.sessionId) process.stdout.write(`  session:  ${job.sessionId}\n`);
    if (job.error) process.stdout.write(`  error:    ${job.error}\n`);
  }
}

function handleResult(argv) {
  const id = argv[0] || listJobs()[0]?.id;
  if (!id) fail("no jobs found");
  const job = readJson(jobPath(id));
  process.stdout.write(`job: ${job.id}\nstatus: ${job.status}\nsession: ${job.sessionId || "?"}\n\n`);
  if (fs.existsSync(job.files.result)) {
    process.stdout.write(fs.readFileSync(job.files.result, "utf8"));
    if (!String(fs.readFileSync(job.files.result, "utf8")).endsWith("\n")) process.stdout.write("\n");
  }
  if (job.error) process.stdout.write(`\n[error]\n${job.error}\n`);
}

function handleCancel(argv) {
  const id = argv[0] || listJobs().find((job) => job.status === "running")?.id;
  if (!id) fail("no running job found");
  const job = readJson(jobPath(id));
  for (const pid of [job.childPid, job.supervisorPid, job.pid].filter(Boolean)) {
    try { process.kill(-pid, "SIGTERM"); } catch {}
    try { process.kill(pid, "SIGTERM"); } catch {}
  }
  updateJob(id, { status: "canceled", finishedAt: nowIso(), error: "Canceled by user" });
  process.stdout.write(`canceled ${id}\n`);
}

function handleSetup() {
  const claudeBin = process.env.GLM_SCALE_CLAUDE_BIN || "claude";
  const node = commandAvailable(process.execPath, ["--version"]);
  const claude = commandAvailable(claudeBin, ["--version"]);
  let envStatus;
  let resolved = null;
  try {
    resolved = resolveGlmEnv();
    envStatus = { ok: true };
  } catch (error) {
    envStatus = { ok: false, error: error.message };
  }
  const zshEnv = loadZshGlmEnv();

  process.stdout.write(`GLM Claude plugin setup\n\n`);
  process.stdout.write(`node:   ${node.available ? `ok (${node.output})` : `missing (${node.error})`}\n`);
  process.stdout.write(`claude: ${claude.available ? `ok (${claude.output})` : `missing (${claude.error})`}\n`);
  process.stdout.write(`env:    ${envStatus.ok ? "ok (ANTHROPIC_GLM_BASE_URL + token found)" : `missing (${envStatus.error})`}\n`);
  if (resolved) {
    process.stdout.write(`resolved token source: ${resolved.source} (${tokenLabel(resolved.authToken)})\n`);
  }
  process.stdout.write(`process ANTHROPIC_GLM_AUTH_TOKEN: ${tokenLabel(process.env.ANTHROPIC_GLM_AUTH_TOKEN)}\n`);
  process.stdout.write(`process GLM_API_KEY: ${tokenLabel(process.env.GLM_API_KEY)}\n`);
  process.stdout.write(`zshrc ANTHROPIC_GLM_AUTH_TOKEN: ${tokenLabel(zshEnv.authTokenRaw)}\n`);
  process.stdout.write(`zshrc GLM_API_KEY: ${tokenLabel(zshEnv.apiKeyRaw)}\n`);
  process.stdout.write(`model:  ${process.env.GLM_SCALE_MODEL || DEFAULT_MODEL}\n`);
  process.stdout.write(`default permissions: write + bypassPermissions\n`);
  process.stdout.write(`ANTHROPIC_API_KEY in parent env: ${process.env.ANTHROPIC_API_KEY ? "set (stripped for GLM child)" : "not set"}\n`);
  process.stdout.write(`jobs:   ${STATE_DIR}\n`);
}

function printHelp() {
  process.stdout.write(`glm-companion: run Claude Code with GLM model ${DEFAULT_MODEL}

Usage:
  node glm-companion.mjs setup
  node glm-companion.mjs run [--wait|--background] [--read-only] [--cwd <dir>] "<task>"
  node glm-companion.mjs status [job-id] [--all] [--json]
  node glm-companion.mjs result [job-id]
  node glm-companion.mjs cancel [job-id]

Environment is loaded from the current process, then ~/.zshrc fallback:
  ANTHROPIC_GLM_BASE_URL
  ANTHROPIC_GLM_AUTH_TOKEN or GLM_API_KEY

Default permissions:
  Full write access with --permission-mode bypassPermissions.
  Pass --read-only to restrict to Read/Grep/Glob/Bash(git:*).

Compatibility:
  node glm-companion.mjs "<task>" is treated as: run --wait "<task>"
`);
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "--help" || cmd === "-h") {
    printHelp();
    return;
  }
  if (cmd === "setup") return handleSetup();
  if (cmd === "run") return handleRun(rest);
  if (cmd === "worker") {
    const { options } = splitArgs(rest, { values: ["job-id"] });
    if (!options["job-id"]) fail("worker requires --job-id");
    return runWorker(options["job-id"]);
  }
  if (cmd === "status") return handleStatus(rest);
  if (cmd === "result") return handleResult(rest);
  if (cmd === "cancel") return handleCancel(rest);

  // Backward-compatible direct task mode.
  return handleRun(["--wait", ...process.argv.slice(2)]);
}

main();
