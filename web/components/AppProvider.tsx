"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { summariseBookings, type BookingsInfo } from "@/lib/csv";
import { deleteRun, getHealth, getRun, startRun } from "@/lib/api";
import { emptySettings, validateSettings } from "@/lib/settings";
import type { RunResult, RunState, SettingsFile, SyncResult } from "@/lib/types";

export type Step = "upload" | "settings" | "run" | "review" | "export";

interface AppState {
  step: Step;
  setStep: (s: Step) => void;
  mock: boolean | null;

  bookings: File | null;
  bookingsInfo: BookingsInfo | null;
  setBookings: (f: File | null) => Promise<void>;
  continuity: File | null;
  setContinuity: (f: File | null) => void;
  settingsFileName: string | null;
  loadSettingsFile: (f: File) => Promise<string | null>; // returns an error message or null

  settings: SettingsFile;
  setSettings: (s: SettingsFile | ((prev: SettingsFile) => SettingsFile)) => void;
  sync: SyncResult | null;
  setSync: (s: SyncResult | null) => void;

  mode: "new" | "improve";
  setMode: (m: "new" | "improve") => void;
  locks: Record<string, string>;
  toggleLock: (bookingId: string, carerId: string) => void;

  runState: RunState | null;
  runError: string | null;
  running: boolean;
  start: () => Promise<void>;
  result: RunResult | null;
  runId: string | null;
  query: string; // the top-bar search, used by the roster
  setQuery: (q: string) => void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("AppProvider missing");
  return v;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<Step>("upload");
  const [mock, setMock] = useState<boolean | null>(null);
  const [bookings, setBookingsFile] = useState<File | null>(null);
  const [bookingsInfo, setBookingsInfo] = useState<BookingsInfo | null>(null);
  const [continuity, setContinuity] = useState<File | null>(null);
  const [settingsFileName, setSettingsFileName] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsFile>(emptySettings);
  const [sync, setSync] = useState<SyncResult | null>(null);
  const [mode, setMode] = useState<"new" | "improve">("improve");
  const [locks, setLocks] = useState<Record<string, string>>({});
  const [runState, setRunState] = useState<RunState | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const runIdRef = useRef<string | null>(null);

  useEffect(() => {
    getHealth()
      .then((h) => setMock(h.mock || Boolean(h.fake_api)))
      .catch(() => setMock(null));
  }, []);

  // Results are deleted when the session ends.
  useEffect(() => {
    const onHide = () => {
      if (runIdRef.current) deleteRun(runIdRef.current);
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  const setBookings = useCallback(async (f: File | null) => {
    setBookingsFile(f);
    setBookingsInfo(f ? summariseBookings(await f.text()) : null);
  }, []);

  const loadSettingsFile = useCallback(async (f: File) => {
    try {
      const parsed = validateSettings(JSON.parse(await f.text()));
      if (!parsed.settings) return parsed.error ?? "Could not read the settings file.";
      setSettings(parsed.settings);
      setSettingsFileName(f.name);
      return null;
    } catch {
      return "The file is not valid JSON.";
    }
  }, []);

  const toggleLock = useCallback((bookingId: string, carerId: string) => {
    setLocks((prev) => {
      const next = { ...prev };
      if (next[bookingId]) delete next[bookingId];
      else next[bookingId] = carerId;
      return next;
    });
  }, []);

  const start = useCallback(async () => {
    if (!bookings) return;
    setRunError(null);
    setRunning(true);
    setResult(null);
    setRunState({ status: "queued", progress: 0, message: "Starting" });
    try {
      if (runIdRef.current) deleteRun(runIdRef.current);
      const id = await startRun({
        bookings,
        settings,
        continuity: continuity ?? undefined,
        mode,
        changeCostPence: settings.agency.change_cost_pence,
        locks,
      });
      runIdRef.current = id;
      setRunId(id);
      for (;;) {
        const s = await getRun(id);
        setRunState(s);
        if (s.status === "done" && s.result) {
          setResult(s.result);
          setStep("review");
          break;
        }
        if (s.status === "failed") {
          setRunError("The run failed. Check the bookings file and settings, then try again.");
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "The run failed.");
    } finally {
      setRunning(false);
    }
  }, [bookings, settings, continuity, mode, locks]);

  const value = useMemo<AppState>(
    () => ({
      step, setStep, mock,
      bookings, bookingsInfo, setBookings, continuity, setContinuity, settingsFileName, loadSettingsFile,
      settings, setSettings, sync, setSync,
      mode, setMode, locks, toggleLock,
      runState, runError, running, start, result, runId, query, setQuery,
    }),
    [step, mock, bookings, bookingsInfo, setBookings, continuity, settingsFileName, loadSettingsFile, settings, sync, mode, locks, toggleLock, runState, runError, running, start, result, runId, query],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
