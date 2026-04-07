import re

with open("src/components/ui/shadcn-command-menu.tsx", "r") as f:
    text = f.read()

text = text.replace("type TreeNode = (typeof source.pageTree)[\"children\"][number];", "type TreeNode = any;")
text = text.replace("colorPalette.colors.map((color)", "colorPalette.colors.map((color: any)")
text = text.replace("useMutationObserver(ref, (mutations) => {", "useMutationObserver(ref, (mutations: any[]) => {")
text = text.replace("mutations.forEach((mutation) => {", "mutations.forEach((mutation: any) => {")

with open("src/components/ui/shadcn-command-menu.tsx", "w") as f:
    f.write(text)

