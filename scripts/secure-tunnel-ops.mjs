#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { constants, openSync, closeSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOME = process.env.HOME ?? "/home/neroued";
const DEFAULT_CONFIG = "./config.local.json";
const DEFAULT_PROFILE = "gpt-repo-local";
const DEFAULT_PROFILE_DIR = join(HOME, ".config", "tunnel-client");
const DEFAULT_BIN = join(HOME, ".local", "bin", "tunnel-client");
const DEFAULT_PORT = "8787";
const DEFAULT_HEALTH_ADDR = "127.0.0.1:8080";
const RUN_DIR = join(ROOT, "run");
const LOG_DIR = join(ROOT, "logs");
const PID_FILE = join(RUN_DIR, "gpt-repo-mcp-secure.pid");
const LEGACY_PID_FILE = "/tmp/gpt-repo-mcp-secure.pid";
const LOG_FILE = join(LOG_DIR, "gpt-repo-mcp-secure.log");
const SERVICE_NAME = "gpt-repo-mcp-secure.service";
const USER_SYSTEMD_DIR = join(HOME, ".config", "systemd", "user");
const USER_SERVICE_FILE = join(USER_SYSTEMD_DIR, SERVICE_NAME);
const NODE_BIN_DIR = dirname(process.execPath);
const DEFAULT_SYSTEMD_PATH = `${NODE_BIN_DIR}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`;
const PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy"
];

const TUNNEL_CLIENT_VERSION = "v0.0.9--context-conduit-topaz";
const TUNNEL_CLIENT_URL =
  "https://persistent.oaistatic.com/tunnel-client/v0.0.9--context-conduit-topaz/tunnel-client-v0.0.9--context-conduit-topaz-linux-amd64.zip";
const TUNNEL_CLIENT_SHA256 = "eab94825dbd589e938a6a7ba5cd74bf0becaa3bef0e655f4438a0f75fddfbc8f";

const READ_ONLY_TOOLS = [
  "repo_list_roots",
  "repo_policy_explain",
  "repo_tree",
  "repo_fetch_file",
  "repo_read_many",
  "repo_change_plan",
  "repo_plan_review",
  "repo_prepare_codex_task",
  "repo_codex_review",
  "repo_next_action"
];

const DISABLE_TOOLS = [
  "repo_search",
  "repo_git_diff",
  "repo_git_review",
  "repo_git_stage",
  "repo_git_unstage",
  "repo_git_restore_paths",
  "repo_git_commit",
  "repo_write_stage",
  "repo_write_unstage",
  "repo_write_commit",
  "repo_write_stage_commit",
  "repo_write_recover",
  "repo_cleanup_paths",
  "repo_write_codex_task",
  "repo_write_file",
  "repo_write_changes",
  "repo_write_handoff"
];

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  switch (command) {
    case "help":
      printHelp();
      return;
    case "install-client":
      await installClient(options);
      return;
    case "setup":
      await setup(options);
      return;
    case "check":
      await check(options);
      return;
    case "run":
      await runForeground();
      return;
    case "start":
      await start(options);
      return;
    case "stop":
      await stop();
      return;
    case "restart":
      await stop({ quiet: true });
      await start(options);
      return;
    case "status":
      await status();
      return;
    case "logs":
      await logs(options);
      return;
    case "install-service":
      await installService(options);
      return;
    case "uninstall-service":
      await uninstallService();
      return;
    case "service-status":
      await serviceStatus();
      return;
    case "chatgpt":
      printChatGptInstructions();
      return;
    default:
      throw new Error(`Unknown command "${command}". Run: npm run secure:tunnel -- help`);
  }
}

