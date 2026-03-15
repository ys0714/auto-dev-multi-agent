import { TeammateManager } from '../application/services/teammate';
import { MessageBus } from '../application/services/message-bus';
import { TaskManager } from '../application/services/task-manager';
import { WorktreeManager } from '../application/services/worktree';
import { teammateLoop } from '../application/services/teammate-loop';
import { client } from '../infra/adapters/llm';
import { Command } from 'commander';
import path from 'path';

const program = new Command();

program
  .name('run-teammate')
  .description('Run a teammate loop in an isolated process')
  .requiredOption('--name <string>', 'Teammate name')
  .requiredOption('--role <string>', 'Teammate role')
  .requiredOption('--prompt <string>', 'Initial prompt')
  .option('--schema_path <string>', 'Path to a JSON Schema to enforce MapReduce structural output')
  .action(async (options) => {
    const bus = new MessageBus();
    const taskMgr = new TaskManager();
    const teamMgr = new TeammateManager(bus, taskMgr);
    // WorktreeManager requires a repoRoot, let's use current dir or WORKDIR
    const { WORKDIR, WORKTREE_EVENTS_PATH } = await import('../infra/config');
    const { EventBus } = await import('../application/services/worktree');
    
    const eventsBus = new EventBus(WORKTREE_EVENTS_PATH);
    const worktreeMgr = new WorktreeManager(WORKDIR, taskMgr, eventsBus);

    console.log(`Starting teammate [${options.name}] process...`);
    
    try {
      await teammateLoop(
        options.name,
        options.role,
        options.prompt,
        teamMgr,
        bus,
        taskMgr,
        worktreeMgr,
        client,
        options.schema_path
      );
      console.log(`Teammate [${options.name}] process exited gracefully.`);
      process.exit(0);
    } catch (err) {
      console.error(`Teammate [${options.name}] process crashed:`, err);
      process.exit(1);
    }
  });

program.parse(process.argv);
