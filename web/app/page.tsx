import { AppProvider } from "@/components/AppProvider";
import { Shell } from "@/components/Shell";

export default function Home() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
