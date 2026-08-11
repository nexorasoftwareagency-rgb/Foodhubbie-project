// === src/components/ui/badge.tsx ===
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold w-fit whitespace-nowrap shrink-0 gap-1 [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        success: "border-transparent bg-[#E7F7EF] text-[#0B9169]",
        warning: "border-transparent bg-[#FEF6E7] text-[#B45309]",
        destructive: "border-transparent bg-[#FEE2E2] text-[#B91C1C]",
        info: "border-transparent bg-[#EAF2FF] text-[#1D4ED8]",
        outline: "text-foreground border-border",
        grey: "border-transparent bg-[#F3F4F6] text-[#6B7280]",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";
  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
