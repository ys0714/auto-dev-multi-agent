export interface Tool {
  name: string;
  description: string;
  input_schema: Record<string, any>;
}

export interface ToolResult {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | Array<any>;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: any[];
}

export interface SessionSummaryBlock {
  ts: string;
  from: number;
  to: number;
  content: string;
}

export interface AgentSession {
  id: string;
  messages: Message[];
  summaries: SessionSummaryBlock[];
  compressedCount: number;
}

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm: string;
}

export interface Task {
  id: number;
  subject: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'deleted';
  owner: string | null;
  blockedBy: number[];
  blocks: number[];
  worktree?: string | null;
}

export interface BackgroundTask {
  status: 'running' | 'completed' | 'error';
  command: string;
  result: string | null;
}

export interface BackgroundNotification {
  task_id: string;
  status: string;
  result: string;
}

export interface InboxMessage {
  type: string;
  from: string;
  content: string;
  timestamp: number;
  [key: string]: any;
}

export interface TeammateConfig {
  name: string;
  role: string;
  status: 'idle' | 'working' | 'shutdown';
}

export interface TeamConfig {
  team_name: string;
  members: TeammateConfig[];
}

export interface ShutdownRequest {
  target: string;
  status: 'pending' | 'approved' | 'rejected';
}

export interface PlanRequest {
  from: string;
  status: 'pending' | 'approved' | 'rejected';
  [key: string]: any;
}
