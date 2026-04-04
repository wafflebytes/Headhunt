import { FastMCP } from 'fastmcp';

import { createAuth0Authenticator } from './auth';
import { registerHeadhuntMcpTools } from './tools';
import type { McpSessionAuth } from './types';

function normalizeEndpoint(value: string | undefined): `/${string}` {
  const trimmed = value?.trim();
  if (!trimmed) {
    return '/mcp';
  }

  return (trimmed.startsWith('/') ? trimmed : `/${trimmed}`) as `/${string}`;
}

function resolveTransportType(rawValue: string | undefined): 'httpStream' | 'stdio' {
  const normalized = rawValue?.trim().toLowerCase();
  if (!normalized) {
    return 'httpStream';
  }

  if (normalized === 'stdio') {
    return 'stdio';
  }

  if (normalized === 'httpstream' || normalized === 'http-stream') {
    return 'httpStream';
  }

  throw new Error(`Invalid MCP transport type: ${rawValue}`);
}

function resolvePort(rawValue: string | undefined): number {
  const normalized = rawValue?.trim();
  if (!normalized) {
    return 8080;
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid MCP_PORT value: ${rawValue}`);
  }

  return parsed;
}

function resolveBoolean(rawValue: string | undefined): boolean | undefined {
  const normalized = rawValue?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (normalized === 'true') {
    return true;
  }

  if (normalized === 'false') {
    return false;
  }

  throw new Error(`Invalid boolean value: ${rawValue}`);
}

export function createHeadhuntMcpServer() {
  const server = new FastMCP<McpSessionAuth>({
    authenticate: createAuth0Authenticator(),
    health: {
      enabled: true,
      message: 'ok',
      path: '/health',
      status: 200,
    },
    instructions:
      'Headhunt recruiting MCP server. Use these tools to inspect jobs, pipeline, candidate details, and high-level funnel health.',
    name: 'headhunt-mcp',
    version: '1.0.0',
  });

  registerHeadhuntMcpTools(server);
  return server;
}

export function resolveServerStartOptions() {
  const transportType = resolveTransportType(
    process.env.MCP_TRANSPORT ?? process.env.FASTMCP_TRANSPORT,
  );

  if (transportType === 'stdio') {
    return {
      transportType: 'stdio' as const,
    };
  }

  const stateless = resolveBoolean(process.env.MCP_STATELESS ?? process.env.FASTMCP_STATELESS);
  const options = {
    httpStream: {
      endpoint: normalizeEndpoint(process.env.MCP_ENDPOINT ?? process.env.FASTMCP_ENDPOINT),
      host: process.env.MCP_HOST?.trim() || process.env.FASTMCP_HOST?.trim() || '0.0.0.0',
      port: resolvePort(process.env.MCP_PORT ?? process.env.FASTMCP_PORT),
      ...(stateless === undefined ? {} : { stateless }),
    },
    transportType: 'httpStream' as const,
  };

  return options;
}
