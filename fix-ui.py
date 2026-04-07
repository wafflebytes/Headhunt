import sys

def replace_between(content, start_str, end_str, new_content):
    idx_start = content.find(start_str)
    if idx_start == -1:
        print("Start str not found")
        sys.exit(1)
    # The end string is the first occurrence *after* start_str + len(start_str)
    idx_end = content.find(end_str, idx_start + len(start_str))
    if idx_end == -1:
        print("End str not found")
        sys.exit(1)
        
    idx_end += len(end_str)
    
    return content[:idx_start] + new_content + content[idx_end:]


with open('src/app/page.tsx', 'r') as f:
    text = f.read()

# Fix Needs Your Approval layout
needs_approval_start = '<div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4">'
needs_approval_end = '</div>\n\n                            <Card className="rounded-[18px] bg-white '

needs_approval_new = '''<div className="grid grid-cols-[70px_1fr] gap-6 xl:gap-8 relative">
                            {/* Dotted connecting line */}
                            <div className="absolute left-[35px] top-[30px] bottom-[30px] w-px bg-[repeating-linear-gradient(to_bottom,#cbd5e1_0px,#cbd5e1_4px,transparent_4px,transparent_8px)] -z-10" />
                            
                            <div className="flex flex-col gap-6 items-center">
                              {pendingApprovals.map((approval) => {
                                const candidate = parseApprovalCandidate(approval.payloadJson);
                                const isSelected = selectedApproval?._id === approval._id;
                                const agentKey = resolveApprovalAgentKey(approval, candidate);
                                const agentSeed = findHeadieSeed(agentKey);
                                const agentVisual = HEADIE_AGENT_VISUALS[agentKey];
                                const urgency = resolveApprovalUrgency(approval.expiresAtMs);

                                return (
                                  <div
                                    key={approval._id}
                                    onClick={() => setSelectedApprovalId(approval._id)}
                                    className="group relative flex flex-col items-center justify-center cursor-pointer"
                                  >
                                    {/* The avatar itself - explicit styling avoiding border/squircle classes */}
                                    <div className={cn(
                                      "w-12 h-12 flex items-center justify-center bg-[#f8fafc] rounded-[14px] transition-all",
                                      isSelected ? "scale-125 shadow-[0_4px_14px_rgba(15,23,42,0.06)] bg-white ring-1 ring-[#e2e8f0]" : "opacity-60 hover:opacity-100 hover:scale-110"
                                    )}>
                                      <img src={agentVisual.coloredSrc} alt={agentSeed.name} className="w-8 h-8 object-contain" />
                                    </div>
                                    
                                    {/* Urgency Badge if not selected */}
                                    {!isSelected && (
                                      <Badge className={cn(
                                        "absolute top-1/2 -right-3 -translate-y-1/2 translate-x-full text-[9px] px-1.5 py-0 shadow-sm transition-opacity opacity-0 group-hover:opacity-100",
                                        urgency.className
                                      )}>
                                        {urgency.label}
                                      </Badge>
                                    )}

                                    {/* Connection pointer if selected */}
                                    {isSelected && (
                                      <div className="absolute top-1/2 -right-[26px] -translate-y-1/2 flex items-center text-[#94a3b8]">
                                        <div className="w-4 h-px bg-[#cbd5e1]" />
                                        <ArrowRight size={14} />
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>'''

text = replace_between(text, needs_approval_start, needs_approval_end, needs_approval_new + '\n\n                            <Card className="rounded-[18px] bg-white ')

# Fix Agent Active header to match image
# The current text has activeAgentCount, we replace the heading with a styled version
active_start = '<div className="text-[15px] font-medium text-[#334155] mt-0.5">{activeAgentCount} live operators coordinating hiring loops</div>\n                          </div>'
active_new = '''<div className="text-[15px] font-medium text-[#334155] mt-0.5">{activeAgentCount} live operators<br/>coordinating hiring loops</div>
                          </div>'''
text = text.replace(active_start, active_new)

# Fix Agent Item inside Agents active array length map
agent_old_start = '''<div className="flex items-center gap-3">
                                      <div className="w-10 h-10 flex items-center justify-center shrink-0">
                                        <img src={visual.coloredSrc} alt={agent.name} className="w-8 h-8 object-contain" />
                                      </div>
                                      <div>
                                        <div className="text-[13px] font-semibold text-[#1e293b]">{agent.name}</div>
                                        <div className="text-[11px] text-[#64748b]">{agent.role}</div>
                                      </div>
                                      <Badge className={cn('ml-auto shrink-0', status.theme)}>
                                        {status.label}
                                      </Badge>
                                    </div>'''

agent_new = '''<div className="flex items-start justify-between gap-3">
                                      <div className="flex items-center gap-3">
                                        <div className="w-11 h-11 flex items-center justify-center shrink-0 bg-[#f8fafc] rounded-xl border border-[#f1f5f9]">
                                          <img src={visual.coloredSrc} alt={agent.name} className="w-7 h-7 object-contain" />
                                        </div>
                                        <div>
                                          <div className="text-[15px] font-semibold text-[#334155]">{agent.name}</div>
                                          <div className="text-[13px] text-[#64748b] truncate max-w-[140px]">{agent.role}</div>
                                        </div>
                                      </div>
                                      <Badge className={cn('shrink-0 bg-opacity-10 text-[10px] uppercase font-sans tracking-wide', status.theme)}>
                                        {status.label}
                                      </Badge>
                                    </div>'''
text = text.replace(agent_old_start, agent_new)


with open('src/app/page.tsx', 'w') as f:
    f.write(text)

