import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";

// Uploaded images are stored on disk and served from /uploads. In Docker this
// directory is a persistent volume (see docker-compose.yml) so logos/photos
// survive restarts. Override location with UPLOAD_DIR.
export const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const ALLOWED_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif"]);

// Renderable image mime types -> a safe file extension. We validate by MIME type
// (what the browser actually sends) rather than the filename, so logos with an
// unusual or missing extension still upload correctly instead of being dropped.
const EXT_FOR_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "image/avif": ".avif",
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    let ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) ext = EXT_FOR_MIME[file.mimetype] || ".png";
    cb(null, `${crypto.randomBytes(12).toString("hex")}${ext}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    if (EXT_FOR_MIME[file.mimetype]) return cb(null, true);
    // Reject with an error (surfaced to the user) instead of silently dropping.
    cb(new Error("Unsupported image type. Use PNG, JPG, WEBP, GIF, SVG, or AVIF."));
  },
});

// Public URL path for a stored upload.
export const publicPath = (filename: string) => `/uploads/${filename}`;

// Pull a single uploaded file (by field name) out of a multer .fields() request.
export function uploadedUrl(req: any, field: string): string | null {
  const f = req.files?.[field]?.[0] || (req.file && req.file.fieldname === field ? req.file : null);
  return f ? publicPath(f.filename) : null;
}
