import re

with open("src/components/ui/shadcn-command-menu.tsx", "r") as f:
    text = f.read()

# Fix keys
text = text.replace(
'''                  {group.children.map((item) => {
                    if (item.type === "page") {
                      return (
                        <CommandMenuItem
                          key={item.url}''',
'''                  {group.children.map((item, i) => {
                    if (item.type === "page") {
                      return (
                        <CommandMenuItem
                          key={`${item.url}-${i}`}'''
)

# Text replacements
text = text.replace("Search documentation...", "Ask anything...")


with open("src/components/ui/shadcn-command-menu.tsx", "w") as f:
    f.write(text)

