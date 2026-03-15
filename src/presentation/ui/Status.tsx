import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

interface StatusProps {
  isProcessing: boolean;
  currentTool: string | null;
}

export const Status: React.FC<StatusProps> = ({ isProcessing, currentTool }) => {
  if (!isProcessing) return null;

  return (
    <Box marginTop={1}>
      <Text color="magenta">
        <Spinner type="dots" />
      </Text>
      <Box paddingLeft={1}>
        <Text color="magenta">
          {currentTool ? `Running tool: ${currentTool}...` : 'Agent is thinking...'}
        </Text>
      </Box>
    </Box>
  );
};
