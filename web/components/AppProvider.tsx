"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { summariseBookings, type BookingsInfo } from "@/lib/csv";
import { deleteRun, getHealth, getRun, startRun } from "@/lib/api";
import { emptySettings, validateSettings } from "@/lib/settings";
import type { LearnResult, RunResult, RunState, SettingsFile, SyncResult } from "@/lib/types";
import { nextMondays } from "@/lib/schedules";

export type Step = "upload" | "settings" | "schedules" | "run" | "review" | "export";
export type PlanSource = "bookings" | "schedules";

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

  clientList: File | null; // CareLineLive client CSV (Schedules screen), sent with every run
  setClientList: (f: File | null) => void;
  draftFile: File | null; // allocation.csv exported from an earlier draft
  setDraftFile: (f: File | null) => void;
  source: PlanSource;
  setSource: (s: PlanSource) => void;
  weekStart: string;
  setWeekStart: (s: string) => void;
  learned: LearnResult | null; // the last "Learn schedules" result (one-offs and flags)
  setLearned: (l: LearnResult | null) => void;

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
  const [mode, setModeState] = useState<"new" | "improve">("improve");
  const [clientList, setClientList] = useState<File | null>(null);
  const [draftFile, setDraftFileState] = useState<File | null>(null);
  const [source, setSourceState] = useState<PlanSource>("bookings");
  const [weekStart, setWeekStart] = useState<string>(() => nextMondays(1)[0]);
  const [learned, setLearned] = useState<LearnResult | null>(null);
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

  // A draft file means "Improve my rota"; a plan from schedules is always the whole week.
  const setDraftFile = useCallback((f: File | null) => {
    setDraftFileState(f);
    if (f) setModeState("improve");
  }, []);
  const setSource = useCallback((s: PlanSource) => {
    setSourceState(s);
    if (s === "schedules") setModeState("new");
  }, []);
  const setMode = useCallback((m: "new" | "improve") => setModeState(draftFile && m === "new" ? "improve" : m), [draftFile]);

  const toggleLock = useCallback((bookingId: string, carerId: string) => {
    setLocks((prev) => {
      const next = { ...prev };
      if (next[bookingId]) delete next[bookingId];
      else next[bookingId] = carerId;
      return next;
    });
  }, []);

  const start = useCallback(async () => {
    if (source === "bookings" && !bookings) return;
    setRunError(null);
    setRunning(true);
    setResult(null);
    setRunState({ status: "queued", progress: 0, message: "Starting" });
    try {
      if (runIdRef.current) deleteRun(runIdRef.current);
      const id = await startRun({
        source,
        bookings: bookings ?? undefined,
        weekStart,
        clientList: clientList ?? undefined,
        draft: source === "bookings" ? (draftFile ?? undefined) : undefined,
        settings,
        continuity: continuity ?? undefined,
        mode: source === "schedules" ? "new" : draftFile ? "improve" : mode,
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
          setRunError("Planning failed. Check the bookings file and settings, then try again.");
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Planning failed.");
    } finally {
      setRunning(false);
    }
  }, [bookings, settings, continuity, mode, locks, source, weekStart, draftFile, clientList]);

  const value = useMemo<AppState>(
    () => ({
      step, setStep, mock,
      bookings, bookingsInfo, setBookings, continuity, setContinuity, settingsFileName, loadSettingsFile,
      settings, setSettings, sync, setSync,
      clientList, setClientList, draftFile, setDraftFile, source, setSource, weekStart, setWeekStart, learned, setLearned,
      mode, setMode, locks, toggleLock,
      runState, runError, running, start, result, runId, query, setQuery,
    }),
    [step, mock, bookings, bookingsInfo, setBookings, continuity, settingsFileName, loadSettingsFile, settings, sync, mode, setMode, draftFile, setDraftFile, clientList, source, setSource, weekStart, learned, locks, toggleLock, runState, runError, running, start, result, runId, query],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
