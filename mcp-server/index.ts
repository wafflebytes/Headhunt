import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

async function main() {
  const { createHeadhuntMcpServer, resolveServerStartOptions } = await import('./server');
  const server = createHeadhuntMcpServer();
  const startOptions = resolveServerStartOptions();

  const shutdown = async (signal: string) => {
    console.info(`[headhunt-mcp] Received ${signal}. Stopping MCP server...`);
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  await server.start(startOptions);

  if (startOptions.transportType === 'httpStream') {
    const host = startOptions.httpStream.host ?? 'localhost';
    const port = startOptions.httpStream.port;
    const endpoint = startOptions.httpStream.endpoint ?? '/mcp';
    console.info(
      `[headhunt-mcp] HTTP Stream transport ready at http://${host}:${port}${endpoint}`,
    );
    return;
  }

  console.info('[headhunt-mcp] stdio transport ready.');
}

void main().catch((error) => {
  console.error('[headhunt-mcp] startup failed', error);
  process.exit(1);
});
