import { CookieOptions } from "express";
import { config } from "./config";

export function cookieOptions(maxAge?: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: config.secureCookies,
    path: "/",
    ...(maxAge ? { maxAge } : {}),
  };
}

export function clearCookieOptions(): CookieOptions {
  return {
    sameSite: "lax",
    secure: config.secureCookies,
    path: "/",
  };
}
