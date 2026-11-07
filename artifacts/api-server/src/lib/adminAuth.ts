import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

const COOKIE_NAME = "sk3le_admin";
const SESSION_SECONDS = 8 * 60 * 60;

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function signingKey(): string {
  return process.env.SESSION_SECRET ?? "";
}

function signature(expiresAt: string): string {
  return createHmac("sha256", signingKey()).update(expiresAt).digest("hex");
}

export function setAdminSession(req: Request, res: Response): void {
  const expiresAt = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
  const value = `${expiresAt}.${signature(expiresAt)}`;
  const secure = req.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${value}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${SESSION_SECONDS}${secure ? "; Secure" : ""}`,
  );
}

export function clearAdminSession(req: Request, res: Response): void {
  const secure = req.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${secure ? "; Secure" : ""}`,
  );
}

export function isAdminSession(req: Request): boolean {
  if (!signingKey()) return false;
  const cookieHeader = req.headers.cookie ?? "";
  const pair = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (!pair) return false;

  const value = pair.slice(COOKIE_NAME.length + 1);
  const separator = value.indexOf(".");
  if (separator < 1) return false;

  const expiresAt = value.slice(0, separator);
  const providedSignature = value.slice(separator + 1);
  if (!/^\d+$/.test(expiresAt) || Number(expiresAt) <= Math.floor(Date.now() / 1000)) {
    return false;
  }
  return safeEqual(providedSignature, signature(expiresAt));
}

export function verifyAdminPin(pin: string): boolean {
  const configuredPin = process.env.ADMIN_PIN ?? "";
  return Boolean(configuredPin) && safeEqual(pin, configuredPin);
}

export function verifyTelegramOwner(initData: string): boolean {
  const botToken = process.env.BOT_TOKEN;
  if (!botToken || !initData) return false;

  try {
    const params = new URLSearchParams(initData);
    const providedHash = params.get("hash");
    const authDate = Number(params.get("auth_date"));
    if (!providedHash || !Number.isFinite(authDate)) return false;

    const now = Math.floor(Date.now() / 1000);
    if (authDate > now + 60 || now - authDate > 24 * 60 * 60) return false;

    const dataCheckString = [...params.entries()]
      .filter(([key]) => key !== "hash")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
    const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
    const expectedHash = createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");
    if (!safeEqual(providedHash, expectedHash)) return false;

    const userValue = params.get("user");
    if (!userValue) return false;
    const user = JSON.parse(userValue) as { username?: string };
    return user.username?.toLowerCase() === "sk3lefake";
  } catch {
    return false;
  }
}
