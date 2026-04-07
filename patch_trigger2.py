import re

with open("src/components/ui/shadcn-command-menu.tsx", "r") as f:
    content = f.read()

old_str = """        <div 
          onClick={() => setOpen(true)}
          className="hidden sm:flex items-center justify-between gap-4 bg-[#f8fafc] border border-[#e2e8f0] px-3 h-[36px] min-w-[240px] rounded-lg cursor-pointer hover:bg-white hover:border-[#cbd5e1] transition-all group mr-1 shadow-[0_1px_2px_rgba(0,0,0,0.02)]"
          title="Open Command Center"
        >
          <span className="text-[13px] font-sans text-[#94a3b8] group-hover:text-[#64748b] transition-colors">Search documentation...</span>
          <div className="flex items-center bg-white border border-[#e2e8f0] px-1.5 py-[2px] rounded-[4px] shadow-sm">
            <span className="text-[10px] font-sans font-semibold text-[#64748b] tracking-wider uppercase">{isMac ? "⌘" : "Ctrl"} K</span>
          </div>
        </div>"""

new_str = """        <div 
          onClick={() => setOpen(true)}
          className="hidden sm:flex items-center justify-between bg-[#f8fafc] border border-[#e2e8f0] px-2.5 h-[34px] min-w-[240px] rounded-lg cursor-pointer hover:bg-white hover:border-[#cbd5e1] transition-all group mr-1 shadow-[0_1px_2px_rgba(0,0,0,0.02)]"
          title="Open Command Center"
        >
          <span className="text-[12px] font-sans text-[#94a3b8] group-hover:text-[#64748b] transition-colors ml-1">Search documentation...</span>
          <div className="flex items-center bg-white border border-[#e2e8f0] px-1.5 py-[2px] rounded md shadow-sm">
            <span className="text-[10px] font-sans font-semibold text-[#64748b] tracking-wider uppercase">{isMac ? "⌘" : "Ctrl"}K</span>
          </div>
        </div>"""

content = content.replace(old_str, new_str)

with open("src/components/ui/shadcn-command-menu.tsx", "w") as f:
    f.write(content)
