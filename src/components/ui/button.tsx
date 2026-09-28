import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// Neobrutalism Minimalism: square corners, a 2px ink border on every
// interactive surface, and a hard offset shadow that collapses on press.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-none text-sm font-semibold uppercase tracking-wide transition-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:ring-offset-0 aria-invalid:ring-destructive/30 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "border-2 border-ink bg-primary text-primary-foreground nb-press",
        destructive:
          "border-2 border-ink bg-destructive text-white nb-press",
        outline:
          "border-2 border-ink bg-surface text-ink nb-press hover:bg-accent hover:text-accent-foreground",
        secondary:
          "border-2 border-ink bg-secondary text-secondary-foreground nb-press hover:bg-accent hover:text-accent-foreground",
        ghost:
          "border-2 border-transparent text-ink hover:border-ink hover:bg-accent hover:text-accent-foreground",
        link: "text-ink underline underline-offset-4 hover:bg-accent",
      },
      size: {
        default: "h-10 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 gap-1.5 px-3 has-[>svg]:px-2.5 text-xs",
        lg: "h-12 px-6 has-[>svg]:px-4 text-base",
        icon: "size-10",
        "icon-sm": "size-8",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
