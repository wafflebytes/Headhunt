import re

with open('src/app/page.tsx', 'r') as f:
    text = f.read()

colors = {
    '#0ea5e9': '#e18131', # primary brand
    '#0284c7': '#c2410c', # darker
    '#38bdf8': '#fba94c', # lighter
    '#1d4ed8': '#b45309', # active text
    '#bfdbfe': '#fed7aa', # active border
    '#eff6ff': '#fffbeb', # active bg
    '#2563eb': '#d97706', # focus
    '#0369a1': '#9a3412',
    '#e0f2fe': '#ffedd5',
    '#dbeafe': '#ffedd5',
}

for old, new in colors.items():
    text = text.replace(old, new)
    text = text.replace(old.upper(), new)

with open('src/app/page.tsx', 'w') as f:
    f.write(text)
