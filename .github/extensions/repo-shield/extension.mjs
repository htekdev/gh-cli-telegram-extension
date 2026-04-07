import { approveAll } from "@github/copilot-sdk";
import { joinSession } from "@github/copilot-sdk/extension";

const DANGEROUS_COMMANDS = [
  { pattern: /rm\s+-rf\s+\/(?!\w)/i, reason: "Recursive delete from root" },
  { pattern: /Remove-Item\s+[A-Z]:\\\s*-Recurse/i, reason: "Recursive delete of drive root" },
  { pattern: /DROP\s+(DATABASE|TABLE)\s/i, reason: "Destructive database operation" },
  { pattern: /git\s+push\s+.*--force\s+(origin\s+)?(main|master|production)/i, reason: "Force push to protected branch" },
  { pattern: /git\s+push\s+.*-f\s+(origin\s+)?(main|master|production)/i, reason: "Force push to protected branch" },
  { pattern: /:(){ :\|:& };:/i, reason: "Fork bomb detected" },
  { pattern: /mkfs\./i, reason: "Filesystem format command" },
  { pattern: /dd\s+if=.*of=\/dev\//i, reason: "Raw disk write" },
];

const SECRET_PATTERNS = [
  { pattern: /(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}/g, type: "AWS Access Key" },
  { pattern: /ghp_[a-zA-Z0-9]{36}/g, type: "GitHub Personal Access Token" },
  { pattern: /gho_[a-zA-Z0-9]{36}/g, type: "GitHub OAuth Token" },
  { pattern: /ghs_[a-zA-Z0-9]{36}/g, type: "GitHub App Token" },
  { pattern: /ghr_[a-zA-Z0-9]{36}/g, type: "GitHub Refresh Token" },
  { pattern: /sk-[a-zA-Z0-9]{20}T3BlbkFJ[a-zA-Z0-9]{20}/g, type: "OpenAI API Key" },
  { pattern: /xox[bpors]-[0-9]{10,13}-[a-zA-Z0-9-]+/g, type: "Slack Token" },
  { pattern: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/g, type: "Private Key" },
  { pattern: /(?:password|passwd|pwd)\s*[:=]\s*["'][^"']{8,}["']/gi, type: "Hardcoded Password" },
  { pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*["'][a-zA-Z0-9]{16,}["']/gi, type: "Hardcoded API Key" },
];

const PROTECTED_PATHS = [
  /^\.github\/workflows\//,
  /^\.github\/CODEOWNERS$/,
  /Dockerfile$/,
  /docker-compose\.ya?ml$/,
  /\.env(?:\.example)?$/,
  /terraform\//,
  /\.tf$/,
];

const session = await joinSession({
  onPermissionRequest: approveAll,
  hooks: {
    onSessionStart: async () => ({
      additionalContext:
        "[repo-shield] Security extension active. Enforcing:\n" +
        "- Destructive command blocking (rm -rf /, force push to main, DROP DATABASE)\n" +
        "- Hardcoded secret detection in file writes\n" +
        "- Protected file change warnings (.github/workflows, Dockerfile, .env, terraform)\n" +
        "Use environment variables for all secrets. Never hardcode credentials.",
    }),
    onPreToolUse: async (input) => {
      if (input.toolName === "powershell") {
        const cmd = String(input.toolArgs?.command || "");
        for (const { pattern, reason } of DANGEROUS_COMMANDS) {
          if (pattern.test(cmd)) {
            return {
              permissionDecision: "deny",
              permissionDecisionReason:
                `[repo-shield] BLOCKED: ${reason}.\nCommand: ${cmd}`,
            };
          }
        }
      }

      if (input.toolName === "create" || input.toolName === "edit") {
        const content = String(input.toolArgs?.file_text || input.toolArgs?.new_str || "");
        const filePath = String(input.toolArgs?.path || "");
        const detectedSecrets = [];

        for (const { pattern, type } of SECRET_PATTERNS) {
          pattern.lastIndex = 0;
          if (pattern.test(content)) {
            detectedSecrets.push(type);
          }
        }

        if (detectedSecrets.length > 0) {
          return {
            permissionDecision: "deny",
            permissionDecisionReason:
              `[repo-shield] BLOCKED: Potential secrets detected in ${filePath}:\n` +
              detectedSecrets.map((s) => `  - ${s}`).join("\n") +
              `\n\nUse environment variables instead of hardcoded secrets.`,
          };
        }

        for (const pathPattern of PROTECTED_PATHS) {
          if (pathPattern.test(filePath.replace(/\\/g, "/"))) {
            return {
              additionalContext:
                `[repo-shield] WARNING: Modifying protected file: ${filePath}. ` +
                `Ensure this change is intentional and has been reviewed for security implications.`,
            };
          }
        }
      }
    },
  },
  tools: [],
});
