// Kept so existing routes keep importing from here; the implementation (Claude CLI + Copilot CLI) lives in lib/ai-cli.ts.
export { ClaudeCliError, runClaudeJson, modelLabel, servedModel, providerName, CLAUDE_MODEL } from '@/lib/ai-cli'
export type { AiProvider, RunOptions } from '@/lib/ai-cli'
