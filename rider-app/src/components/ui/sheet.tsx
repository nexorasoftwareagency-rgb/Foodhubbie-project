// === src/components/ui/sheet.tsx ===
// Built on vaul's Drawer so every "Sheet" in the app is a native-feeling,
// drag-to-dismiss BOTTOM sheet (per PRD §14: "All modals should be bottom sheets").
import * as React from "react";
import { Drawer as DrawerPrimitive } from "vaul";
import { cn } from "@/lib/utils";

function Sheet({ shouldScaleBackground = false, ...props }: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  return <DrawerPrimitive.Root data-slot="sheet" shouldScaleBackground={shouldScaleBackground} {...props} />;
}

function SheetTrigger(props: React.ComponentProps<typeof DrawerPrimitive.Trigger>) {
  return <DrawerPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose(props: React.ComponentProps<typeof DrawerPrimitive.Close>) {
  return <DrawerPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal(props: React.ComponentProps<typeof DrawerPrimitive.Portal>) {
  return <DrawerPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({ className, ...props }: React.ComponentProps<typeof DrawerPrimitive.Overlay>) {
  return (
    <DrawerPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn("fixed inset-0 z-50 bg-black/50", className)}
      {...props}
    />
  );
}

function SheetContent({
  className,
  children,
  showHandle = true,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Content> & { showHandle?: boolean }) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <DrawerPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "bg-card fixed inset-x-0 bottom-0 z-50 mt-24 flex h-auto max-h-[86%] flex-col rounded-t-[24px] border-t border-border shadow-[0_-10px_40px_rgba(0,0,0,0.2)] outline-none",
          className
        )}
        {...props}
      >
        {showHandle && <div className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-muted-foreground/25" />}
        {children}
      </DrawerPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sheet-header" className={cn("px-5 pt-2 pb-1 text-center", className)} {...props} />;
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sheet-footer" className={cn("mt-auto flex flex-col gap-2 px-5 pb-6", className)} {...props} />;
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-[17px] font-extrabold text-[var(--primary-dark)]", className)}
      {...props}
    />
  );
}

function SheetDescription({ className, ...props }: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-muted-foreground text-xs leading-relaxed", className)}
      {...props}
    />
  );
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription, SheetOverlay, SheetPortal };
