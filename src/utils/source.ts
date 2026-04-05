export type Tree = { pageTree: { children: any[] } };
export const source = {
  pageTree: {
    children: [
      { name: "Navigate", type: "folder", children: [
        { type: "page", name: "Dashboard", url: "/" },
        { type: "page", name: "Pipeline", url: "/pipeline" },
        { type: "page", name: "Jobs", url: "/jobs" },
        { type: "page", name: "Candidates", url: "/candidates" },
        { type: "page", name: "Approvals", url: "/approvals" },
        { type: "page", name: "Agents", url: "/agents" },
        { type: "page", name: "Audit Trail", url: "/audit" },
        { type: "page", name: "Team", url: "/team" },
        { type: "page", name: "Settings", url: "/settings" },
      ] },
      { name: "Candidate Actions", type: "folder", children: [
        { type: "page", name: "Open candidate roster", url: "/candidates" },
        { type: "page", name: "Open candidate workbench", url: "/candidates/cand_001" },
      ] },
      { name: "Scheduling", type: "folder", children: [
        { type: "page", name: "Schedule next round", url: "/pipeline" },
        { type: "page", name: "Propose interview slots", url: "/jobs/senior-product-designer/candidates" },
        { type: "page", name: "Analyze scheduling reply", url: "/candidates/cand_002" },
      ] },
      { name: "Offers + Approvals", type: "folder", children: [
        { type: "page", name: "Draft offer", url: "/candidates/cand_004" },
        { type: "page", name: "Submit for founder approval", url: "/approvals" },
        { type: "page", name: "Poll approval status", url: "/approvals" },
      ] },
      { name: "Agent Actions", type: "folder", children: [
        { type: "page", name: "Wake Triage agent", url: "/agents" },
      ] },
      { name: "Team + Organization", type: "folder", children: [
        { type: "page", name: "Invite team member", url: "/team" },
        { type: "page", name: "Switch organization", url: "/settings" },
      ] },
      { name: "Integrations + Connections", type: "folder", children: [
        { type: "page", name: "Open MCP settings", url: "/mcp" },
        { type: "page", name: "Open integration controls", url: "/settings" }
      ]}
    ]
  }
};
