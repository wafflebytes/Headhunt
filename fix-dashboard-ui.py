import re

with open('src/app/page.tsx', 'r') as f:
    content = f.read()

# I will replace the pendingApprovals mapping structure to match the layout
# We want `<div className="grid grid-cols-[auto_1fr] gap-6">`
old_pattern = r'''<div className="flex flex-col gap-3">\s*\{pendingApprovals\.map\(\(approval\) => \{
                                const candidate = parseApprovalCandidate\(approval\.payloadJson\);
                                const isSelected = selectedApproval\?\._id === approval\._id;
                                const agentKey = resolveApprovalAgentKey\(approval, candidate\);
                                const agentSeed = findHeadieSeed\(agentKey\);
                                const agentVisual = HEADIE_AGENT_VISUALS\[agentKey\];
                                const urgency = resolveApprovalUrgency\(approval\.expiresAtMs\);

                                return \(
                                  <Card
                                    key=\{approval\._id\}
                                    onClick=\{[^}]+\}
                                    className=\{cn\(
                                      'rounded-\[18px\] border bg-white transition-all cursor-pointer',
                                      isSelected
                                        \? 'border-\[#0f172a\] shadow-\[0_10px_24px_rgba\(15,23,42,0\.10\)\]'
                                        : 'border-\[#e2e8f0\] shadow-\[0_2px_8px_rgba\(0,0,0,0\.04\)\] hover:border-\[#cbd5e1\] hover:shadow-\[0_8px_20px_rgba\(15,23,42,0\.08\)\]',
                                    \)\}
                                  >
                                    <CardContent className="p-4">
                                      <div className="flex items-start gap-3">
                                        <div className="w-12 h-12 flex items-center justify-center shrink-0">
                                          <img src=\{agentVisual\.coloredSrc\} alt=\{agentSeed\.name\} className="w-9 h-9 object-contain" />
                                        </div>

                                        <div className="min-w-0 flex-1">
                                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                                            <div className="text-\[14px\] font-semibold text-\[#334155\] truncate">
                                              \{toActionLabel\(candidate\.actionType \?\? approval\.actionType\)\}
                                            </div>
                                            <Badge className=\{urgency\.className\}>\{urgency\.label\}</Badge>
                                          </div>

                                          <div className="text-\[12px\] font-sans text-\[#64748b\] truncate">
                                            \{\(candidate\.candidateName \?\? candidate\.clientName \?\? 'Unknown candidate'\)\} \· \{\(candidate\.jobTitle \?\? candidate\.invoiceNumber \?\? approval\.resourceId \?\? 'No target'\)\} \· \{formatApprovalSummaryMeta\(candidate\)\}
                                          </div>

                                          <div className="text-\[11px\] text-\[#94a3b8\] mt-2 flex items-center gap-2">
                                            <span className="font-medium text-\[#334155\]">\{agentSeed\.name\}</span>
                                            <span className="text-\[#cbd5e1\]">•</span>
                                            <span>Requested \{formatRelativeTime\(approval\.requestedAtMs\)\}</span>
                                          </div>
                                        </div>

                                        <ArrowRight size=\{18\} className="text-\[#94a3b8\] opacity-70 mt-1 shrink-0" />
                                      </div>
                                    </CardContent>
                                  </Card>
                                \);
                              \}\)
                            \}</div>'''

new_structure = '''<div className="flex flex-col gap-6 relative z-0">
                              {/* Connection line backdrop */}
                              <div className="absolute left-[36px] top-[30px] bottom-[30px] w-px border-l-2 border-dashed border-[#e2e8f0] -z-10" />
                              
                              {pendingApprovals.map((approval) => {
                                const candidate = parseApprovalCandidate(approval.payloadJson);
                                const isSelected = selectedApproval?._id === approval._id;
                                const agentKey = resolveApprovalAgentKey(approval, candidate);
                                const agentSeed = findHeadieSeed(agentKey);
                                const agentVisual = HEADIE_AGENT_VISUALS[agentKey];
                                const urgency = resolveApprovalUrgency(approval.expiresAtMs);

                                return (
                                  <div key={approval._id} className="group relative flex items-center" onClick={() => setSelectedApprovalId(approval._id)}>
                                    <div className={cn(
                                      "w-[74px] h-[74px] flex items-center justify-center shrink-0 rounded-[24px] bg-white cursor-pointer relative transition-all border z-10",
                                      isSelected ? "border-[#0f172a] border-[1.5px] shadow-[0_12px_24px_rgba(15,23,42,0.12)] scale-105" : "border-[#e2e8f0] shadow-sm hover:border-[#cbd5e1]"
                                    )}>
                                      <img src={agentVisual.coloredSrc} alt={agentSeed.name} className="w-10 h-10 object-contain" />
                                    </div>
                                    <div className={cn(
                                      "flex-1 pl-6 flex items-center opacity-0 transition-opacity whitespace-nowrap",
                                      !isSelected && "group-hover:opacity-100"
                                    )}>
                                      <span className="text-[12px] font-sans text-[#64748b] bg-white pr-2 font-medium z-10">
                                        {toActionLabel(candidate.actionType ?? approval.actionType)}
                                      </span>
                                    </div>
                                    
                                    {/* Line connecting to detail card when selected */}
                                    {isSelected && (
                                      <div className="absolute right-0 w-[40px] h-px bg-[#0f172a] -z-10 opacity-20" />
                                    )}
                                    {/* Active badge overlay on unselected */}
                                    {!isSelected && (
                                      <div className="absolute left-[64px] z-20">
                                          <Badge className={cn(urgency.className, "text-[9px] px-1.5 py-0 border bg-opacity-90")}>{urgency.label.split(' ')[0]}</Badge>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>'''

content = re.sub(old_pattern, new_structure, content, flags=re.DOTALL)

# Grid layout
content = content.replace('<div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4">', '<div className="grid grid-cols-[100px_1fr] xl:grid-cols-[100px_1fr] xl:gap-8 gap-4">')

with open('src/app/page.tsx', 'w') as f:
    f.write(content)

