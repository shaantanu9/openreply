import Link from "next/link";
import { LogoMark } from "@/components/brand/LogoMark";
import { BRAND, ROUTES } from "@/lib/constants";

type Props = {
  size?: "sm" | "md";
  tone?: "dark" | "white";
  href?: string;
};

export function Logo({ size = "md", tone = "dark", href = ROUTES.home }: Props) {
  const markSize = size === "sm" ? 28 : 30;
  const nameSize = size === "sm" ? 16 : 17;

  return (
    <Link href={href} className="inline-flex items-center gap-2">
      <LogoMark size={markSize} variant={tone === "white" ? "cream-outline" : "dark"} />
      <span
        className="font-serif font-medium"
        style={{
          fontSize: nameSize,
          color: tone === "white" ? "var(--white)" : "var(--dark)",
          letterSpacing: "-0.3px",
        }}
      >
        {BRAND.name}
      </span>
    </Link>
  );
}