function parseArgs(argv) {
  const command = argv[0] && !argv[0].startsWith("--") ? argv[0] : "help";
  const rest = command === "help" && argv[0]?.startsWith("--") ? argv : argv.slice(1);
  const options = {};

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument "${arg}".`);
    }

    const key = toCamelCase(arg.slice(2));
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }

  return { command, options };
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function printHelp() {
  console.log(`Secure MCP Tunnel operations

Usage:
  npm run secure:tunnel -- install-client [--bin <path>]
  npm run secure:tunnel -- setup --repo <path> --tunnel-id <tunnel_...> [--repo-id <id>] [--display-name <name>]
  npm run secure:tunnel -- check
  npm run secure:tunnel -- run
  npm run secure:start
  npm run secure:status
  npm run secure:stop
  npm run secure:logs
  npm run secure:tunnel -- install-service
  npm run secure:tunnel -- uninstall-service
  npm run secure:tunnel -- service-status
  npm run secure:tunnel -- chatgpt

Defaults:
  config: ${DEFAULT_CONFIG}
  profile: ${DEFAULT_PROFILE}
  profile dir: ${DEFAULT_PROFILE_DIR}
  tunnel-client: ${DEFAULT_BIN}
  MCP URL: http://127.0.0.1:${DEFAULT_PORT}/mcp
  admin UI: http://${DEFAULT_HEALTH_ADDR}/ui
  pid: ${PID_FILE}
  log: ${LOG_FILE}

The runtime API key must be stored in .env as CONTROL_PLANE_API_KEY.
This script never prints that key.`);
}

async function installClient(options) {
  const bin = resolvePath(options.bin ?? envFileValue("TUNNEL_CLIENT_BIN") ?? DEFAULT_BIN);
  const workDir = "/tmp/gpt-repo-mcp-tunnel-client";
  const zipPath = join(workDir, `tunnel-client-${TUNNEL_CLIENT_VERSION}-linux-amd64.zip`);
  const extractDir = join(workDir, "extract");

  await mkdir(workDir, { recursive: true });
  await run("curl", ["-fsSL", "-o", zipPath, TUNNEL_CLIENT_URL]);

  const digest = createHash("sha256").update(await readFile(zipPath)).digest("hex");
  if (digest !== TUNNEL_CLIENT_SHA256) {
    throw new Error(`tunnel-client checksum mismatch: expected ${TUNNEL_CLIENT_SHA256}, got ${digest}`);
  }

  await rm(extractDir, { recursive: true, force: true });
  await run("python3", ["-m", "zipfile", "-e", zipPath, extractDir]);
  await mkdir(dirname(bin), { recursive: true });
  await copyFile(join(extractDir, "tunnel-client"), bin);
  await chmod(bin, 0o755);

  console.log(`Installed tunnel-client ${TUNNEL_CLIENT_VERSION} to ${bin}`);
}

async function setup(options) {
  const env = await readEnv();
  const repoOption = options.repo ?? env.GPT_REPO_TARGET_REPO;
  if (!repoOption) {
    throw new Error("Missing --repo <path>.");
  }

  const repoRoot = await realpath(resolvePath(repoOption));
  await ensureDirectory(repoRoot, "repo");

  const tunnelId =
    options.tunnelId ??
    env.CONTROL_PLANE_TUNNEL_ID ??
    env.OPENAI_TUNNEL_ID ??
    env.TUNNEL_ID ??
    (await readProfileTunnelId(profilePath(options, env)).catch(() => undefined));
  if (!tunnelId) {
    throw new Error("Missing --tunnel-id <tunnel_...>.");
  }

  const defaults = deriveRepoDefaults(repoRoot);
  const repoId = options.repoId ?? defaults.repoId;
  const displayName = options.displayName ?? defaults.displayName;
  const configPath = resolve(ROOT, options.config ?? env.GPT_REPO_CONFIG ?? DEFAULT_CONFIG);
  const port = String(options.port ?? env.PORT ?? DEFAULT_PORT);
  const profile = String(options.profile ?? env.TUNNEL_CLIENT_PROFILE ?? DEFAULT_PROFILE);
  const profileDir = resolvePath(options.profileDir ?? env.TUNNEL_CLIENT_PROFILE_DIR ?? DEFAULT_PROFILE_DIR);
  const bin = resolvePath(options.bin ?? env.TUNNEL_CLIENT_BIN ?? DEFAULT_BIN);
  const healthAddr = String(options.healthListenAddr ?? env.HEALTH_LISTEN_ADDR ?? DEFAULT_HEALTH_ADDR);

  await ensureExecutable(bin, "tunnel-client");
  await writeReadOnlyConfig(configPath, repoRoot, repoId, displayName);
  await upsertEnv({
    TUNNEL_CLIENT_BIN: bin,
    TUNNEL_CLIENT_PROFILE: profile,
    TUNNEL_CLIENT_PROFILE_DIR: profileDir,
    GPT_REPO_CONFIG: relativeToRoot(configPath),
    PORT: port,
    GPT_REPO_LOG_FORMAT: env.GPT_REPO_LOG_FORMAT ?? "pretty"
  });

  const mcpUrl = `http://127.0.0.1:${port}/mcp`;
  await run(bin, buildTunnelInitArgs({ profile, tunnelId, mcpUrl, healthListenAddr: healthAddr }));
  await run("npm", ["run", "check:config"], { cwd: ROOT, inherit: true });

  const freshEnv = await readEnv();
  if (!freshEnv.CONTROL_PLANE_API_KEY) {
    console.log("WARNING: .env does not contain CONTROL_PLANE_API_KEY. Add it before running start.");
  }

  console.log(`Configured read-only repo ${repoId} at ${repoRoot}`);
  console.log(`Configured tunnel profile ${profile} at ${join(profileDir, `${profile}.yaml`)}`);
}

