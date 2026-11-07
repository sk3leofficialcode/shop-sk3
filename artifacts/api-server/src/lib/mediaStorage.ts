import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import type { File } from "@google-cloud/storage";
import type { Express } from "express";
import { objectStorageClient, ObjectStorageService } from "./objectStorage";

const objectStorageService = new ObjectStorageService();

function storageLocation(): { bucketName: string; prefix: string } {
  const parts = objectStorageService.getPrivateObjectDir().split("/").filter(Boolean);
  const bucketName = parts.shift();
  if (!bucketName) throw new Error("Object Storage bucket is not configured");
  return { bucketName, prefix: parts.join("/") };
}

function mediaExtension(file: Express.Multer.File): string {
  const ext = file.originalname.toLowerCase().split(".").pop() ?? "";
  const allowed: Record<string, string[]> = {
    mp4: ["video/mp4"],
    mp3: ["audio/mpeg", "audio/mp3"],
    png: ["image/png"],
    jpg: ["image/jpeg"],
    jpeg: ["image/jpeg"],
  };
  if (!allowed[ext]?.includes(file.mimetype.toLowerCase())) {
    throw new Error("Choose a matching MP4, MP3, PNG, JPG, or JPEG file");
  }
  return `.${ext}`;
}

export function mediaTypeForFile(file: Express.Multer.File): "video" | "audio" | "image" {
  const ext = file.originalname.toLowerCase().split(".").pop() ?? "";
  if (ext === "mp4") return "video";
  if (ext === "mp3") return "audio";
  return "image";
}

export function getMediaUrl(mediaPath: string): string {
  return `/api/storage/objects/${mediaPath.replace(/^\/objects\//, "")}`;
}

export async function saveUploadedMedia(
  file: Express.Multer.File,
): Promise<{ mediaPath: string; mediaUrl: string; mediaType: "video" | "audio" | "image" }> {
  const extension = mediaExtension(file);
  const { bucketName, prefix } = storageLocation();
  const filename = `${randomUUID()}${extension}`;
  const objectName = [prefix, "uploads", filename].filter(Boolean).join("/");
  const destination = objectStorageClient.bucket(bucketName).file(objectName);

  await pipeline(
    createReadStream(file.path),
    destination.createWriteStream({
      metadata: {
        contentType: file.mimetype,
        cacheControl: "public, max-age=31536000, immutable",
      },
    }),
  );

  const mediaPath = `/objects/uploads/${filename}`;
  return { mediaPath, mediaUrl: getMediaUrl(mediaPath), mediaType: mediaTypeForFile(file) };
}

export async function deleteStoredMedia(mediaPath: string): Promise<void> {
  const match = /^\/objects\/uploads\/([a-f0-9-]+\.(?:mp4|mp3|png|jpg|jpeg))$/i.exec(mediaPath);
  if (!match) return;
  const { bucketName, prefix } = storageLocation();
  const objectName = [prefix, "uploads", match[1]].filter(Boolean).join("/");
  await objectStorageClient.bucket(bucketName).file(objectName).delete({ ignoreNotFound: true });
}

export async function getStoredMedia(mediaPath: string): Promise<File> {
  return objectStorageService.getObjectEntityFile(mediaPath);
}

export { objectStorageService };
