import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary";

const STYLES: Record<Variant, string> = {
  primary: "bg-accent text-accent-contrast hover:bg-accent-strong",
  secondary: "border border-line bg-raised text-fg hover:border-accent",
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
      className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${STYLES[variant]} ${className}`}
      {...props}
    />
  );
}