function deriveRepoDefaults(repoRoot) {
  const displayName = basename(repoRoot);
  const repoId = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "repo";
  return { repoId, displayName };
}

function buildTunnelInitArgs({ profile, tunnelId, mcpUrl, healthListenAddr }) {
  return [
    "init",
    "--sample",
    "sample_mcp_remote_no_auth",
    "--profile",
    profile,
    "--tunnel-id",
    tunnelId,
    "--mcp-server-url",
    mcpUrl,
    "--health-listen-addr",
    healthListenAddr,
    "--force"
  ];
}

async function check() {
  const env = await readEnv();
  Object.assign(process.env, env);
  const configPath = resolve(ROOT, env.GPT_REPO_CONFIG ?? DEFAULT_CONFIG);
  const profile = env.TUNNEL_CLIENT_PROFILE ?? DEFAULT_PROFILE;
  const bin = resolvePath(env.TUNNEL_CLIENT_BIN ?? DEFAULT_BIN);
  const port = env.PORT ?? DEFAULT_PORT;

  console.log("Offline checks:");
  await ensureExecutable(bin, "tunnel-client");
  console.log(`  tunnel-client: ${bin}`);
  await ensureFile(configPath, "config");
  console.log(`  config: ${configPath}`);
  await ensureFile(profilePath({}, env), "tunnel profile");
  console.log(`  profile: ${profile}`);
  console.log(`  CONTROL_PLANE_API_KEY: ${env.CONTROL_PLANE_API_KEY ? "set" : "missing"}`);
  await run("npm", ["run", "check:config"], { cwd: ROOT, inherit: true });

  console.log("\nRuntime checks:");
  const mcpHealth = await fetchText(`http://127.0.0.1:${port}/health`);
  console.log(`  MCP health: ${mcpHealth.ok ? "ok" : "not running"}`);
  const ready = await fetchText(`http://127.0.0.1:8080/readyz`);
  console.log(`  tunnel readyz: ${ready.ok ? ready.text : "not running"}`);

  if (mcpHealth.ok) {
    const doctor = await runDoctor(bin, profile, ready.ok);
    if (doctor.ok) {
      console.log("  tunnel doctor: ok");
    } else if (doctor.expected) {
      console.log(`  tunnel doctor: expected non-blocking failures (${doctor.failedChecks.join(", ")})`);
    } else {
      console.log("  tunnel doctor: failed");
      process.exitCode = 1;
    }
  }
}

async function runDoctor(bin, profile, readyOk) {
  const result = await runAllowFailure(bin, ["doctor", "--profile", profile, "--json"]);
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { ok: false, oauthOnly: false };
  }
  if (parsed.result === "pass") {
    return { ok: true, expected: false, failedChecks: [] };
  }
  const failedChecks = Array.isArray(parsed.failed_checks) ? parsed.failed_checks : [];
  return {
    ok: false,
    expected: isExpectedDoctorFailure(failedChecks, readyOk),
    failedChecks
  };
}

function isExpectedDoctorFailure(failedChecks, readyOk) {
  const expected = new Set(["oauth_metadata"]);
  if (readyOk) {
    expected.add("health_listener");
  }
  return failedChecks.length > 0 && failedChecks.every((check) => expected.has(check));
}

