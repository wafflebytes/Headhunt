import re

with open("src/components/ui/shadcn-command-menu.tsx", "r") as f:
    content = f.read()

old_str = """        <Button
          variant="secondary"
          className={cn(
            "relative h-11 w-full justify-start rounded-lg bg-secondary pl-2.5 font-normal text-secondary-foreground/60 shadow-none dark:bg-card sm:pr-12 md:w-40 lg:w-56 xl:w-64"
          )}
          onClick={() => setOpen(true)}
        >
          <span className="hidden lg:inline-flex">Search documentation...</span>
          <span className="inline-flex lg:hidden">Search...</span>
          <div className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 gap-1 sm:flex">
            <CommandMenuKbd>{isMac ? "⌘" : "Ctrl"}</CommandMenuKbd>
            <CommandMenuKbd className="aspect-square">K</CommandMenuKbd>
          </div>
        </Button>"""

new_str = """        <div 
          onClick={() => setOpen(true)}
          className="hidden sm:flex items-center justify-between gap-4 bg-[#f8fafc] border border-[#e2e8f0] px-3 h-[36px] min-w-[240px] rounded-lg cursor-pointer hover:bg-white hover:border-[#cbd5e1] transition-all group mr-1 shadow-[0_1px_2px_rgba(0,0,0,0.02)]"
          title="Open Command Center"
        >
          <span className="text-[13px] font-sans text-[#94a3b8] group-hover:text-[#64748b] transition-colors">Search documentation...</span>
          <div className="flex items-center bg-white border border-[#e2e8f0] px-1.5 py-[2px] rounded-[4px] shadow-sm">
            <span className="text-[10px] font-sans font-semibold text-[#64748b] tracking-wider uppercase">{isMac ? "⌘" : "Ctrl"} K</span>
          </div>
        </div>"""

content = content.replace(old_str, new_str)

with open("src/components/ui/shadcn-command-menu.tsx", "w") as f:
    f.write(content)
