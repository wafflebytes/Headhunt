'use client';

import { Agentation } from 'agentation';
import { useEffect, useState } from 'react';

/**
 * AgentationProvider
 * 
 * Provides the Agentation annotation UI in development mode.
 * Connects to the local Agentation MCP server on port 4747.
 */
export default function AgentationProvider() {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Avoid SSR issues with DOM-heavy component
  if (!isMounted) return null;

  // Only show Agentation in development
  if (process.env.NODE_ENV !== 'development') {
    return null;
  }

  return (
    <Agentation
      endpoint="http://localhost:4747"
      onSessionCreated={(sessionId) => {
        console.log('[Agentation] Session started:', sessionId);
      }}
    />
  );
}
