"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import {
  Activity02Icon,
  ArrowRight01Icon,
  Briefcase01Icon,
  Calendar01Icon,
  CheckmarkCircle02Icon,
  Copy01Icon,
  CornerDownLeft,
  Home01Icon,
  LayersIcon,
  LinkSquare02Icon,
  Message01Icon,
  PipelineIcon,
  Robot02Icon,
  Search01Icon,
  SecurityCheckIcon,
  Settings02Icon,
  UserAdd01Icon,
  UserSettings01Icon,
  WorkIcon,
} from '@hugeicons/core-free-icons';

import { Button } from "@/components/ui/button";
import { HugeIcon } from '@/components/ui/huge-icon';
import {
  ResponsiveCommand,
  ResponsiveCommandEmpty,
  ResponsiveCommandGroup,
  ResponsiveCommandInput,
  ResponsiveCommandItem,
  ResponsiveCommandList,
} from "@/components/ui/responsive-command";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@/components/ui/revola";
import { Separator } from "@/components/ui/separator";
import { type Color, type ColorPalette } from "@/utils/colors";
import { source, type Tree } from "@/utils/source";
import { cn } from "@/lib/utils";

import { useIsMac } from "@/utils/use-is-mac";
import { useMutationObserver } from "@/utils/use-mutation-observer";

type TreeNode = any;

function copyToClipboardWithoutMeta(value: string) {
  navigator.clipboard.writeText(value);
}

type SimplifiedGroup = {
  name: string;
  children: Array<{
    type: "page";
    name: string;
    url: string;
    icon?: React.ReactElement<unknown, string | React.JSXElementConstructor<any>>;
  }>;
};

type CommandMenuProps = {
  tree: Tree["pageTree"];
  colors: ColorPalette[];
};

const ROUTE_ICON_MAP: Record<string, any> = {
  '/': Home01Icon,
  '/dashboard': Home01Icon,
  '/pipeline': PipelineIcon,
  '/jobs': Briefcase01Icon,
  '/candidates': Message01Icon,
  '/approvals': CheckmarkCircle02Icon,
  '/agents': Robot02Icon,
  '/audit': Activity02Icon,
  '/team': UserSettings01Icon,
  '/settings': Settings02Icon,
  '/mcp': LayersIcon,
};

function inferCommandIcon(groupName: string, itemName: string, url: string): any {
  const byRoute = ROUTE_ICON_MAP[url];
  if (byRoute) {
    return byRoute;
  }

  const group = groupName.toLowerCase();
  const name = itemName.toLowerCase();

  if (group.includes('scheduling')) return Calendar01Icon;
  if (group.includes('candidate')) return Message01Icon;
  if (group.includes('offer') || group.includes('approval')) return CheckmarkCircle02Icon;
  if (group.includes('agent')) return Robot02Icon;
  if (group.includes('team') || group.includes('organization')) return WorkIcon;
  if (group.includes('integration') || group.includes('connection')) return LinkSquare02Icon;

  if (name.includes('invite')) return UserAdd01Icon;
  if (name.includes('analyze') || name.includes('search')) return Search01Icon;
  if (name.includes('draft') || name.includes('propose')) return Copy01Icon;
  if (name.includes('switch')) return SecurityCheckIcon;

  return ArrowRight01Icon;
}

// Transform the mixed tree structure into simplified groups
function simplifyTreeStructure(tree: TreeNode[]): SimplifiedGroup[] {
  const groups: SimplifiedGroup[] = [];
  let currentGroup: SimplifiedGroup | null = null;

  for (const item of tree) {
    switch (item.type) {
      case "separator": {
        currentGroup = {
          name: item.name?.toString() || "Untitled",
          children: [],
        };
        groups.push(currentGroup);
        break;
      }
      case "page": {
        if (currentGroup) {
          currentGroup.children.push({
            type: "page",
            name: item.name?.toString() || "Untitled",
            url: item.url,
            ...(item.icon && { icon: item.icon }),
          });
        } else {
          groups.push({
            name: item.name?.toString() || "Untitled",
            children: [
              {
                type: "page",
                name: item.name?.toString() || "Untitled",
                url: item.url,
                ...(item.icon && { icon: item.icon }),
              },
            ],
          });
        }
        break;
      }
      case "folder": {
        const folderPages = item.children?.filter((child: any) => child.type === "page" && "url" in child) || [];

        groups.push({
          name: item.name?.toString() || "Untitled",
          children: folderPages.map((page: any) => ({
            type: "page" as const,
            name: page.name?.toString() || "Untitled",
            url: (page as any).url,
            ...(page.icon && { icon: page.icon }),
          })),
        });

        currentGroup = null;
        break;
      }
      default:
        return groups;
    }
  }

  return groups;
}

