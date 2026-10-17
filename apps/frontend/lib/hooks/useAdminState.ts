"use client";
import { useCallback, useEffect, useState } from "react";
import { STRINGS } from "../constants";
import { fetchReports, fetchState } from "../services/admin";
import type { AdminReport, AdminState } from "../types";

export const useAdminState = () => {
  const [state, setState] = useState<AdminState | null>(null);
  const [reports, setReports] = useState<readonly AdminReport[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [next, nextReports] = await Promise.all([fetchState(), fetchReports()]);
      setState(next);
      setReports(nextReports.reports);
    } catch (error) {
      console.error(error);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), STRINGS.adminRefreshSeconds * 1000);
    return () => clearInterval(timer);
  }, [refresh]);

  return { state, reports, refresh };
};