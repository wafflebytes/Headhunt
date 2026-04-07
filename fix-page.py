import re

with open('src/app/page.tsx', 'r') as f:
    text = f.read()

# 1. Color replacement
colors = {
    '#0ea5e9': '#e18131', # primary brand
    '#0284c7': '#c2410c', # darker
    '#38bdf8': '#fba94c', # lighter
    '#1d4ed8': '#b45309', # active text
    '#bfdbfe': '#fed7aa', # active border
    '#eff6ff': '#fffbeb', # active bg
    '#2563eb': '#d97706', # focus
    '#0369a1': '#9a3412',
    '#e0f2fe': '#ffedd5',
    '#dbeafe': '#ffedd5',
}

for old, new in colors.items():
    text = text.replace(old, new)
    text = text.replace(old.upper(), new)

# 2. Candidate screen UI fixes
candidate_old = """            <div className="col-span-2 flex items-center gap-[2px]">
              {candidate.confidence.map((point, index) => (
                <div key={`${candidate.id}-${index}`} className={cn('w-[6px] h-3.5 rounded-sm', point ? 'bg-[#22c55e]' : 'bg-[#cbd5e1]')} />
              ))}
            </div>
            <div className="col-span-1 text-right text-[13px] text-[#0f172a] font-medium">{candidate.score}</div>
            <div className="col-span-2 text-[12px] text-[#64748b] capitalize">{candidate.stage.replace('_', ' ')}</div>
            <div className="col-span-2 flex items-center justify-end gap-2">
              <span className="text-[12px] text-[#64748b]">{candidate.owner}</span>
              <ArrowRight size={15} className="text-[#94a3b8] opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>"""

candidate_new = """            <div className="col-span-2 flex items-center justify-start pr-4">
              <div className="w-full bg-[#f1f5f9] rounded-full h-2 shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)] max-w-[100px] overflow-hidden">
                <div 
                  className={cn("h-full rounded-full transition-all duration-500", candidate.score > 85 ? "bg-[#10b981]" : candidate.score > 75 ? "bg-[#f59e0b]" : "bg-[#ef4444]")}
                  style={{ width: `${candidate.score}%` }} 
                />
              </div>
            </div>
            <div className="col-span-1 text-right text-[13px] text-[#0f172a] font-medium">{candidate.score}</div>
            <div className="col-span-2 text-[12px] text-[#64748b] capitalize">{candidate.stage.replace('_', ' ')}</div>
            <div className="col-span-2 flex items-center justify-end gap-2.5">
              {(() => {
                const agKey = resolveHeadieAgentKey(candidate.owner);
                const visual = HEADIE_AGENT_VISUALS[agKey];
                return visual ? (
                  <img src={visual.coloredSrc} alt={candidate.owner} className={getHeadieAvatarClass(agKey, 'w-[22px] h-[22px]')} />
                ) : null;
              })()}
              <span className="text-[12px] font-medium text-[#64748b]">{candidate.owner}</span>
              <ArrowRight size={15} className="text-[#94a3b8] opacity-0 group-hover:opacity-100 transition-opacity ml-1" />
            </div>"""

text = text.replace(candidate_old, candidate_new)

# 3. Horizontal Agents section on Dashboard
grid_old = """                {/* Approvals + Agents Mission Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
                  <div className="lg:col-span-3 flex flex-col">"""

grid_new = """                {/* Approvals + Agents Full Width Stack */}
                <div className="flex flex-col gap-8 w-full">
                  <div className="w-full flex flex-col">"""

text = text.replace(grid_old, grid_new)

agents_old = """                  <div className="lg:col-span-2 flex flex-col">
                    <Card className="rounded-[24px] overflow-hidden border border-[#dbe4ef] bg-white/95 shadow-[0_10px_30px_rgba(15,23,42,0.06)] h-full">
                      <div className="px-5 py-4 border-b border-[#e2e8f0] bg-[linear-gradient(125deg,#f8fafc_0%,#fffbeb_55%,#f8fafc_100%)]">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[12px] text-[#94a3b8] uppercase tracking-wider font-heading">Agents active</div>
                            <div className="text-[15px] font-medium text-[#334155] mt-0.5 leading-snug">
                              <span className="block">{activeAgentCount} live operators</span>
                              <span className="block">coordinating hiring loops</span>
                            </div>
                            <div className="text-[11px] text-[#94a3b8] mt-1">Open any row to jump into the full console.</div>
                          </div>
                          <Button
                            variant="link"
                            onClick={() => setActiveScreen('agents')}
                            className="text-[13px] font-sans font-medium text-[#64748b] hover:text-[#0f172a] h-auto p-0"
                          >
                            View logs
                          </Button>
                        </div>
                      </div>

                      <CardContent className="p-4">
                        <div className="grid grid-cols-1 gap-3">"""

agents_new = """                  <div className="w-full flex flex-col">
                    <Card className="rounded-[24px] overflow-hidden border border-[#dbe4ef] bg-white/95 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
                      <div className="px-5 py-4 border-b border-[#e2e8f0] bg-[linear-gradient(125deg,#f8fafc_0%,#fffbeb_55%,#f8fafc_100%)]">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[12px] text-[#94a3b8] uppercase tracking-wider font-heading">Agents active</div>
                            <div className="text-[15px] font-medium text-[#334155] mt-0.5 flex flex-wrap items-center gap-1.5">
                              <span>{activeAgentCount} live operators coordinating hiring loops</span>
                            </div>
                            <div className="text-[11px] text-[#94a3b8] mt-1">Select any row to jump into the full console.</div>
                          </div>
                          <Button
                            variant="outline"
                            onClick={() => setActiveScreen('agents')}
                            className="text-[13px] font-sans font-medium text-[#64748b] bg-white border-[#e2e8f0] hover:text-[#0f172a] rounded-full px-4 h-8 shadow-sm"
                          >
                            View logs
                          </Button>
                        </div>
                      </div>

                      <CardContent className="p-5">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">"""

text = text.replace(agents_old, agents_new)

with open('src/app/page.tsx', 'w') as f:
    f.write(text)
