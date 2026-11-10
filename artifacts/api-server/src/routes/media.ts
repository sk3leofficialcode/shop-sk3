import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { unlink } from "node:fs/promises";
import { Readable } from "node:stream";
import multer from "multer";
import { Router, type IRouter, type Request, type Response } from "express";
import { UploadMediaResponse } from "@workspace/api-zod";
import { isAdminSession } from "../lib/adminAuth";
import { deleteStoredMedia, getMediaUrl, getStoredMedia, mediaTypeForFile, objectStorageService, saveUploadedMedia } from "../lib/mediaStorage";
import { ObjectNotFoundError } from "../lib/objectStorage";

const router: IRouter = Router();
const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase();
      callback(null, `${randomUUID()}${extension}`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
});

router.post("/admin/media", (req: Request, res: Response): void => {
  if (!isAdminSession(req)) {
    res.status(401).json({ error: "Admin authentication required" });
    return;
  }

  upload.single("file")(req, res, (error: unknown): void => {
    if (error) {
      req.log.warn({ err: error }, "Rejected store media upload");
      res.status(400).json({ error: "Upload failed. Use MP4, MP3, PNG, JPG, or JPEG up to 100 MB." });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "Choose a media file to upload" });
      return;
    }

    void (async () => {
      let storedMediaPath: string | undefined;
      try {
        const stored = await saveUploadedMedia(req.file!);
        storedMediaPath = stored.mediaPath;
        const response = UploadMediaResponse.parse({
          ...stored,
          mediaContentType: req.file!.mimetype,
          fileName: path.basename(req.file!.originalname),
        });
        res.status(201).json(response);
        storedMediaPath = undefined;
      } catch (uploadError) {
        if (storedMediaPath) {
          await deleteStoredMedia(storedMediaPath).catch((cleanupError: unknown) => {
            req.log.warn({ err: cleanupError, mediaPath: storedMediaPath }, "Could not remove orphaned store media");
          });
        }
        req.log.error({ err: uploadError }, "Could not save store media");
        res.status(400).json({
          error: uploadError instanceof Error ? uploadError.message : "Could not save the media file",
        });
      } finally {
        if (req.file?.path) {
          await unlink(req.file.path).catch((cleanupError: unknown) => {
            req.log.warn({ err: cleanupError }, "Could not remove temporary upload");
          });
        }
      }
    })();
  });
});

router.get("/storage/objects/*path", async (req: Request, res: Response): Promise<void> => {
  const raw = req.params.path;
  const suffix = Array.isArray(raw) ? raw.join("/") : raw;
  const mediaPath = `/objects/${suffix}`;
  if (!/^\/objects\/uploads\/[a-f0-9-]+\.(?:mp4|mp3|png|jpg|jpeg)$/i.test(mediaPath)) {
    res.status(404).json({ error: "Media not found" });
    return;
  }

  try {
    const file = await getStoredMedia(mediaPath);
    const response = await objectStorageService.downloadObject(file, 86400);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Media not found" });
      return;
    }
    req.log.error({ err: error }, "Could not serve store media");
    res.status(500).json({ error: "Could not serve media" });
  }
});

export default router;
