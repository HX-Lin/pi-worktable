import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionInfo } from "@/lib/types";
import { defaultCwd, validateCwd } from "@/lib/api-client";
import { getRecentProjects } from "./helpers";

interface Params {
  allSessions: SessionInfo[];
  onSelectCwd: (cwd: string) => void;
}

/**
 * The "new project" picker: recent projects, the default cwd, the native folder
 * picker, and the manual path entry, plus the dropdown's open/close state.
 */
export function useProjectPicker({ allSessions, onSelectCwd: setSelectedCwd }: Params) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [projectFilter, setProjectFilter] = useState("");

  const [customPathOpen, setCustomPathOpen] = useState(false);
  const [customPathValue, setCustomPathValue] = useState("");
  const [customPathError, setCustomPathError] = useState<string | null>(null);
  const [customPathValidating, setCustomPathValidating] = useState(false);
  const customPathInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const commitCustomPath = useCallback(async () => {
    const path = customPathValue.trim();
    if (!path || customPathValidating) return;

    setCustomPathValidating(true);
    setCustomPathError(null);
    try {
      const data = await validateCwd(path);
      if (!data.ok) {
        setCustomPathError(data.error ?? "Invalid path");
        return;
      }
      setSelectedCwd(data.path ?? path);
      setCustomPathOpen(false);
      setCustomPathValue("");
      setDropdownOpen(false);
    } catch (e) {
      setCustomPathError(e instanceof Error ? e.message : String(e));
    } finally {
      setCustomPathValidating(false);
    }
  }, [customPathValue, customPathValidating, setSelectedCwd]);

  const handleDefaultCwd = useCallback(async () => {
    try {
      const data = await defaultCwd();
      if (data.cwd) {
        setSelectedCwd(data.cwd);
        setCustomPathOpen(false);
        setCustomPathValue("");
        setCustomPathError(null);
        setDropdownOpen(false);
      }
    } catch {
      // ignore
    }
  }, [setSelectedCwd]);

  /** Desktop-native directory picker (design §6.1). Falls back to path input. */
  const handlePickDirectory = useCallback(async () => {
    try {
      const dir = await window.piBridge?.selectDirectory?.();
      if (!dir) return;
      const data = await validateCwd(dir);
      if (!data.ok) {
        setCustomPathError(data.error ?? "Invalid directory");
        return;
      }
      setSelectedCwd(data.path ?? dir);
      setCustomPathOpen(false);
      setCustomPathValue("");
      setCustomPathError(null);
      setDropdownOpen(false);
    } catch (e) {
      setCustomPathError(e instanceof Error ? e.message : String(e));
    }
  }, [setSelectedCwd]);

  // Close the picker on an outside click.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setProjectFilter("");
        setCustomPathOpen(false);
        setCustomPathValue("");
        setCustomPathError(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const recentProjects = getRecentProjects(allSessions);
  const showProjectFilter = recentProjects.length > 8;
  const visibleProjects = projectFilter.trim()
    ? recentProjects.filter((p) => p.toLowerCase().includes(projectFilter.trim().toLowerCase()))
    : recentProjects;

  return {
    dropdownOpen,
    setDropdownOpen,
    dropdownRef,
    projectFilter,
    setProjectFilter,
    customPathOpen,
    setCustomPathOpen,
    customPathValue,
    setCustomPathValue,
    customPathError,
    setCustomPathError,
    customPathValidating,
    customPathInputRef,
    commitCustomPath,
    handleDefaultCwd,
    handlePickDirectory,
    showProjectFilter,
    visibleProjects,
    recentProjects,
    onSelectCwd: setSelectedCwd,
  };
}

export type ProjectPickerController = ReturnType<typeof useProjectPicker>;
