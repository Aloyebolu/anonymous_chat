"use client";
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_USER } from "../constants";

export const useUserIdentity = () => {
  const [user, setUser] = useState<string>(DEFAULT_USER);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem("chat.user") : null;
    if (stored) setUser(stored);
  }, []);

  const update = useCallback((next: string) => {
    setUser(next);
    if (typeof window !== "undefined") window.localStorage.setItem("chat.user", next);
  }, []);

  return { user, setUser: update };
};