async function start() {
  const env = await readEnv();
  await ensureRuntimeDirs();
  await ensureFile(resolve(ROOT, env.GPT_REPO_CONFIG ?? DEFAULT_CONFIG), "config");
  await ensureExecutable(resolvePath(env.TUNNEL_CLIENT_BIN ?? DEFAULT_BIN), "tunnel-client");
  if (!env.CONTROL_PLANE_API_KEY) {
    throw new Error("Missing CONTROL_PLANE_API_KEY in .env.");
  }

  const runningPid = await readRunningPid();
  if (runningPid) {
    console.log(`Already running with PID ${runningPid}.`);
    await status();
    return;
  }

  await rm(LOG_FILE, { force: true });
  const out = openSync(LOG_FILE, "a");
  try {
    const child = spawn(process.execPath, ["scripts/connect-secure.mjs"], {
      cwd: ROOT,
      detached: true,
      stdio: ["ignore", out, out],
      env: envWithNodePath(process.env)
    });
    child.unref();
    await writeFile(PID_FILE, `${child.pid}\n`);
    console.log(`Started secure tunnel supervisor PID ${child.pid}`);
  } finally {
    closeSync(out);
  }

  await waitForUrl(`http://127.0.0.1:${env.PORT ?? DEFAULT_PORT}/health`, 30000, "MCP health");
  await waitForUrl("http://127.0.0.1:8080/readyz", 45000, "tunnel readyz");
  console.log(`Log: ${LOG_FILE}`);
}

async function runForeground() {
  const env = await readEnv();
  Object.assign(process.env, env);
  await ensureRuntimeDirs();
  await ensureFile(resolve(ROOT, env.GPT_REPO_CONFIG ?? DEFAULT_CONFIG), "config");
  await ensureExecutable(resolvePath(env.TUNNEL_CLIENT_BIN ?? DEFAULT_BIN), "tunnel-client");
  if (!env.CONTROL_PLANE_API_KEY) {
    throw new Error("Missing CONTROL_PLANE_API_KEY in .env.");
  }

  const runningPid = await readRunningPid();
  if (runningPid) {
    throw new Error(`Refusing to start duplicate secure tunnel supervisor; PID ${runningPid} is already running.`);
  }

  const out = openSync(LOG_FILE, "a");
  let child;
  const stopChild = (signal = "SIGTERM") => {
    if (child && !child.killed) {
      child.kill(signal);
    }
  };

  try {
    child = spawn(process.execPath, ["scripts/connect-secure.mjs"], {
      cwd: ROOT,
      stdio: ["ignore", out, out],
      env: envWithNodePath(process.env)
    });
    await writeFile(PID_FILE, `${child.pid}\n`);

    process.once("SIGTERM", () => stopChild("SIGTERM"));
    process.once("SIGINT", () => stopChild("SIGINT"));

    const exitCode = await new Promise((resolvePromise, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (signal) {
          resolvePromise(0);
          return;
        }
        resolvePromise(code ?? 1);
      });
    });
    await rm(PID_FILE, { force: true });
    process.exitCode = exitCode;
  } finally {
    closeSync(out);
  }
}

async function stop(options = {}) {
  const pid = await readRunningPid();
  if (!pid) {
    const runtime = await detectRuntimeProcesses();
    const pids = [...runtime.tunnelPids, ...runtime.mcpPids];
    for (const childPid of pids) {
      try {
        process.kill(childPid, "SIGTERM");
      } catch {
        // Already gone.
      }
    }
    if (!options.quiet) console.log("Not running.");
    await removePidFiles();
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    process.kill(pid, "SIGTERM");
  }

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!(await isPidRunning(pid))) {
      await removePidFiles();
      if (!options.quiet) console.log("Stopped.");
      return;
    }
    await delay(200);
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    process.kill(pid, "SIGKILL");
  }
  await removePidFiles();
  if (!options.quiet) console.log("Stopped with SIGKILL.");
}

