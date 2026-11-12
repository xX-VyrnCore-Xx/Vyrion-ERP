import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary";

const STYLES: Record<Variant, string> = {
  primary:
    "bg-[image:var(--gradient-accent)] text-accent-contrast shadow-glow hover:brightness-110",
  secondary: "border border-line bg-raised text-fg hover:border-accent hover:bg-surface",
};

export function Button({
  variant = "secondary",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type={type}
      className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-[filter,background-color,border-color,transform] duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${STYLES[variant]} ${className}`}
      {...props}
    />
  );
}
