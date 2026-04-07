import re

with open("src/app/page.tsx", "r") as f:
    content = f.read()

# 1. Update logo from NET.30 to Headhunt
# We'll use just "Head" and ".hunt" or just "Headhunt"
content = content.replace(
'''              <span className="font-heading text-[28px] tracking-tight">
                <span className="text-[#a0afbb]">NET</span>
                <span className="text-[#304f67]">.30</span>
              </span>''',
'''              <span className="font-heading text-[28px] tracking-tight">
                <span className="text-[#a0afbb]">Head</span>
                <span className="text-[#304f67]">hunt</span>
              </span>'''
)

# 2. Update the Org Dropdown labels
content = content.replace('''<span className="text-[11px] font-sans font-medium text-[#94a3b8] mb-[2px] tracking-wide truncate">Aerobox Workspace</span>''', '''<span className="text-[11px] font-sans font-medium text-[#94a3b8] mb-[2px] tracking-wide truncate">Acme Inc</span>''')
content = content.replace('''<span className="text-[14px] font-sans font-semibold text-[#334155] leading-none truncate block">Project Team</span>''', '''<span className="text-[14px] font-sans font-semibold text-[#334155] leading-none truncate block">Talent Org</span>''')

content = content.replace('''title={!isSidebarOpen ? "Aerobox Workspace" : undefined}''', '''title={!isSidebarOpen ? "Talent Org" : undefined}''')
content = content.replace('''<DropdownMenuLabel className="px-3 py-1.5 text-[10px] font-medium text-[#a0afbb] uppercase tracking-wider font-sans">Your Workspaces</DropdownMenuLabel>''', '''<DropdownMenuLabel className="px-3 py-1.5 text-[10px] font-medium text-[#a0afbb] uppercase tracking-wider font-sans">Organizations</DropdownMenuLabel>''')


# 3. Update the Nav items
old_nav = '''        {/* Navigation */}
        <nav className="flex-1 space-y-1 w-full flex flex-col pt-1">
          {isSidebarOpen && <div className="text-[11px] font-sans font-medium text-[#8e9caf] uppercase tracking-wider mb-2 px-3 py-1 mt-1">General</div>}
          {!isSidebarOpen && <div className="w-6 mx-auto border-t border-[#d6dce1] opacity-60 mb-3 mt-1" />}
          <NavItem onClick={() => setActiveScreen('dashboard')} icon={<Home size={18} />} label="Dashboard" active={activeScreen === 'dashboard'} isSidebarOpen={isSidebarOpen} />
          <NavItem onClick={() => setActiveScreen('assistant')} icon={<MessageSquare size={18} />} label="Assistant" active={activeScreen === 'assistant'} isSidebarOpen={isSidebarOpen} />
          <NavItem onClick={() => setActiveScreen('invoices')} icon={<Copy size={18} />} label="Invoices" active={activeScreen === 'invoices'} badge={4} isSidebarOpen={isSidebarOpen} />
          <NavItem onClick={() => setActiveScreen('pipeline')} icon={<CircleDollarSign size={18} />} label="Pipeline" active={activeScreen === 'pipeline'} isSidebarOpen={isSidebarOpen} />
          <NavItem onClick={() => setActiveScreen('clients')} icon={<Info size={18} />} label="Clients" active={activeScreen === 'clients'} isSidebarOpen={isSidebarOpen} />
          
          {isSidebarOpen && <div className="text-[11px] font-sans font-medium text-[#8e9caf] uppercase tracking-wider mb-2 px-3 py-1 mt-4">App & Settings</div>}
          {!isSidebarOpen && <div className="w-6 mx-auto border-t border-[#d6dce1] opacity-60 mb-3 mt-4" />}
          <NavItem onClick={() => setActiveScreen('agents')} icon={<Bot size={18} />} label="Agents" active={activeScreen === 'agents'} isSidebarOpen={isSidebarOpen} />
          <NavItem onClick={() => setActiveScreen('mcp')} icon={<Layers size={18} />} label="MCP Config" active={activeScreen === 'mcp'} isSidebarOpen={isSidebarOpen} />
          <NavItem onClick={() => setActiveScreen('security')} icon={<Shield size={18} />} label="Security" active={activeScreen === 'security'} isSidebarOpen={isSidebarOpen} />
        </nav>'''

new_nav = '''        {/* Navigation */}
        <nav className="flex-1 space-y-1 w-full flex flex-col pt-1">
          {isSidebarOpen && <div className="text-[11px] font-sans font-medium text-[#8e9caf] uppercase tracking-wider mb-2 px-3 py-1 mt-1">Recruiting</div>}
          {!isSidebarOpen && <div className="w-6 mx-auto border-t border-[#d6dce1] opacity-60 mb-3 mt-1" />}
          <NavItem onClick={() => setActiveScreen('dashboard')} icon={<Home size={18} />} label="Dashboard" active={activeScreen === 'dashboard'} isSidebarOpen={isSidebarOpen} />
          <NavItem onClick={() => setActiveScreen('jobs')} icon={<MessageSquare size={18} />} label="Jobs" active={activeScreen === 'jobs'} isSidebarOpen={isSidebarOpen} />
          <NavItem onClick={() => setActiveScreen('pipeline')} icon={<CircleDollarSign size={18} />} label="Pipeline" active={activeScreen === 'pipeline'} isSidebarOpen={isSidebarOpen} />
          <NavItem onClick={() => setActiveScreen('candidates')} icon={<Info size={18} />} label="Candidates" active={activeScreen === 'candidates'} isSidebarOpen={isSidebarOpen} />
          
          {isSidebarOpen && <div className="text-[11px] font-sans font-medium text-[#8e9caf] uppercase tracking-wider mb-2 px-3 py-1 mt-4">Workflows</div>}
          {!isSidebarOpen && <div className="w-6 mx-auto border-t border-[#d6dce1] opacity-60 mb-3 mt-4" />}
          <NavItem onClick={() => setActiveScreen('agents')} icon={<Bot size={18} />} label="Agents" active={activeScreen === 'agents'} isSidebarOpen={isSidebarOpen} />
          <NavItem onClick={() => setActiveScreen('approvals')} icon={<Copy size={18} />} label="Approvals" active={activeScreen === 'approvals'} badge={2} isSidebarOpen={isSidebarOpen} />
          <NavItem onClick={() => setActiveScreen('audit')} icon={<HistoryIcon size={18} />} label="Audit Trail" active={activeScreen === 'audit'} isSidebarOpen={isSidebarOpen} />

          {isSidebarOpen && <div className="text-[11px] font-sans font-medium text-[#8e9caf] uppercase tracking-wider mb-2 px-3 py-1 mt-4">Org & App</div>}
          {!isSidebarOpen && <div className="w-6 mx-auto border-t border-[#d6dce1] opacity-60 mb-3 mt-4" />}
          <NavItem onClick={() => setActiveScreen('team')} icon={<Users size={18} />} label="Team" active={activeScreen === 'team'} isSidebarOpen={isSidebarOpen} />
          <NavItem onClick={() => setActiveScreen('settings')} icon={<Settings size={18} />} label="Settings" active={activeScreen === 'settings'} isSidebarOpen={isSidebarOpen} />
        </nav>'''

content = content.replace(old_nav, new_nav)

with open("src/app/page.tsx", "w") as f:
    f.write(content)
