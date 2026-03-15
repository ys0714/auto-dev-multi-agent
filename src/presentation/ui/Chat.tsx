import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { Message } from '../../domain/types';

interface ChatProps {
  history: Message[];
}

export const Chat: React.FC<ChatProps> = ({ history }) => {
  // Only display the last few messages to prevent terminal clutter
  const visibleHistory = history.slice(-20);

  return (
    <Box flexDirection="column">
      {visibleHistory.map((msg, index) => {
        let name = '';
        let color = '';

        if (msg.role === 'user') {
          name = 'You';
          color = 'green';
        } else if (msg.role === 'assistant') {
          name = 'Agent';
          color = 'blue';
        } else {
          name = 'System';
          color = 'gray';
        }

        // Handle array of blocks (Tool calls/results) in assistant/user messages
        if (Array.isArray(msg.content)) {
          const blocks = msg.content.map((block, bIndex) => {
            const blockId = `${index}-${bIndex}`;
            
            if (block.type === 'text') {
              return <Text key={blockId}>{block.text}</Text>;
            }
            
            if (block.type === 'tool_use') {
              return <Text color="yellow" key={blockId}>[Tool Use: {block.name}]</Text>;
            }
            
            if (block.type === 'tool_result') {
              const content = typeof block.content === 'string' ? block.content : JSON.stringify(block.content, null, 2);
              
              // Instead of making it clickable (which requires complex mouse event handling in terminal),
              // we display a truncated preview of the actual output along with the ID.
              const maxLen = 300;
              const preview = content.length > maxLen ? content.slice(0, maxLen) + '\n... (truncated)' : content;
              
              return (
                <Box key={blockId} flexDirection="column" marginLeft={2} paddingLeft={1} borderStyle="single" borderColor="gray">
                  <Text color="gray">Tool Result ({block.tool_use_id}):</Text>
                  <Text dimColor>{preview}</Text>
                </Box>
              );
            }
            
            return <Text key={blockId}>[Complex Block]</Text>;
          });

          return (
            <Box key={index} flexDirection="column" marginBottom={1}>
              <Text color={color} bold>{name}:</Text>
              {blocks}
            </Box>
          );
        }

        // String content
        if (!msg.content) return null;

        return (
          <Box key={index} flexDirection="column" marginBottom={1}>
            <Text color={color} bold>{name}:</Text>
            <Text>{msg.content as string}</Text>
          </Box>
        );
      })}
    </Box>
  );
};
