import React from 'react';
import { render } from 'ink';
import path from 'path';
import { Agent } from '../application/agent';
import { ConsoleLogger } from '../infra/adapters/logger';
import { TodoManager } from '../application/services/todo-manager';
import { SkillLoader } from '../application/services/skill-loader';
import { TaskManager } from '../application/services/task-manager';
import { BackgroundManager } from '../application/services/background';
import { MessageBus } from '../application/services/message-bus';
import { TeammateManager } from '../application/services/teammate';
import { WorktreeManager, EventBus } from '../application/services/worktree';
import { ProfileManager } from '../application/services/profile-manager';
import { SessionManager } from '../application/services/session-manager';
import { initSubscribers } from '../application/subscribers';
import { eventBus } from '../domain/event-bus';
import { Message, PlanRequest } from '../domain/types';
import { WORKDIR, WORKTREE_EVENTS_PATH } from '../infra/config';
import { App } from './ui/App';

async function main() {
  // Initialize services
  const sharedPlanRegistry: Record<string, PlanRequest> = {};
  const todo = new TodoManager();
  const skills = new SkillLoader();
  const taskMgr = new TaskManager();
  const bg = new BackgroundManager();
  const bus = new MessageBus();
  const team = new TeammateManager(bus, taskMgr, sharedPlanRegistry);

  // Initialize profile manager
  const profile = new ProfileManager();
  
  // Initialize session manager
  const sessionManager = new SessionManager();

  // Initialize event subscribers BEFORE anything else
  initSubscribers();

  // Parse CLI args for --resume
  const args = process.argv.slice(2);
  let session: any = null;

  if (args.includes('--resume')) {
    try {
      session = await sessionManager.loadLatest();
      if (!session) {
        session = sessionManager.createSession();
      }
    } catch (e: any) {
      session = sessionManager.createSession();
    }
  } else {
    session = sessionManager.createSession();
  }

  // Publish agent:start after session is created/resumed
  eventBus.publish({ type: 'agent:start', sessionId: session.id } as any);

  // Initialize logger
  const logger = new ConsoleLogger();

  const eventsBus = new EventBus(WORKTREE_EVENTS_PATH);
  const worktreeMgr = new WorktreeManager(WORKDIR, taskMgr, eventsBus);

  // Initialize agent
  const agent = new Agent(todo, skills, taskMgr, bg, bus, team, worktreeMgr, eventsBus, profile, sharedPlanRegistry);

  const { unmount, clear } = render(
    <App 
      agent={agent} 
      initialSession={session} 
      sessionManager={sessionManager} 
      taskMgr={taskMgr}
      team={team}
      bus={bus}
      onExit={() => {
        eventBus.publish({ type: 'agent:stop' });
        clear();
        unmount();
        process.exit(0);
      }} 
    />
  );
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