async function status() {
  const env = await readEnv();
  const port = env.PORT ?? DEFAULT_PORT;
  const pid = await readRunningPid();
  const runtime = await detectRuntimeProcesses();
  console.log(`supervisor: ${pid ? `running pid ${pid}` : "not running"}`);
  if (!pid && runtime.supervisorPids.length > 0) {
    console.log(`detected supervisor: ${runtime.supervisorPids.join(", ")}`);
  }
  if (runtime.mcpPids.length > 0) {
    console.log(`detected MCP process: ${runtime.mcpPids.join(", ")}`);
  }
  if (runtime.tunnelPids.length > 0) {
    console.log(`detected tunnel-client process: ${runtime.tunnelPids.join(", ")}`);
  }
  console.log(`config: ${resolve(ROOT, env.GPT_REPO_CONFIG ?? DEFAULT_CONFIG)}`);
  console.log(`profile: ${env.TUNNEL_CLIENT_PROFILE ?? DEFAULT_PROFILE}`);
  console.log(`MCP URL: http://127.0.0.1:${port}/mcp`);
  console.log(`admin UI: http://127.0.0.1:8080/ui`);
  console.log(`log: ${LOG_FILE}`);
  console.log(`pid file: ${PID_FILE}`);

  const mcpHealth = await fetchText(`http://127.0.0.1:${port}/health`);
  console.log(`MCP health: ${mcpHealth.ok ? mcpHealth.text : "not reachable"}`);
  const ready = await fetchText("http://127.0.0.1:8080/readyz");
  console.log(`tunnel readyz: ${ready.ok ? ready.text : "not reachable"}`);

  const metrics = await fetchText("http://127.0.0.1:8080/metrics");
  if (metrics.ok) {
    const match = metrics.text.match(/commands_poll_last_successful_timestamp_seconds\{[^}]*\} ([^\n]+)/);
    console.log(`last successful poll timestamp: ${match?.[1] ?? "missing"}`);
  }
}

async function logs(options) {
  const lines = String(options.lines ?? "120");
  await ensureRuntimeDirs();
  if (options.follow) {
    await spawnInteractive("tail", ["-f", LOG_FILE]);
    return;
  }
  await run("tail", ["-n", lines, LOG_FILE], { inherit: true });
}

async function installService(options) {
  await ensureSystemdAvailable();
  await ensureRuntimeDirs();
  const env = await readEnv();
  await ensureFile(resolve(ROOT, env.GPT_REPO_CONFIG ?? DEFAULT_CONFIG), "config");
  await ensureExecutable(resolvePath(env.TUNNEL_CLIENT_BIN ?? DEFAULT_BIN), "tunnel-client");
  if (!env.CONTROL_PLANE_API_KEY) {
    throw new Error("Missing CONTROL_PLANE_API_KEY in .env.");
  }

  await mkdir(USER_SYSTEMD_DIR, { recursive: true });
  await writeFile(USER_SERVICE_FILE, serviceUnitText(env));
  await run("systemctl", ["--user", "daemon-reload"], { inherit: true });
  await runAllowFailure("systemctl", ["--user", "stop", SERVICE_NAME]);
  await stop({ quiet: true });
  if (!options.skipLinger) {
    await enableLinger();
  }
  await run("systemctl", ["--user", "enable", "--now", SERVICE_NAME], { inherit: true });
  await waitForUrl(`http://127.0.0.1:${env.PORT ?? DEFAULT_PORT}/health`, 30000, "MCP health");
  await waitForUrl("http://127.0.0.1:8080/readyz", 45000, "tunnel readyz");
  console.log(`Installed and started ${SERVICE_NAME}`);
  console.log(`Unit: ${USER_SERVICE_FILE}`);
  console.log(`Log: ${LOG_FILE}`);
}

async function uninstallService() {
  await ensureSystemdAvailable();
  await runAllowFailure("systemctl", ["--user", "disable", "--now", SERVICE_NAME]);
  await rm(USER_SERVICE_FILE, { force: true });
  await run("systemctl", ["--user", "daemon-reload"], { inherit: true });
  await removePidFiles();
  console.log(`Removed ${SERVICE_NAME}`);
}

async function serviceStatus() {
  await ensureSystemdAvailable();
  await run("systemctl", ["--user", "status", SERVICE_NAME, "--no-pager"], { inherit: true });
}

function serviceUnitText(env = {}) {
  const environmentLines = [
    systemdEnvironmentLine("PATH", DEFAULT_SYSTEMD_PATH),
    ...PROXY_ENV_KEYS
      .filter((key) => env[key])
      .map((key) => systemdEnvironmentLine(key, env[key]))
  ];

  return `[Unit]
Description=GPT Repo MCP Secure Tunnel
Documentation=https://github.com/CAHN91/gpt-repo-mcp
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${ROOT}
ExecStart=${process.execPath} ${join(ROOT, "scripts", "secure-tunnel-ops.mjs")} run
${environmentLines.join("\n")}
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=15

[Install]
WantedBy=default.target
`;
}

