// === src/components/ui/toast.tsx ===
// Standard Radix-based toast primitive (part of the shadcn/ui kit). The app's
// live notifications are rendered via Sonner (see ui/toaster.tsx + hooks/use-toast.ts);
// this primitive remains available for any future non-Sonner toast needs.
import * as React from "react";
import * as ToastPrimitives from "@radix-ui/react-toast";
import { cva, type VariantProps } from "class-variance-authority";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const ToastProvider = ToastPrimitives.Provider;

function ToastViewport({ className, ...props }: React.ComponentProps<typeof ToastPrimitives.Viewport>) {
  return (
    <ToastPrimitives.Viewport
      className={cn("fixed bottom-0 left-1/2 z-[100] flex max-h-screen w-full -translate-x-1/2 flex-col gap-2 p-4 sm:max-w-sm", className)}
      {...props}
    />
  );
}

const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-xl p-4 shadow-[var(--shadow-premium)] transition-all",
  {
    variants: {
      variant: {
        default: "bg-[#1E293B] text-white",
        success: "bg-[#0B9169] text-white",
        destructive: "bg-[#DC2626] text-white",
        warning: "bg-[#B45309] text-white",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

function Toast({ className, variant, ...props }: React.ComponentProps<typeof ToastPrimitives.Root> & VariantProps<typeof toastVariants>) {
  return <ToastPrimitives.Root className={cn(toastVariants({ variant }), className)} {...props} />;
}

function ToastAction({ className, ...props }: React.ComponentProps<typeof ToastPrimitives.Action>) {
  return (
    <ToastPrimitives.Action
      className={cn("inline-flex h-8 shrink-0 items-center justify-center rounded-lg bg-white/15 px-3 text-xs font-semibold hover:bg-white/25", className)}
      {...props}
    />
  );
}

function ToastClose({ className, ...props }: React.ComponentProps<typeof ToastPrimitives.Close>) {
  return (
    <ToastPrimitives.Close className={cn("rounded-md p-1 text-white/70 opacity-0 transition-opacity group-hover:opacity-100 hover:text-white", className)} {...props}>
      <XIcon className="size-4" />
    </ToastPrimitives.Close>
  );
}

function ToastTitle({ className, ...props }: React.ComponentProps<typeof ToastPrimitives.Title>) {
  return <ToastPrimitives.Title className={cn("text-sm font-bold", className)} {...props} />;
}

function ToastDescription({ className, ...props }: React.ComponentProps<typeof ToastPrimitives.Description>) {
  return <ToastPrimitives.Description className={cn("text-xs opacity-90", className)} {...props} />;
}

type ToastActionElement = React.ReactElement<typeof ToastAction>;

export {
  ToastProvider, ToastViewport, Toast, ToastAction, ToastClose, ToastTitle, ToastDescription,
  type ToastActionElement,
};
