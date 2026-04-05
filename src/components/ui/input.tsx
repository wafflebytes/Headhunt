import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-[#e2e8f0] bg-white px-3 py-2 text-[14px] shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)] transition-all file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-[#94a3b8] focus-visible:outline-none focus-visible:border-[#6366f1] focus-visible:shadow-[0_0_0_1px_#6366f1,0_4px_12px_rgba(99,102,241,0.06)] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
