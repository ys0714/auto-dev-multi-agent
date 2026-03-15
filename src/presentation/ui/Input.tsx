import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

interface InputProps {
  onSubmit: (query: string) => void;
}

export const Input: React.FC<InputProps> = ({ onSubmit }) => {
  const [query, setQuery] = useState('');

  const handleSubmit = () => {
    onSubmit(query);
    setQuery('');
  };

  return (
    <Box>
      <Text color="yellow" bold>{'s_full >> '}</Text>
      <Box paddingLeft={1}>
        <TextInput
          value={query}
          onChange={setQuery}
          onSubmit={handleSubmit}
          placeholder="Type your message... (/tasks, /team, q)"
        />
      </Box>
    </Box>
  );
};
