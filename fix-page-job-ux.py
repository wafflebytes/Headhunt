import re

with open('src/app/page.tsx', 'r') as f:
    content = f.read()

# 1. Update next/navigation imports
content = content.replace(
    "import { usePathname, useRouter } from 'next/navigation';",
    "import { usePathname, useRouter, useSearchParams } from 'next/navigation';"
)

# 2. Add hugeicons
if 'FileUploadIcon' not in content:
    content = content.replace(
        "} from '@hugeicons/core-free-icons';",
        "  FileUploadIcon,\n  SparklesIcon,\n  File01Icon,\n} from '@hugeicons/core-free-icons';"
    )

with open('src/app/page.tsx', 'w') as f:
    f.write(content)
