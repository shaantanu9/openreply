type Props = {
  size?: number;
  variant?: "dark" | "cream-outline";
};

/**
 * Brand mark used inside NavBar, Footer, left auth panel, etc.
 * The 18×18 SVG is vector — `size` controls the wrapper box, SVG scales with it.
 */
export function LogoMark({ size = 30, variant = "dark" }: Props) {
  const svgSize = Math.round(size * 0.6);
  return (
    <div
      className={
        variant === "cream-outline"
          ? "inline-flex items-center justify-center rounded-[8px] border border-white/15 bg-white/[0.08]"
          : "inline-flex items-center justify-center rounded-[7px] bg-[var(--dark)]"
      }
      style={{ width: size, height: size }}
    >
      <svg
        width={svgSize}
        height={svgSize}
        viewBox="0 0 18 18"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="9" cy="9" r="7" stroke="#E07B3C" strokeWidth="1.5" />
        <circle cx="9" cy="9" r="3" fill="#E07B3C" />
      </svg>
    </div>
  );
}