function systemdEnvironmentLine(key, value) {
  return `Environment="${key}=${escapeSystemdEnvironmentValue(String(value))}"`;
}

function escapeSystemdEnvironmentValue(value) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/%/g, "%%");
}

async function ensureSystemdAvailable() {
  if (!await pathExists("/run/systemd/system")) {
    throw new Error("systemd is not running. Enable systemd in WSL before installing the service.");
  }
  await run("systemctl", ["--user", "show-environment"], { inherit: true });
}

async function enableLinger() {
  const user = process.env.USER;
  if (!user) {
    throw new Error("USER is not set; cannot enable systemd linger for boot autostart.");
  }
  const result = await runAllowFailure("loginctl", ["enable-linger", user]);
  if (result.code !== 0) {
    throw new Error(`loginctl enable-linger ${user} failed\n${result.stderr || result.stdout}`);
  }
}

function printChatGptInstructions() {
  console.log(`ChatGPT connector settings:
  Connection: Tunnel
  Tunnel: select the configured tunnel_...
  Authentication: No Authentication

Enable these tools first:
  ${READ_ONLY_TOOLS.join("\n  ")}

Disable these tools first:
  ${DISABLE_TOOLS.join("\n  ")}

Starter prompt:
  Use GPT Repo MCP only. You are my planner. Do not write files. Do not use repo_search or repo_git_diff. First call repo_list_roots, then use repo_tree and repo_fetch_file only for files I ask you to inspect. Produce an implementation plan for Codex.`);
}

async function writeReadOnlyConfig(configPath, repoRoot, repoId, displayName) {
  const base = await readJson(configPath).catch(async () => readJson(resolve(ROOT, "config.example.json")));
  const document = {
    repos: [
      {
        repo_id: repoId,
        display_name: displayName,
        root: repoRoot,
        writes: { enabled: false },
        operations: { enabled: false }
      }
    ],
    limits: base.limits ?? {
      max_files: 50,
      max_bytes_per_file: 128000,
      max_total_bytes: 750000
    }
  };
  await writeFile(configPath, `${JSON.stringify(document, null, 2)}\n`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readEnv() {
  const raw = await readFile(resolve(ROOT, ".env"), "utf8").catch(() => "");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    env[match[1]] = unquote(match[2]);
  }
  return env;
}

function envFileValue(key) {
  try {
    const raw = readFileSync(resolve(ROOT, ".env"), "utf8");
    const match = raw.match(new RegExp(`^${key}=(.*)$`, "m"));
    return match ? unquote(match[1]) : undefined;
  } catch {
    return undefined;
  }
}

async function upsertEnv(updates) {
  const envPath = resolve(ROOT, ".env");
  const raw = await readFile(envPath, "utf8").catch(() => "CONTROL_PLANE_API_KEY=\n");
  const lines = raw.split(/\r?\n/);
  const seen = new Set();
  const next = lines.map((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!match || !(match[1] in updates)) return line;
    seen.add(match[1]);
    return `${match[1]}=${updates[match[1]]}`;
  });
  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) next.push(`${key}=${value}`);
  }
  await writeFile(envPath, `${next.filter((line, index) => line !== "" || index < next.length - 1).join("\n")}\n`);
  await chmod(envPath, 0o600);
}

