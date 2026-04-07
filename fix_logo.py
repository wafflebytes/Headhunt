import re

with open("src/app/page.tsx", "r") as f:
    text = f.read()

old_logo = """        {/* Logo & Collapse */}
        <div className={cn("flex items-center mb-5 w-full", isSidebarOpen ? "justify-between px-2" : "justify-center px-0")}>
          {isSidebarOpen && (
            <div className="flex items-center gap-3">
              <span className="font-heading text-[28px] tracking-tight">
                <span className="text-[#a0afbb]">Head</span>
                <span className="text-[#304f67]">hunt</span>
              </span>
            </div>
          )}
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className={cn("text-[#94a3b8] hover:text-[#334155] p-1.5 rounded-[10px] hover:bg-white/60 border border-transparent hover:border-[#cbd5e1]/50 hover:shadow-sm cursor-pointer shrink-0", !isSidebarOpen && "bg-white shadow-[0_1px_3px_rgba(0,0,0,0.05)] border-[#e2e8f0] p-2 hover:bg-white")}>
            {isSidebarOpen ? <PanelLeftClose size={18} strokeWidth={2} /> : <PanelLeft size={20} strokeWidth={2.5} />}
          </button>
        </div>"""

new_logo = """        {/* Logo & Collapse */}
        <div className="flex items-center mb-5 w-full">
          {isSidebarOpen ? (
            <div className="flex items-center justify-between w-full px-1">
              <div className="flex items-center gap-2 cursor-pointer" onClick={() => window.location.href='/'}>
                <img src="/assets/headie.png" alt="Headhunt" className="w-[28px] h-[28px] object-contain drop-shadow-sm" />
                <span className="text-[26px] tracking-tight text-[#253e52]" style={{ fontFamily: '"Kalice-Regular", serif', position: 'relative', top: '1px' }}>
                  Headhunt
                </span>
              </div>
              <button onClick={() => setIsSidebarOpen(false)} className="text-[#94a3b8] hover:text-[#334155] p-1.5 rounded-[10px] hover:bg-white/60 transition-colors shrink-0">
                <PanelLeftClose size={18} strokeWidth={2} />
              </button>
            </div>
          ) : (
            <div className="flex w-full justify-center px-0">
               <button onClick={() => setIsSidebarOpen(true)} title="Expand Sidebar" className="p-1.5 rounded-[10px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.05)] border border-[#e2e8f0] hover:bg-[#f8fafc] transition-colors shrink-0 outline-none">
                 <img src="/assets/headie.png" alt="Logo" className="w-[24px] h-[24px] object-contain drop-shadow-sm pointer-events-none" />
               </button>
            </div>
          )}
        </div>"""

text = text.replace(old_logo, new_logo)

with open("src/app/page.tsx", "w") as f:
    f.write(text)
