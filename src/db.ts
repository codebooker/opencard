import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

// Re-export the pure types/helpers so existing `from "../db"` imports keep working.
export * from "./types";
