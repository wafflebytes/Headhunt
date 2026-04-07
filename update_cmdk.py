import re

with open("src/components/ui/shadcn-command-menu.tsx", "r") as f:
    content = f.read()

# 1. Remove the colors section completely

# find where it maps over colors
start_idx = content.find("{colors.map((colorPalette: any)")
# if it has "any", check that. Otherwise check standard
if start_idx == -1:
    start_idx = content.find("{colors.map((colorPalette)")

# find the matching closing brace for rendering colors. 
end_idx = content.find("</ResponsiveCommandList>")

if start_idx != -1 and end_idx != -1:
    content = content[:start_idx] + content[end_idx:]


# 2. Fix styling of the ResponsiveCommand dialog border/bg, mimicking the screenshot
content = content.replace(
    'className="overflow-hidden rounded-t-2xl border-none bg-clip-padding p-2 pb-11 shadow-2xl ring-4 ring-neutral-200/80 dark:bg-neutral-900 dark:ring-neutral-800 sm:rounded-xl"',
    'className="overflow-hidden rounded-[16px] border-none bg-white p-0 shadow-[0_24px_60px_rgba(0,0,0,0.15)] ring-1 ring-black/5 max-w-[640px] pt-1"'
)

# 3. Fix the responsive command input style + placeholder
content = content.replace(
    'className="rounded-none bg-transparent [&_[cmdk-input-wrapper]]:mb-0 [&_[cmdk-input-wrapper]]:!h-9 [&_[cmdk-input-wrapper]]:rounded-md [&_[cmdk-input-wrapper]]:border [&_[cmdk-input-wrapper]]:border-input [&_[cmdk-input-wrapper]]:bg-input/50 [&_[cmdk-input-wrapper]]:px-3 [&_[cmdk-input]]:!h-9 [&_[cmdk-input]]:py-0"',
    'className="rounded-none bg-transparent [&_[cmdk-input-wrapper]]:mb-0 [&_[cmdk-input-wrapper]]:h-14 [&_[cmdk-input-wrapper]]:border-b [&_[cmdk-input-wrapper]]:border-[#e2e8f0] [&_[cmdk-input-wrapper]]:bg-transparent [&_[cmdk-input-wrapper]]:px-4 [&_[cmdk-input]]:h-14 [&_[cmdk-input]]:py-0 [&_[cmdk-input]]:text-base [&_[cmdk-input]]:font-sans [&_[cmdk-input]]:text-[#334155] [&_[cmdk-input]]:placeholder:text-[#94a3b8]"'
)

# 4. Remove dark-mode backgrounds from bottom bar, make it light
content = content.replace(
    'className="absolute inset-x-0 bottom-0 z-20 flex h-10 items-center gap-2 border-t border-t-neutral-100 bg-neutral-50 px-4 text-xs font-medium text-muted-foreground dark:border-t-neutral-700 dark:bg-neutral-800 sm:rounded-b-xl"',
    'className="flex h-10 items-center justify-between gap-2 border-t border-[#e2e8f0] bg-[#f8fafc] px-4 text-[#a0afbb] font-sans text-[11px] font-medium"'
)


# 5. Fix empty state style
content = content.replace(
    'className="py-12 text-center text-sm text-muted-foreground"',
    'className="py-12 text-center text-[13px] text-[#94a3b8] font-sans"'
)

# 6. Fix group heading style (uppercase tracking-widest text-[#a0afbb])
content = content.replace(
    'className="!p-0 [&_[cmdk-group-heading]]:scroll-mt-16 [&_[cmdk-group-heading]]:!p-3 [&_[cmdk-group-heading]]:!pb-1"',
    'className="!p-0 [&_[cmdk-group-heading]]:scroll-mt-16 [&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:font-sans [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-[#a0afbb]"'
)


# 7. Update CommandMenuItem (ResponsiveCommandItem via CommandMenuItem func at bottom)
content = content.replace(
    '"h-9 rounded-md border border-transparent !px-3 font-medium data-[selected=true]:border-input data-[selected=true]:bg-input/50",',
    '"mx-2 mb-1 !px-3 py-2.5 h-10 rounded-[8px] border border-transparent font-sans font-medium text-[13px] text-[#334155] data-[selected=true]:bg-[#f4f6f8] data-[selected=true]:border-[#e2e8f0] cursor-pointer transition-colors",'
)

with open("src/components/ui/shadcn-command-menu.tsx", "w") as f:
    f.write(content)

