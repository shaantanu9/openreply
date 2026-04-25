import { NavBar } from "@/components/shell/NavBar";
import { Footer } from "@/components/shell/Footer";

type Props = {
  children: React.ReactNode;
  /** marketing = fixed translucent nav (needs hero padding-top=60); compact = sticky slim bar */
  navVariant?: "marketing" | "compact";
  withFooter?: boolean;
  /** Extra top padding to clear the 60px fixed nav on non-hero pages. */
  offsetTop?: boolean;
};

export function SiteShell({
  children,
  navVariant = "marketing",
  withFooter = true,
  offsetTop = false,
}: Props) {
  const isMarketing = navVariant === "marketing";
  return (
    <div className="flex min-h-screen flex-col">
      <NavBar variant={navVariant} />
      <main
        className={
          isMarketing && offsetTop ? "flex-1 pt-[60px]" : "flex-1"
        }
      >
        {children}
      </main>
      {withFooter ? <Footer /> : null}
    </div>
  );
}
