// === src/components/ui/toaster.tsx ===
// Mounts Sonner's viewport, themed to the FoodHubbie Rider palette.
// hooks/use-toast.ts dispatches into this via the `sonner` toast() API.
import { Toaster as Sonner, type ToasterProps } from "sonner";

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="light"
      position="top-center"
      richColors
      closeButton={false}
      toastOptions={{
        style: {
          fontFamily: "var(--font-sans)",
          borderRadius: "14px",
          fontSize: "13px",
          fontWeight: 600,
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
