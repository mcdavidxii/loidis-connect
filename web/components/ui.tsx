"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { IconError, IconInfo, IconOk, IconWarning } from "./icons";

type Variant = "primary" | "secondary" | "ghost";

// One primary action per screen (36px); everything else is 32px.
export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const base =
    "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";
  const styles: Record<Variant, string> = {
    primary: "h-9 bg-brand text-white hover:bg-brand-strong",
    secondary: "h-8 border border-line bg-surface text-ink hover:bg-hover",
    ghost: "h-8 text-ink hover:bg-hover",
  };
  return <button type="button" className={`${base} ${styles[variant]} ${className}`} {...props} />;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

// A plain section: title, hairline divider, content. No box.
export function Section({
  title,
  info,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  info?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mb-8 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-3 border-b border-line pb-2">
          <h2 className="flex items-center gap-1.5 text-base">
            {title}
            {info && <InfoTip text={info} />}
          </h2>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

// Small (i) with the explanation in a tooltip; also readable by screen readers.
export function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <span
        tabIndex={0}
        role="img"
        aria-label={`Info: ${text}`}
        className="inline-flex cursor-help text-muted hover:text-ink"
      >
        <IconInfo aria-hidden className="h-4 w-4" />
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-6 z-30 hidden w-72 rounded-md border border-line bg-surface p-2.5 text-xs font-normal text-ink shadow-md group-focus-within:block group-hover:block"
      >
        {text}
      </span>
    </span>
  );
}

type Tone = "info" | "warn" | "bad" | "ok";
const TONES: Record<Tone, { cls: string; Icon: typeof IconInfo; label: string; icon: string }> = {
  info: { cls: "bg-info-soft", Icon: IconInfo, label: "Note", icon: "text-info" },
  warn: { cls: "bg-warn-soft", Icon: IconWarning, label: "Warning", icon: "text-warn" },
  bad: { cls: "bg-bad-soft", Icon: IconError, label: "Problem", icon: "text-bad" },
  ok: { cls: "bg-ok-soft", Icon: IconOk, label: "OK", icon: "text-ok" },
};

// Compact inline notice: a muted tint, icon and one line (optionally more below).
export function Notice({ tone = "info", title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  const { cls, Icon, label, icon } = TONES[tone];
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={`flex gap-2 rounded-md border border-line px-3 py-2 text-sm ${cls}`}>
      <Icon aria-hidden className={`mt-0.5 h-4 w-4 shrink-0 ${icon}`} />
      <div className="min-w-0">
        {title && (
          <p className="font-semibold">
            <span className="sr-only">{label}: </span>
            {title}
          </p>
        )}
        {children && <div className={title ? "mt-0.5 text-muted" : ""}>{children}</div>}
      </div>
    </div>
  );
}

export function Badge({
  tone,
  icon,
  children,
}: {
  tone: "ok" | "warn" | "bad" | "info" | "neutral";
  icon?: ReactNode;
  children: ReactNode;
}) {
  const cls = {
    ok: "bg-ok-soft text-ok",
    warn: "bg-warn-soft text-warn",
    bad: "bg-bad-soft text-bad",
    info: "bg-info-soft text-info",
    neutral: "bg-hover text-muted",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-semibold ${cls}`}>
      {icon}
      {children}
    </span>
  );
}

export const inputCls = "h-8 rounded-md border border-line bg-surface px-2 text-sm text-ink placeholder:text-muted";

// Table class names used by every list in the app.
export const tableCls = "w-full border-collapse text-left text-sm";
export const thCls = "border-b border-line px-3 py-2 text-xs font-semibold text-muted";
export const tdCls = "border-b border-line px-3 py-2 align-top";

// Radio rows: a compact bordered list, selected row marked with a tick as well as colour.
export function RadioRow({
  name,
  checked,
  onChange,
  title,
  text,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  text?: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand ${
        checked ? "border-brand bg-brand-soft" : "border-line bg-surface hover:bg-hover"
      }`}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="mt-1 accent-[#0f766e]" />
      <span>
        <span className="block font-semibold">{title}</span>
        {text && <span className="block text-xs text-muted">{text}</span>}
      </span>
    </label>
  );
}
