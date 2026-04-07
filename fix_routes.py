import re

with open("src/app/page.tsx", "r") as f:
    text = f.read()

old_routes = """const SCREEN_TO_ROUTE: Record<string, string> = {
  dashboard: '/',
  assistant: '/assistant',
  invoices: '/invoices',
  pipeline: '/pipeline',
  clients: '/clients',
  agents: '/agents',
  mcp: '/mcp',
  security: '/security',
};

const ROUTE_TO_SCREEN: Record<string, string> = {
  '/': 'dashboard',
  '/assistant': 'assistant',
  '/invoices': 'invoices',
  '/pipeline': 'pipeline',
  '/clients': 'clients',
  '/agents': 'agents',
  '/mcp': 'mcp',
  '/security': 'security',
};"""

new_routes = """const SCREEN_TO_ROUTE: Record<string, string> = {
  dashboard: '/',
  jobs: '/jobs',
  pipeline: '/pipeline',
  candidates: '/candidates',
  agents: '/agents',
  approvals: '/approvals',
  audit: '/audit',
  team: '/team',
  settings: '/settings',
};

const ROUTE_TO_SCREEN: Record<string, string> = {
  '/': 'dashboard',
  '/jobs': 'jobs',
  '/pipeline': 'pipeline',
  '/candidates': 'candidates',
  '/agents': 'agents',
  '/approvals': 'approvals',
  '/audit': 'audit',
  '/team': 'team',
  '/settings': 'settings',
};"""

text = text.replace(old_routes, new_routes)

with open("src/app/page.tsx", "w") as f:
    f.write(text)
