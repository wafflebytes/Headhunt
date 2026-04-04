import type { JWTPayload } from 'jose';

export type McpSessionAuth = {
  userId: string;
  orgId?: string;
  roles: string[];
  scope: string[];
  token: string;
  claims: JWTPayload;
};
