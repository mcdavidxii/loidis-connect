"use client";

import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const styles: Record<Variant, string> = {
    primary: "bg-brand text-white hover:bg-brand-strong",
    secondary: "border border-line bg-surface text-ink hover:bg-canvas",
    ghost: "text-brand hover:bg-brand-soft",
  };
  return <button type="button" className={`${base} ${styles[variant]} ${className}`} {...props} />;
}

export function Card({ title, children, actions, className = "" }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-surface p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageTitle({ title, intro }: { title: string; intro?: string }) {
  return (
    <header className="mb-5">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {intro && <p className="mt-1 max-w-3xl text-sm text-muted">{intro}</p>}
    </header>
  );
}

type Tone = "info" | "warn" | "bad" | "ok";
const TONES: Record<Tone, { cls: string; Icon: typeof Info; label: string }> = {
  info: { cls: "border-line bg-brand-soft text-ink", Icon: Info, label: "Note" },
  warn: { cls: "border-warn/40 bg-warn-soft text-ink", Icon: AlertTriangle, label: "Warning" },
  bad: { cls: "border-bad/40 bg-bad-soft text-ink", Icon: XCircle, label: "Problem" },
  ok: { cls: "border-ok/40 bg-ok-soft text-ink", Icon: CheckCircle2, label: "OK" },
};

export function Banner({ tone = "info", title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  const { cls, Icon, label } = TONES[tone];
  const iconColor = { info: "text-brand", warn: "text-warn", bad: "text-bad", ok: "text-ok" }[tone];
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={`flex gap-3 rounded-md border p-3 text-sm ${cls}`}>
      <Icon aria-hidden className={`mt-0.5 h-5 w-5 shrink-0 ${iconColor}`} />
      <div>
        <p className="font-semibold">
          <span className="sr-only">{label}: </span>
          {title}
        </p>
        {children && <div className="mt-0.5">{children}</div>}
      </div>
    </div>
  );
}

export function Badge({ tone, icon, children }: { tone: "ok" | "warn" | "bad" | "moved" | "locked" | "neutral"; icon?: ReactNode; children: ReactNode }) {
  const cls = {
    ok: "bg-ok-soft text-ok",
    warn: "bg-warn-soft text-warn",
    bad: "bg-bad-soft text-bad",
    moved: "bg-moved-soft text-moved",
    locked: "bg-locked-soft text-locked",
    neutral: "bg-canvas text-muted",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${cls}`}>
      {icon}
      {children}
    </span>
  );
}

export const inputCls =
  "rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-muted";
