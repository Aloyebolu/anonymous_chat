"use client";
import { useCallback } from "react";
import { sendInbound } from "../services/api";
import type { SendPayload } from "../services/api";

export const useSendMessage = (user: string) => {
  return useCallback(async (payload: Omit<SendPayload, "user">) => {
    if (!user) return;
    await sendInbound({ user, ...payload });
  }, [user]);
};