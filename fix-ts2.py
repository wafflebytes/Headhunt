import re

with open("src/components/ui/shadcn-command-menu.tsx", "r") as f:
    text = f.read()

text = text.replace("const folderPages = item.children?.filter((child) =>", "const folderPages = item.children?.filter((child: any) =>")
text = text.replace("children: folderPages.map((page) => ({", "children: folderPages.map((page: any) => ({")

with open("src/components/ui/shadcn-command-menu.tsx", "w") as f:
    f.write(text)

