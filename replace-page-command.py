with open("src/app/page.tsx", "r") as f:
    content = f.read()

# Add wrapper import
import_wrapper = "import CommandMenuWrapper from '@/components/command-menu-wrapper';\n"
content = content.replace("import { Home,", import_wrapper + "import { Home,")

# Remove previous direct imports we no longer need
content = content.replace("import { \n  ResponsiveDialog, \n  ResponsiveDialogContent, \n  ResponsiveDialogHeader, \n  ResponsiveDialogTitle \n} from '@/components/ui/revola';\n", "")
content = content.replace("import { \n  ResponsiveCommand, \n  ResponsiveCommandInput, \n  ResponsiveCommandList, \n  ResponsiveCommandEmpty, \n  ResponsiveCommandGroup, \n  ResponsiveCommandItem \n} from '@/components/ui/responsive-command';\n", "")

# Remove the inline command bar
start_marker = "{/* Command Center Overlay Using Revola's Responsive Command */}"
end_marker = "</ResponsiveDialog>"

if start_marker in content and end_marker in content:
    start_idx = content.find(start_marker)
    end_idx = content.find(end_marker) + len(end_marker)
    
    # We replace the entire responsive dialog with the wrapper wrapper
    content = content[:start_idx] + "<div className=\"hidden sm:block absolute right-7 top-6 w-[280px] z-50\">\n        <CommandMenuWrapper />\n      </div>" + content[end_idx:]

with open("src/app/page.tsx", "w") as f:
    f.write(content)
