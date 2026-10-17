"use client";
import { useCallback } from "react";
import { sendInbound } from "../services/api";

export const useSendMessage = (user: string) => {
  return useCallback(async (payload: { text?: string; actionId?: string }) => {
    if (!user) return;
    await sendInbound({ user, ...payload });
  }, [user]);
};