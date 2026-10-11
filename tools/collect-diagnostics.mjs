import { execFileSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const output = resolve(
  process.argv[2] ??
    `starrypad-diagnostics-${new Date().toISOString().replaceAll(":", "-")}.txt`,
);
const commandEnv = { ...process.env, LANG: "C", LC_ALL: "C" };
if (process.getuid?.() === 0) delete commandEnv.XDG_RUNTIME_DIR;

function command(name, args) {
  try {
    return execFileSync(name, args, {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 4 * 1024 * 1024,
      env: commandEnv,
    }).trim();
  } catch (error) {
    const stdout = typeof error?.stdout === "string" ? error.stdout.trim() : "";
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    return [`command failed: ${name} ${args.join(" ")}`, stdout, stderr]
      .filter(Boolean)
      .join("\n");
  }
}

const journalArgs = [
  "-q",
  "-u",
  "companion",
  "--since",
  "24 hours ago",
  "--no-pager",
  "-n",
  "5000",
];
let journal = command("journalctl", journalArgs);
if (!/STARRYPAD MINI|\[SPM-/i.test(journal)) {
  const privilegedJournal = command("sudo", ["-n", "journalctl", ...journalArgs]);
  if (/STARRYPAD MINI|\[SPM-/i.test(privilegedJournal))
    journal = privilegedJournal;
}
const starrypadLogs = journal
  .split("\n")
  .filter((line) => /STARRYPAD MINI|\[SPM-/i.test(line))
  .slice(-1000)
  .join("\n");
const alsaMidi =
  process.getuid?.() === 0 && process.env.SUDO_USER
    ? command("runuser", ["-u", process.env.SUDO_USER, "--", "aconnect", "-l"])
    : command("aconnect", ["-l"]);

const sections = [
  ["generated", new Date().toISOString()],
  [
    "module package",
    command("node", [
      "-e",
      "const p=require('./package.json'); console.log(p.name, p.version)",
    ]),
  ],
  ["git revision", command("git", ["rev-parse", "HEAD"])],
  ["git status", command("git", ["status", "--short"]) || "clean"],
  ["system", command("uname", ["-a"])],
  ["node", command("node", ["--version"])],
  ["usb device", command("lsusb", ["-d", "4353:4b4d"])],
  ["ALSA MIDI", alsaMidi],
  [
    "Companion service",
    command("systemctl", [
      "show",
      "companion",
      "--property=ActiveState,SubState,ExecMainStartTimestamp,ExecMainPID",
    ]),
  ],
  [
    "STARRYPAD logs (last 24h, max 1000 lines)",
    starrypadLogs ||
      "no matching log lines (journal access may require additional permission)",
  ],
];

const text =
  sections.map(([title, body]) => `## ${title}\n${body}`).join("\n\n") + "\n";
writeFileSync(output, text, { mode: 0o600 });
chmodSync(output, 0o600);
console.log(output);