export default function CommandMenu({ tree, colors }: CommandMenuProps) {
  const [open, setOpen] = React.useState(false);
  const [copyPayload, setCopyPayload] = React.useState("");
  const [selectedType, setSelectedType] = React.useState<"color" | "page" | null>(null);

  const isMac = useIsMac();
  const router = useRouter();

  const handlePageHighlight = React.useCallback(() => {
    setSelectedType("page");
    setCopyPayload("");
  }, [setSelectedType, setCopyPayload]);

  const handleColorHighlight = React.useCallback(
    (color: Color) => {
      setSelectedType("color");
      setCopyPayload(color.className);
    },
    [setSelectedType, setCopyPayload]
  );

  const runCommand = React.useCallback((command: () => unknown) => {
    setOpen(false);
    command();
  }, []);

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || e.key === "/") {
        if (
          (e.target instanceof HTMLElement && e.target.isContentEditable) ||
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement ||
          e.target instanceof HTMLSelectElement
        ) {
          return;
        }

        e.preventDefault();
        setOpen((open) => !open);
      }

      if (e.key === "c" && (e.metaKey || e.ctrlKey)) {
        runCommand(() => {
          if (selectedType === "color" || selectedType === "page") {
            copyToClipboardWithoutMeta(copyPayload);
          }
        });
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [copyPayload, runCommand, selectedType]);

  const listRef = React.useRef<HTMLDivElement>(null);
  const scrollId = React.useRef<ReturnType<typeof setTimeout>>(null);

  const simplifiedTree = simplifyTreeStructure(tree.children);

  return (
    <ResponsiveDialog shouldScaleBackground={false} open={open} onOpenChange={setOpen}>
      <ResponsiveDialogTrigger asChild>
        <div 
          onClick={() => setOpen(true)}
          className="hidden sm:flex items-center justify-between bg-[#f8fafc] border border-[#e2e8f0] px-2.5 h-[34px] min-w-[240px] rounded-[8px] cursor-pointer hover:bg-white hover:border-[#cbd5e1] transition-all group mr-1 shadow-[0_1px_2px_rgba(0,0,0,0.02)]"
          title="Open Command Center"
        >
          <span className="text-[12px] font-sans text-[#94a3b8] group-hover:text-[#64748b] transition-colors ml-1">Ask anything...</span>
          <div className="flex items-center bg-white border border-[#e2e8f0] px-1.5 py-[1px] rounded-[4px] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <span className="text-[10px] font-sans font-semibold text-[#64748b] tracking-wider uppercase">{isMac ? "⌘" : "Ctrl"}K</span>
          </div>
        </div>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent
        showCloseButton={false}
        dragHandleClassName="mt-0"
        className="overflow-hidden rounded-[16px] border-none bg-white p-0 shadow-[0_24px_60px_rgba(0,0,0,0.15)] ring-1 ring-black/5 max-w-[640px] pt-1"
      >
        <ResponsiveDialogHeader className="sr-only">
          <ResponsiveDialogTitle>Ask anything...</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>Search for a command to run...</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveCommand
          filter={(value, search, keywords) => {
            const extendValue = value + " " + (keywords?.join(" ") || "");
            if (extendValue.toLowerCase().includes(search.toLowerCase())) {
              return 1;
            }
            return 0;
          }}
          className="rounded-none bg-transparent [&_[cmdk-input-wrapper]]:mb-0 [&_[cmdk-input-wrapper]]:h-14 [&_[cmdk-input-wrapper]]:border-b [&_[cmdk-input-wrapper]]:border-[#e2e8f0] [&_[cmdk-input-wrapper]]:bg-transparent [&_[cmdk-input-wrapper]]:px-4 [&_[cmdk-input]]:h-14 [&_[cmdk-input]]:py-0 [&_[cmdk-input]]:text-base [&_[cmdk-input]]:font-sans [&_[cmdk-input]]:text-[#334155] [&_[cmdk-input]]:placeholder:text-[#94a3b8]"
        >
          <ResponsiveCommandInput
            onValueChange={(e) => {
              e === "" && setCopyPayload("");

              if (scrollId.current) {
                clearTimeout(scrollId.current);
              }

              scrollId.current = setTimeout(() => {
                if (listRef.current) {
                  listRef.current?.scrollTo({ top: 0 });
                }
              }, 0);
            }}
            placeholder="Ask anything..."
          />
          <ResponsiveCommandList ref={listRef} className="min-h-80 scroll-pb-1.5 scroll-pt-2 no-scrollbar">
            <ResponsiveCommandEmpty className="py-12 text-center text-[13px] text-[#94a3b8] font-sans">
              No results found.
            </ResponsiveCommandEmpty>

            {simplifiedTree.map((group, index) => {
              return (
                <ResponsiveCommandGroup
                  heading={group.name}
                  key={group.name + index}
                  className="!p-0 [&_[cmdk-group-heading]]:scroll-mt-16 [&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:font-sans [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-[#a0afbb]"
                >
                  {group.children.map((item, i) => {
                    if (item.type === "page") {
                      const itemIcon = inferCommandIcon(group.name, item.name, item.url);

                      return (
                        <CommandMenuItem
                          key={`${item.url}-${i}`}
                          keywords={undefined}
                          onHighlight={handlePageHighlight}
                          value={item.name?.toString() ? `${group.name} ${item.name}` : ""}
                          onSelect={() => {
                            runCommand(() => router.push(item.url));
                          }}
                        >
                          <HugeIcon icon={itemIcon} size={16} strokeWidth={1.8} />
                          {item.name}
                        </CommandMenuItem>
                      );
                    }
                    return null;
                  })}
                </ResponsiveCommandGroup>
              );
            })}

            </ResponsiveCommandList>
        </ResponsiveCommand>

        <div className="flex h-10 items-center justify-between gap-2 border-t border-[#e2e8f0] bg-[#f8fafc] px-4 text-[#a0afbb] font-sans text-[11px] font-medium">
          <div className="flex items-center gap-2">
            <CommandMenuKbd>
              <HugeIcon icon={CornerDownLeft} size={12} strokeWidth={2.2} />
            </CommandMenuKbd>
            {selectedType === "page" ? "Go to Page" : null}
            {selectedType === "color" ? "Copy OKLCH" : null}
          </div>
          {copyPayload && (
            <>
              <Separator orientation="vertical" className="!h-4" />
              <div className="flex items-center gap-1">
                <CommandMenuKbd>{isMac ? "⌘" : "Ctrl"}</CommandMenuKbd>
                <CommandMenuKbd>C</CommandMenuKbd>
                {copyPayload}
              </div>
            </>
          )}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function CommandMenuItem({
  children,
  className,
  onHighlight,
  ...props
}: React.ComponentProps<typeof ResponsiveCommandItem> & {
  onHighlight?: () => void;
  "data-selected"?: string;
  "aria-selected"?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  useMutationObserver(ref, (mutations: any[]) => {
    mutations.forEach((mutation: any) => {
      if (
        mutation.type === "attributes" &&
        mutation.attributeName === "aria-selected" &&
        ref.current?.getAttribute("aria-selected") === "true"
      ) {
        onHighlight?.();
      }
    });
  });

  return (
    <ResponsiveCommandItem
      ref={ref}
      className={cn(
        "mx-2 mb-1 !px-3 py-2.5 h-10 rounded-[8px] border border-transparent font-sans font-medium text-[13px] text-[#334155] data-[selected=true]:bg-[#f4f6f8] data-[selected=true]:border-[#e2e8f0] cursor-pointer transition-colors",
        className
      )}
      {...props}
    >
      {children}
    </ResponsiveCommandItem>
  );
}

function CommandMenuKbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "not-prose pointer-events-none flex h-5 select-none items-center justify-center gap-1 rounded border bg-background px-1 font-sans text-[0.7rem] font-medium text-muted-foreground [&_svg:not([class*='size-'])]:size-3",
        className
      )}
      {...props}
    />
  );
}
