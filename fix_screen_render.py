import re

with open("src/app/page.tsx", "r") as f:
    text = f.read()

old_block = """            {activeScreen === 'pipeline' && (
              <PipelineScreen />
            )}

            {activeScreen === 'assistant' && (
              <AssistantScreen />
            )}

            {activeScreen === 'clients' && (
              <ClientsScreen />
            )}

            {activeScreen === 'invoices' && (
              <InvoicesScreen />
            )}

            {activeScreen === 'agents' && (
              <AgentsScreen />
            )}

            {activeScreen === 'mcp' && (
              <MCPScreen />
            )}

            {activeScreen === 'security' && (
              <SecurityScreen />
            )}

            {activeScreen !== 'dashboard' && activeScreen !== 'pipeline' && activeScreen !== 'invoices' && activeScreen !== 'clients' && activeScreen !== 'agents' && activeScreen !== 'mcp' && activeScreen !== 'security' && activeScreen !== 'assistant' && (
              <div className="w-full h-full min-h-[400px] flex items-center justify-center flex-col text-[#94a3b8]">
                <div className="text-[48px] font-heading tracking-tight text-[#cbd5e1] capitalize mb-3">
                  {activeScreen} View
                </div>
                <p className="font-sans text-[#64748b] text-center max-w-sm">
                  This layout is perfectly restored to the HTML prototype structure while keeping the skeuomorphic Light Mode aesthetics.
                </p>
              </div>
            )}"""

new_block = """            {activeScreen === 'pipeline' && (
              <PipelineScreen />
            )}
            
            {activeScreen === 'jobs' && (
              <JobsScreen />
            )}

            {activeScreen === 'candidates' && (
              <CandidatesScreen />
            )}

            {activeScreen === 'approvals' && (
              <ApprovalsScreen />
            )}

            {activeScreen === 'audit' && (
              <AuditScreen />
            )}

            {activeScreen === 'team' && (
              <TeamScreen />
            )}

            {activeScreen === 'settings' && (
              <SettingsScreen />
            )}

            {activeScreen === 'agents' && (
              <AgentsScreen />
            )}

            {activeScreen !== 'dashboard' && activeScreen !== 'pipeline' && activeScreen !== 'jobs' && activeScreen !== 'candidates' && activeScreen !== 'approvals' && activeScreen !== 'audit' && activeScreen !== 'team' && activeScreen !== 'settings' && activeScreen !== 'agents' && (
              <div className="w-full h-full min-h-[400px] flex items-center justify-center flex-col text-[#94a3b8]">
                <div className="text-[48px] font-heading tracking-tight text-[#cbd5e1] capitalize mb-3">
                  {activeScreen} View
                </div>
                <p className="font-sans text-[#64748b] text-center max-w-sm">
                  This layout is perfectly restored to the HTML prototype structure while keeping the skeuomorphic Light Mode aesthetics.
                </p>
              </div>
            )}"""

text = text.replace(old_block, new_block)

with open("src/app/page.tsx", "w") as f:
    f.write(text)
