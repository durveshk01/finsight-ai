import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

export function Button({ children, className = "", variant = "primary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const variants = {
    primary: "bg-[#147354] text-white hover:bg-[#105d44] shadow-sm",
    secondary: "border border-[var(--line)] bg-[var(--surface)] text-[var(--foreground)] hover:bg-[var(--background)]",
    ghost: "text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]",
    danger: "bg-[#fff0ee] text-[#b94337] hover:bg-[#ffe4df]",
  };
  return <button className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`} {...props}>{children}</button>;
}

export function CardTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return <div className="mb-5 flex items-start justify-between gap-3"><div><h2 className="text-[15px] font-semibold tracking-[-.01em]">{title}</h2>{subtitle && <p className="mt-1 text-xs text-[var(--muted)]">{subtitle}</p>}</div>{action}</div>;
}

export function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`grid gap-1.5 text-xs font-medium text-[var(--muted)] ${className}`}>{label}{children}</label>;
}

export const inputClass = "w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted)] focus:border-[#55a580] focus:ring-2 focus:ring-[#147354]/10";

