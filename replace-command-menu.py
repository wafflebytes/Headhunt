with open("src/app/page.tsx", "r") as f:
    content = f.read()

import_statement = """import { 
  ResponsiveDialog, 
  ResponsiveDialogContent, 
  ResponsiveDialogHeader, 
  ResponsiveDialogTitle 
} from '@/components/ui/revola';
import { 
  ResponsiveCommand, 
  ResponsiveCommandInput, 
  ResponsiveCommandList, 
  ResponsiveCommandEmpty, 
  ResponsiveCommandGroup, 
  ResponsiveCommandItem 
} from '@/components/ui/responsive-command';\n"""

# find import section
imports_end = content.find("type PendingApprovalDoc")
content = content[:imports_end] + import_statement + content[imports_end:]

# replace components/cmdk.css
content = content.replace("import '@/components/cmdk.css';", "")
content = content.replace("import { Command } from 'cmdk';", "")


# replace the command block

start_marker = "{/* Command Center Overlay Using native cmdk */}"
end_marker = "</Command.Dialog>"

start_idx = content.find(start_marker)
end_idx = content.find(end_marker) + len(end_marker)

replacement = """{/* Command Center Overlay Using Revola's Responsive Command */}
      <ResponsiveDialog open={showCommandCenter} onOpenChange={setShowCommandCenter}>
        <ResponsiveDialogContent
          showCloseButton={false}
          className="overflow-hidden rounded-2xl border-none bg-white p-2 shadow-2xl ring-1 ring-black/5 sm:rounded-xl max-w-[640px] pt-2"
        >
          <ResponsiveDialogHeader className="sr-only">
            <ResponsiveDialogTitle>Command Menu</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          
          <ResponsiveCommand className="rounded-none bg-transparent [&_[cmdk-input-wrapper]]:mb-0 [&_[cmdk-input-wrapper]]:h-12 [&_[cmdk-input-wrapper]]:rounded-lg [&_[cmdk-input-wrapper]]:border-none [&_[cmdk-input-wrapper]]:bg-transparent [&_[cmdk-input-wrapper]]:px-2 [&_[cmdk-input]]:h-12 [&_[cmdk-input]]:py-0 [&_[cmdk-input]]:text-base [&_[cmdk-input]]:text-[#334155]">
            <ResponsiveCommandInput placeholder="Type a command or search..." className="border-b border-[#e2e8f0] font-sans" />
            <ResponsiveCommandList className="min-h-[300px] max-h-[400px] scroll-pb-1.5 scroll-pt-2 custom-scrollbar">
              <ResponsiveCommandEmpty className="py-12 text-center text-sm text-[#94a3b8] font-sans">
                No results found.
              </ResponsiveCommandEmpty>

              <ResponsiveCommandGroup heading="Navigate" className="!p-0 [&_[cmdk-group-heading]]:font-sans [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-[#a0afbb] [&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-2 pt-2">
                <ResponsiveCommandItem onSelect={() => { setActiveScreen('dashboard'); setShowCommandCenter(false); }} className="mx-2 mb-1 px-3 py-2.5 h-10 rounded-[8px] border border-transparent font-medium text-[13px] text-[#334155] data-[selected=true]:bg-[#f4f6f8] data-[selected=true]:border-[#e2e8f0] cursor-pointer transition-colors">Dashboard</ResponsiveCommandItem>
                <ResponsiveCommandItem onSelect={() => { setActiveScreen('pipeline'); setShowCommandCenter(false); }} className="mx-2 mb-1 px-3 py-2.5 h-10 rounded-[8px] border border-transparent font-medium text-[13px] text-[#334155] data-[selected=true]:bg-[#f4f6f8] data-[selected=true]:border-[#e2e8f0] cursor-pointer transition-colors">Pipeline</ResponsiveCommandItem>
                <ResponsiveCommandItem onSelect={() => { setActiveScreen('jobs'); setShowCommandCenter(false); }} className="mx-2 mb-1 px-3 py-2.5 h-10 rounded-[8px] border border-transparent font-medium text-[13px] text-[#334155] data-[selected=true]:bg-[#f4f6f8] data-[selected=true]:border-[#e2e8f0] cursor-pointer transition-colors">Jobs</ResponsiveCommandItem>
                <ResponsiveCommandItem onSelect={() => { setActiveScreen('candidates'); setShowCommandCenter(false); }} className="mx-2 mb-1 px-3 py-2.5 h-10 rounded-[8px] border border-transparent font-medium text-[13px] text-[#334155] data-[selected=true]:bg-[#f4f6f8] data-[selected=true]:border-[#e2e8f0] cursor-pointer transition-colors">Candidates</ResponsiveCommandItem>
                <ResponsiveCommandItem onSelect={() => { setActiveScreen('approvals'); setShowCommandCenter(false); }} className="mx-2 mb-1 px-3 py-2.5 h-10 rounded-[8px] border border-transparent font-medium text-[13px] text-[#334155] data-[selected=true]:bg-[#f4f6f8] data-[selected=true]:border-[#e2e8f0] cursor-pointer transition-colors">Approvals</ResponsiveCommandItem>
                <ResponsiveCommandItem onSelect={() => { setActiveScreen('audit'); setShowCommandCenter(false); }} className="mx-2 mb-1 px-3 py-2.5 h-10 rounded-[8px] border border-transparent font-medium text-[13px] text-[#334155] data-[selected=true]:bg-[#f4f6f8] data-[selected=true]:border-[#e2e8f0] cursor-pointer transition-colors">Audit Trail</ResponsiveCommandItem>
              </ResponsiveCommandGroup>

              <ResponsiveCommandGroup heading="Candidate Actions" className="!p-0 [&_[cmdk-group-heading]]:font-sans [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-[#a0afbb] [&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-2 pt-2 border-t border-[#e2e8f0]/40 mt-1">
                <ResponsiveCommandItem onSelect={() => setShowCommandCenter(false)} className="mx-2 mb-1 px-3 py-2.5 h-10 rounded-[8px] border border-transparent font-medium text-[13px] text-[#334155] data-[selected=true]:bg-[#f4f6f8] data-[selected=true]:border-[#e2e8f0] cursor-pointer transition-colors">Open candidate by name/id</ResponsiveCommandItem>
              </ResponsiveCommandGroup>

              <ResponsiveCommandGroup heading="Scheduling" className="!p-0 [&_[cmdk-group-heading]]:font-sans [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-[#a0afbb] [&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-2 pt-2 border-t border-[#e2e8f0]/40 mt-1">
                <ResponsiveCommandItem onSelect={() => setShowCommandCenter(false)} className="mx-2 mb-1 px-3 py-2.5 h-10 rounded-[8px] border border-transparent font-medium text-[13px] text-[#334155] data-[selected=true]:bg-[#f4f6f8] data-[selected=true]:border-[#e2e8f0] cursor-pointer transition-colors">Schedule next round</ResponsiveCommandItem>
                <ResponsiveCommandItem onSelect={() => setShowCommandCenter(false)} className="mx-2 mb-1 px-3 py-2.5 h-10 rounded-[8px] border border-transparent font-medium text-[13px] text-[#334155] data-[selected=true]:bg-[#f4f6f8] data-[selected=true]:border-[#e2e8f0] cursor-pointer transition-colors">Propose interview slots</ResponsiveCommandItem>
                <ResponsiveCommandItem onSelect={() => setShowCommandCenter(false)} className="mx-2 mb-1 px-3 py-2.5 h-10 rounded-[8px] border border-transparent font-medium text-[13px] text-[#334155] data-[selected=true]:bg-[#f4f6f8] data-[selected=true]:border-[#e2e8f0] cursor-pointer transition-colors">Analyze scheduling reply</ResponsiveCommandItem>
              </ResponsiveCommandGroup>

              <ResponsiveCommandGroup heading="Offers + Approvals" className="!p-0 [&_[cmdk-group-heading]]:font-sans [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-[#a0afbb] [&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-2 pt-2 border-t border-[#e2e8f0]/40 mt-1">
                <ResponsiveCommandItem onSelect={() => setShowCommandCenter(false)} className="mx-2 mb-1 px-3 py-2.5 h-10 rounded-[8px] border border-transparent font-medium text-[13px] text-[#334155] data-[selected=true]:bg-[#f4f6f8] data-[selected=true]:border-[#e2e8f0] cursor-pointer transition-colors">Draft offer</ResponsiveCommandItem>
                <ResponsiveCommandItem onSelect={() => setShowCommandCenter(false)} className="mx-2 mb-1 px-3 py-2.5 h-10 rounded-[8px] border border-transparent font-medium text-[13px] text-[#334155] data-[selected=true]:bg-[#f4f6f8] data-[selected=true]:border-[#e2e8f0] cursor-pointer transition-colors">Submit for founder approval</ResponsiveCommandItem>
                <ResponsiveCommandItem onSelect={() => setShowCommandCenter(false)} className="mx-2 mb-1 px-3 py-2.5 h-10 rounded-[8px] border border-transparent font-medium text-[13px] text-[#334155] data-[selected=true]:bg-[#f4f6f8] data-[selected=true]:border-[#e2e8f0] cursor-pointer transition-colors">Poll approval status</ResponsiveCommandItem>
              </ResponsiveCommandGroup>

              <ResponsiveCommandGroup heading="Agent Actions" className="!p-0 [&_[cmdk-group-heading]]:font-sans [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-[#a0afbb] [&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-2 pt-2 border-t border-[#e2e8f0]/40 mt-1">
                <ResponsiveCommandItem onSelect={() => setShowCommandCenter(false)} className="mx-2 mb-1 px-3 py-2.5 h-10 rounded-[8px] border border-transparent font-medium text-[13px] text-[#334155] data-[selected=true]:bg-[#f4f6f8] data-[selected=true]:border-[#e2e8f0] cursor-pointer transition-colors">Wake Triage agent</ResponsiveCommandItem>
                <ResponsiveCommandItem onSelect={() => setShowCommandCenter(false)} className="mx-2 mb-1 px-3 py-2.5 h-10 rounded-[8px] border border-transparent font-medium text-[13px] text-[#334155] data-[selected=true]:bg-[#f4f6f8] data-[selected=true]:border-[#e2e8f0] cursor-pointer transition-colors">Wake Analyst agent</ResponsiveCommandItem>
              </ResponsiveCommandGroup>

              <ResponsiveCommandGroup heading="Team + Organization" className="!p-0 [&_[cmdk-group-heading]]:font-sans [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-[#a0afbb] [&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-2 pt-2 border-t border-[#e2e8f0]/40 mt-1">
                <ResponsiveCommandItem onSelect={() => setShowCommandCenter(false)} className="mx-2 mb-1 px-3 py-2.5 h-10 rounded-[8px] border border-transparent font-medium text-[13px] text-[#334155] data-[selected=true]:bg-[#f4f6f8] data-[selected=true]:border-[#e2e8f0] cursor-pointer transition-colors">Invite team member</ResponsiveCommandItem>
                <ResponsiveCommandItem onSelect={() => setShowCommandCenter(false)} className="mx-2 mb-1 px-3 py-2.5 h-10 rounded-[8px] border border-transparent font-medium text-[13px] text-[#334155] data-[selected=true]:bg-[#f4f6f8] data-[selected=true]:border-[#e2e8f0] cursor-pointer transition-colors">Switch organization</ResponsiveCommandItem>
              </ResponsiveCommandGroup>

              <ResponsiveCommandGroup heading="Integrations + Connections" className="!p-0 [&_[cmdk-group-heading]]:font-sans [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-[#a0afbb] [&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-2 pt-2 border-t border-[#e2e8f0]/40 mt-1 mb-2">
                <ResponsiveCommandItem onSelect={() => setShowCommandCenter(false)} className="mx-2 mb-1 px-3 py-2.5 h-10 rounded-[8px] border border-transparent font-medium text-[13px] text-[#334155] data-[selected=true]:bg-[#f4f6f8] data-[selected=true]:border-[#e2e8f0] cursor-pointer transition-colors">Open MCP settings</ResponsiveCommandItem>
                <ResponsiveCommandItem onSelect={() => setShowCommandCenter(false)} className="mx-2 mb-1 px-3 py-2.5 h-10 rounded-[8px] border border-transparent font-medium text-[13px] text-[#334155] data-[selected=true]:bg-[#f4f6f8] data-[selected=true]:border-[#e2e8f0] cursor-pointer transition-colors">Copy MCP endpoint instructions</ResponsiveCommandItem>
              </ResponsiveCommandGroup>
            </ResponsiveCommandList>
          </ResponsiveCommand>
        </ResponsiveDialogContent>
      </ResponsiveDialog>"""

content = content[:start_idx] + replacement + content[end_idx:]

with open("src/app/page.tsx", "w") as f:
    f.write(content)
