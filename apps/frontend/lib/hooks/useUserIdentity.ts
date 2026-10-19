"use client";

import { useCallback, useEffect, useState } from "react";

export const useUserIdentity = () => {
  const [user, setUser] = useState("");
  const [token, setToken] = useState("");

  useEffect(() => {
    setUser(window.sessionStorage.getItem("chat.username") ?? "");
    setToken(window.sessionStorage.getItem("chat.token") ?? "");
  }, []);

  const signIn = useCallback((username: string, accessToken: string) => {
    setUser(username);
    setToken(accessToken);
    window.sessionStorage.setItem("chat.username", username);
    window.sessionStorage.setItem("chat.token", accessToken);
  }, []);

  const signOut = useCallback(() => {
    setUser("");
    setToken("");
    window.sessionStorage.removeItem("chat.username");
    window.sessionStorage.removeItem("chat.token");
  }, []);

  return { user, token, signIn, signOut };
};
