"use client";

import ShadcnCommandMenu from "@/components/ui/shadcn-command-menu";
import { getColors } from "@/utils/colors";
import { source } from "@/utils/source";

export default function CommandMenuWrapper() {
  let colors: ReturnType<typeof getColors> = [];
  try {
    colors = getColors();
  } catch (e) {
    console.error("Could not parse registry colors, defaulting to empty");
  }

  const pageTree = source.pageTree;

  return (
    <ShadcnCommandMenu tree={pageTree} colors={colors} />
  );
}