function unquote(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function resolvePath(path) {
  if (path.startsWith("~/")) return join(HOME, path.slice(2));
  return resolve(ROOT, path);
}

function envWithNodePath(env) {
  const path = env.PATH ?? "";
  const entries = path.split(":").filter(Boolean);
  const nextPath = entries.includes(NODE_BIN_DIR) ? path : `${NODE_BIN_DIR}:${path || DEFAULT_SYSTEMD_PATH}`;
  return {
    ...env,
    PATH: nextPath
  };
}

function relativeToRoot(path) {
  const rel = path.startsWith(ROOT) ? path.slice(ROOT.length + 1) : path;
  return rel.startsWith("/") ? rel : `./${rel}`;
}

function profilePath(options, env) {
  const profile = options.profile ?? env.TUNNEL_CLIENT_PROFILE ?? DEFAULT_PROFILE;
  const profileDir = resolvePath(options.profileDir ?? env.TUNNEL_CLIENT_PROFILE_DIR ?? DEFAULT_PROFILE_DIR);
  return join(profileDir, `${profile}.yaml`);
}

async function readProfileTunnelId(path) {
  return parseProfileTunnelId(await readFile(path, "utf8"));
}

function parseProfileTunnelId(raw) {
  return raw.match(/^\s*tunnel_id:\s*["']?([^"'\s]+)["']?\s*$/m)?.[1];
}

async function ensureDirectory(path, label) {
  const info = await stat(path).catch(() => undefined);
  if (!info?.isDirectory()) throw new Error(`${label} directory not found: ${path}`);
}

async function ensureRuntimeDirs() {
  await mkdir(LOG_DIR, { recursive: true });
  await mkdir(RUN_DIR, { recursive: true });
}

async function ensureFile(path, label) {
  await access(path, constants.R_OK).catch(() => {
    throw new Error(`${label} file not found or unreadable: ${path}`);
  });
}

async function ensureExecutable(path, label) {
  await access(path, constants.X_OK).catch(() => {
    throw new Error(`${label} executable not found: ${path}`);
  });
}

async function run(command, args, options = {}) {
  if (options.inherit) {
    await spawnInteractive(command, args, options);
    return { stdout: "", stderr: "" };
  }

  return await new Promise((resolvePromise, reject) => {
    execFile(command, args, { cwd: options.cwd ?? ROOT, env: process.env, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${command} ${args.join(" ")} failed\n${stderr || stdout}`));
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
}

async function runAllowFailure(command, args) {
  return await new Promise((resolvePromise) => {
    execFile(command, args, { cwd: ROOT, env: process.env, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolvePromise({ code: error?.code ?? 0, stdout, stderr });
    });
  });
}

async function spawnInteractive(command, args, options = {}) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: options.cwd ?? ROOT, env: process.env, stdio: "inherit" });
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
    child.once("error", reject);
  });
}

async function fetchText(url) {
  try {
    const response = await fetch(url);
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  } catch (error) {
    return { ok: false, status: 0, text: error instanceof Error ? error.message : String(error) };
  }
}

async function waitForUrl(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    const result = await fetchText(url);
    if (result.ok) {
      console.log(`${label}: ${result.text}`);
      return;
    }
    last = result.text || `HTTP ${result.status}`;
    await delay(500);
  }
  throw new Error(`${label} did not become ready at ${url}: ${last}`);
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function readRunningPid() {
  for (const path of [PID_FILE, LEGACY_PID_FILE]) {
    const raw = await readFile(path, "utf8").catch(() => "");
    const pid = Number(raw.trim());
    if (pid && await isPidRunning(pid)) {
      if (path !== PID_FILE) {
        await ensureRuntimeDirs();
        await writeFile(PID_FILE, `${pid}\n`);
      }
      return pid;
    }
    await rm(path, { force: true });
  }
  const runtime = await detectRuntimeProcesses();
  if (runtime.supervisorPids.length > 0) {
    const detectedPid = runtime.supervisorPids[0];
    await ensureRuntimeDirs();
    await writeFile(PID_FILE, `${detectedPid}\n`);
    return detectedPid;
  }
  return undefined;
}

async function removePidFiles() {
  await rm(PID_FILE, { force: true });
  await rm(LEGACY_PID_FILE, { force: true });
}

async function isPidRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function detectRuntimeProcesses() {
  const result = await runAllowFailure("ps", ["-eo", "pid=,args="]);
  const supervisorPids = [];
  const tunnelPids = [];
  const mcpPids = [];

  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const args = match[2];
    if (args.includes("secure-tunnel-ops.mjs")) continue;
    if (args.includes("node scripts/connect-secure.mjs")) supervisorPids.push(pid);
    if (args.includes("tunnel-client run --profile gpt-repo-local")) tunnelPids.push(pid);
    if (args.includes("tsx src/server.ts")) mcpPids.push(pid);
  }

  return { supervisorPids, tunnelPids, mcpPids };
}

async function pathExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
