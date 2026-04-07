import re

with open("src/app/page.tsx", "r") as f:
    text = f.read()

# Add placeholder stubs at the end of the file or replace old unused ones
# Instead of deleting old ones (which is risky if large), I will just append the new stubs before the final brace? No, they are just functions. Let's just append them to the very end of the file.

new_funcs = """
function JobsScreen() {
  return (
    <div className="w-full h-full min-h-[400px] flex items-center justify-center flex-col text-[#94a3b8]">
      <div className="text-[48px] font-heading tracking-tight text-[#cbd5e1] capitalize mb-3">Jobs View</div>
      <p className="font-sans text-[#64748b] text-center max-w-sm">Manage open requisitions and job descriptions here.</p>
    </div>
  );
}

function CandidatesScreen() {
  return (
    <div className="w-full h-full min-h-[400px] flex items-center justify-center flex-col text-[#94a3b8]">
      <div className="text-[48px] font-heading tracking-tight text-[#cbd5e1] capitalize mb-3">Candidates View</div>
      <p className="font-sans text-[#64748b] text-center max-w-sm">Detailed candidate workbench and scoring.</p>
    </div>
  );
}

function ApprovalsScreen() {
  return (
    <div className="w-full h-full min-h-[400px] flex items-center justify-center flex-col text-[#94a3b8]">
      <div className="text-[48px] font-heading tracking-tight text-[#cbd5e1] capitalize mb-3">Approvals View</div>
      <p className="font-sans text-[#64748b] text-center max-w-sm">Pending Auth0 CIBA approvals for offer letters.</p>
    </div>
  );
}

function AuditScreen() {
  return (
    <div className="w-full h-full min-h-[400px] flex items-center justify-center flex-col text-[#94a3b8]">
      <div className="text-[48px] font-heading tracking-tight text-[#cbd5e1] capitalize mb-3">Audit Trail</div>
      <p className="font-sans text-[#64748b] text-center max-w-sm">System audit events and history.</p>
    </div>
  );
}

function TeamScreen() {
  return (
    <div className="w-full h-full min-h-[400px] flex items-center justify-center flex-col text-[#94a3b8]">
      <div className="text-[48px] font-heading tracking-tight text-[#cbd5e1] capitalize mb-3">Team View</div>
      <p className="font-sans text-[#64748b] text-center max-w-sm">Manage team members and HR invites.</p>
    </div>
  );
}

function SettingsScreen() {
  return (
    <div className="w-full h-full min-h-[400px] flex items-center justify-center flex-col text-[#94a3b8]">
      <div className="text-[48px] font-heading tracking-tight text-[#cbd5e1] capitalize mb-3">Settings View</div>
      <p className="font-sans text-[#64748b] text-center max-w-sm">Organization defaults, agent settings, and connections.</p>
    </div>
  );
}
"""

with open("src/app/page.tsx", "a") as f:
    f.write(new_funcs)

