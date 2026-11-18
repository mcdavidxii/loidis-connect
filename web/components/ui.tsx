"use client";

import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { IconError, IconInfo, IconOk, IconWarning } from "./icons";

type Variant = "primary" | "secondary" | "ghost";

// One solid blue primary action per screen; everything else is secondary or ghost.
export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const base =
    "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";
  const styles: Record<Variant, string> = {
    primary: "h-9 bg-brand text-white shadow-sm hover:bg-brand-strong",
    secondary: "h-9 border border-line bg-surface text-ink hover:bg-hover",
    ghost: "h-9 text-ink hover:bg-hover",
  };
  return <button type="button" className={`${base} ${styles[variant]} ${className}`} {...props} />;
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

// A white rounded panel with a soft shadow and a title row.
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
    <section className={`panel mb-6 p-6 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-3">
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
      <span tabIndex={0} role="img" aria-label={`Info: ${text}`} className="inline-flex cursor-help text-muted hover:text-ink">
        <IconInfo aria-hidden className="h-4 w-4" />
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-6 z-30 hidden w-72 rounded-lg border border-line bg-surface p-3 text-xs font-normal text-ink shadow-lg group-focus-within:block group-hover:block"
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

export function Notice({ tone = "info", title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  const { cls, Icon, label, icon } = TONES[tone];
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={`flex gap-2.5 rounded-xl px-4 py-3 text-sm ${cls}`}>
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

// Soft status pill with text (never colour alone).
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
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {icon}
      {children}
    </span>
  );
}

export function StatusDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted">
      <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

// Soft tinted initials circle.
const AVATAR_TINTS = ["#dbeafe", "#dcfce7", "#fef3c7", "#ede9fe", "#ffe4e6", "#ccfbf1", "#e2e8f0"];
export function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  const parts = name.replace(/[(),]/g, " ").split(/\s+/).filter(Boolean);
  const initials = ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  const tint = AVATAR_TINTS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TINTS.length];
  return (
    <span
      aria-hidden
      className="inline-grid shrink-0 place-items-center rounded-full text-[10px] font-semibold text-ink"
      style={{ width: size, height: size, background: tint }}
    >
      {initials}
    </span>
  );
}

// Segmented control / pill tabs: the selected option is bold and raised, not only coloured.
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-0.5 rounded-lg bg-hover p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm ${
            value === o.id ? "bg-surface font-semibold text-ink shadow-sm" : "text-muted hover:text-ink"
          }`}
        >
          {o.label}
          {o.count != null && <span className={`text-xs ${value === o.id ? "text-brand" : "text-muted"}`}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

// Overview figure: an icon in a soft tinted circle, label, big number and a small delta.
export function StatPanel({
  icon,
  label,
  value,
  sub,
  children,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="panel flex items-start gap-3 p-4">
      <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted">{label}</p>
        <p className="text-xl font-semibold leading-tight">{value}</p>
        {sub && <p className="text-xs text-muted">{sub}</p>}
        {children}
      </div>
    </div>
  );
}

export const inputCls = "h-9 rounded-lg border border-line bg-surface px-2.5 text-sm text-ink placeholder:text-muted";

// Table class names used by every list in the app.
export const tableCls = "w-full border-collapse text-left text-sm";
export const thCls = "border-b border-line px-3 py-2.5 text-xs font-semibold text-muted";
export const tdCls = "border-b border-line px-3 py-2.5 align-top";

export function RadioRow({
  name,
  checked,
  onChange,
  title,
  text,
  disabled,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  text?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"} items-start gap-2.5 rounded-xl border px-4 py-3 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand ${
        checked ? "border-brand bg-brand-soft" : "border-line bg-surface hover:bg-hover"
      }`}
    >
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} className="mt-1 accent-[#0f7b6c]" />
      <span>
        <span className="block font-semibold">{title}</span>
        {text && <span className="block text-xs text-muted">{text}</span>}
      </span>
    </label>
  );
}

// A long list scrolls inside its panel (about 400px) with a sticky header, and can be expanded.
// The scroll area is focusable so the keyboard can scroll it.
export function ScrollBox({
  count,
  threshold = 8,
  label,
  children,
}: {
  count: number;
  threshold?: number;
  label: string;
  children: ReactNode;
}) {
  const [all, setAll] = useState(false);
  const long = count > threshold;
  return (
    <div>
      <div
        className={`scrollbox ${long && !all ? "max-h-[400px] overflow-auto" : ""}`}
        {...(long && !all ? { tabIndex: 0, role: "region", "aria-label": `${label}, scrollable` } : {})}
      >
        {children}
      </div>
      {long && (
        <div className="mt-2 flex justify-end">
          <button type="button" aria-expanded={all} onClick={() => setAll(!all)} className="rounded-lg px-2 py-1 text-xs font-semibold text-brand-strong hover:bg-hover">
            {all ? "Show less" : `Show all ${count}`}
          </button>
        </div>
      )}
    </div>
  );
}
