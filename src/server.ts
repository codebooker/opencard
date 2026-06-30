import express from "express";
import cookieParser from "cookie-parser";
import path from "path";
import { config } from "./config";
import { cardsRouter } from "./routes/cards";
import { adminRouter } from "./routes/admin";
import { scimRouter } from "./routes/scim";
import { selfRouter } from "./routes/selfservice";
import { apiRouter } from "./routes/api";
import { previewRouter } from "./routes/preview";
import { uploadDir } from "./upload";
import {
  securityHeaders,
  requestLogger,
  rateLimit,
  csrfGuard,
  notFound,
  errorHandler,
} from "./middleware/hardening";

const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");

app.use(requestLogger);
app.use(securityHeaders);

// SCIM sends application/scim+json; admin forms send urlencoded; beacons send text/plain.
app.use(express.json({ type: ["application/json", "application/scim+json"], limit: "1mb" }));
app.use(express.text({ type: ["text/plain"], limit: "256kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(csrfGuard);

// ---- rate limiters ----
const loginLimiter = rateLimit({ name: "login", windowMs: 15 * 60_000, max: 10, methods: ["POST"] });
const scimLimiter = rateLimit({ name: "scim", windowMs: 60_000, max: 120 });
const apiLimiter = rateLimit({ name: "api", windowMs: 60_000, max: 240 });
const leadLimiter = rateLimit({
  name: "lead",
  windowMs: 60_000,
  max: 15,
  methods: ["POST"],
  match: (req) => req.path.endsWith("/connect"),
});
app.use("/admin/login", loginLimiter);
app.use("/me/devlogin", loginLimiter);

// Static assets (styles.css). Works in dev (src/public) and prod (dist/public).
app.use(express.static(path.join(__dirname, "public")));

// Uploaded logos/photos (persistent volume in Docker).
app.use(
  "/uploads",
  express.static(uploadDir, {
    maxAge: "7d",
    setHeaders: (res) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self' data:");
    },
  })
);

app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/", (_req, res) => res.redirect("/admin"));

app.use("/scim/v2", scimLimiter, scimRouter);
app.use("/api/v1", apiLimiter, apiRouter);
app.use("/preview", previewRouter);
app.use("/admin", adminRouter);
app.use("/me", selfRouter);
app.use("/c", leadLimiter, cardsRouter);

app.use(notFound);
app.use(errorHandler);

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`OpenCard listening on ${config.baseUrl} (port ${config.port})`);
});
