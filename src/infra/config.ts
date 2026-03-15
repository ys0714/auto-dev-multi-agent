import path from 'path';
import dotenv from 'dotenv';
import os from 'os';

dotenv.config({ override: true });

export const APP_NAME = process.env.APP_NAME || 'multi-auto-agent';

export const WORKDIR = process.cwd();
export const GLOBAL_DIR = process.env.AGENT_HOME || path.join(os.homedir(), `.${APP_NAME}`);
export const AGENT_DIR = path.join(WORKDIR, `.${APP_NAME}`);

export const TEAM_DIR = path.join(AGENT_DIR, 'team');
export const INBOX_DIR = path.join(TEAM_DIR, 'inbox');
export const TASKS_DIR = path.join(AGENT_DIR, 'tasks');
export const SKILLS_DIR = path.join(WORKDIR, 'skills');
export const TRANSCRIPT_DIR = path.join(AGENT_DIR, 'transcripts');
export const TOOL_OUTPUTS_DIR = path.join(AGENT_DIR, 'tool-outputs');
export const SCHEMAS_DIR = path.join(AGENT_DIR, 'schemas');
export const WORKTREE_EVENTS_PATH = path.join(AGENT_DIR, 'worktree-events.jsonl');

export const SESSIONS_DIR = path.join(GLOBAL_DIR, 'sessions');
export const USER_PROFILE_PATH = path.join(GLOBAL_DIR, 'user-profile.json');

export const TOKEN_THRESHOLD = 100000;
export const POLL_INTERVAL = 5;
export const IDLE_TIMEOUT = 60;

export const VALID_MSG_TYPES = new Set([
  'message',
  'broadcast',
  'shutdown_request',
  'shutdown_response',
  'plan_approval_response',
]);

export const MODEL_ID = process.env.MODEL_ID || 'claude-3-5-sonnet-20241022';
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
export const ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL;
