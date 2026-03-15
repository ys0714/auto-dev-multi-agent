import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { Chat } from './Chat';
import { Input } from './Input';
import { Status } from './Status';
import { Message, AgentSession } from '../../domain/types';
import { Agent } from '../../application/agent';
import { eventBus } from '../../domain/event-bus';
import { SessionManager } from '../../application/services/session-manager';
import { autoCompact } from '../../infra/adapters/compression';
import { client } from '../../infra/adapters/llm';

interface AppProps {
  agent: Agent;
  initialSession: AgentSession;
  sessionManager: SessionManager;
  onExit: () => void;
  taskMgr: any;
  team: any;
  bus: any;
}

export const App: React.FC<AppProps> = ({ agent, initialSession, sessionManager, onExit, taskMgr, team, bus }) => {
  const [session, setSession] = useState<AgentSession>(initialSession);
  const history = session.messages;
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentTool, setCurrentTool] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = eventBus.subscribe((event) => {
      if (event.type === 'tool:call') {
        setCurrentTool(event.tool);
      } else if (event.type === 'tool:result') {
        setCurrentTool(null);
      } else if (event.type === 'message:sent') {
        // Only react to events if they belong to current session
        // Actually, we are updating state in place via agent, but we can sync here
        const msg: Message = { role: event.role as any, content: event.content };
        setSession(prev => {
          const next = { ...prev, messages: [...prev.messages, msg] };
          sessionManager.save(next).catch(console.error);
          return next;
        });
      } else if (event.type === 'system:message') {
        setSession(prev => ({
          ...prev,
          messages: [...prev.messages, { role: 'assistant', content: event.message }]
        }));
      }
    });

    return () => {
      unsubscribe();
    };
  }, [session.id, sessionManager]);

  const handleSubmit = async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;

    if (['q', 'exit', 'quit'].includes(trimmed.toLowerCase())) {
      onExit();
      return;
    }

    if (trimmed === '/compact') {
      if (session.messages.length > 0) {
        setSession(prev => ({
          ...prev,
          messages: [...prev.messages, { role: 'system', content: '[manual compact via /compact]' } as any]
        }));
        try {
          // Since autoCompact now returns a Message array, let's update it to modify session in place
          // like compactSessionContext does, or keep the return value for the UI state.
          // Actually, let's just trigger a forced compaction via the new mechanism if we can.
          // But autoCompact uses LLM to summarize the entire history. It's a different approach (deep summarize).
          // We'll leave it as is for the `/compact` command, just updating the signature.
          const newHistory = await autoCompact(session, client);
          setSession(prev => {
            const next = { ...prev, messages: newHistory };
            sessionManager.save(next);
            return next;
          });
        } catch (e: any) {
          setSession(prev => ({
            ...prev,
            messages: [...prev.messages, { role: 'system', content: `Error compacting: ${e.message}` } as any]
          }));
        }
      }
      return;
    }

    if (trimmed === '/tasks') {
      const tasksInfo = taskMgr.listAll();
      setSession(prev => ({
        ...prev,
        messages: [...prev.messages, { role: 'system', content: tasksInfo } as any]
      }));
      return;
    }

    if (trimmed === '/team') {
      const teamInfo = team.listAll();
      setSession(prev => ({
        ...prev,
        messages: [...prev.messages, { role: 'system', content: teamInfo } as any]
      }));
      return;
    }

    if (trimmed === '/inbox') {
      const inboxInfo = JSON.stringify(bus.readInbox('lead'), null, 2);
      setSession(prev => ({
        ...prev,
        messages: [...prev.messages, { role: 'system', content: inboxInfo } as any]
      }));
      return;
    }

    const newUserMsg: Message = { role: 'user', content: trimmed };
    const updatedSession = { ...session, messages: [...session.messages, newUserMsg] };
    
    // Set immediate state so user sees their message
    setSession(updatedSession);
    setIsProcessing(true);

    try {
      await agent.loop(updatedSession);
      // after loop, session is modified in place in agent.loop!
      setSession({ ...updatedSession });
      await sessionManager.save(updatedSession);
    } catch (e: any) {
      setSession(prev => ({
        ...prev,
        messages: [...prev.messages, { role: 'system', content: `Error: ${e.message}` } as any]
      }));
    } finally {
      setIsProcessing(false);
      setCurrentTool(null);
    }
  };

  return (
    <Box flexDirection="column" minHeight={10}>
      <Box paddingBottom={1}>
        <Text color="cyan" bold>TypeScript Full Agent Reference Implementation (Ink UI)</Text>
      </Box>

      <Chat history={history} />
      
      <Status isProcessing={isProcessing} currentTool={currentTool} />

      <Box marginTop={1}>
        {!isProcessing ? (
          <Input onSubmit={handleSubmit} />
        ) : (
          <Text color="gray">Agent is thinking...</Text>
        )}
      </Box>
    </Box>
  );
};
