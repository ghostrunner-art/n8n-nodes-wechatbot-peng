/**
 * WechatCore - 微信核心通信类
 *
 * 从 @tencent-weixin/openclaw-weixin 提取的底层核心逻辑
 * 剥离所有 OpenClaw Gateway 外壳与本地文件系统依赖，
 * 保留原始 HTTP 请求参数、加密特征和协议细节。
 *
 * 职责单一：仅负责网络通信协议，不处理任何文件持久化或 UI 交互。
 */

import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import sharp from "sharp";

// =============================================================================
// 类型定义 (原封不动从 src/api/types.ts 提取)
// =============================================================================

/** Common request metadata attached to every CGI request. */
export interface BaseInfo {
  channel_version?: string;
}

/** proto: UploadMediaType */
export const UploadMediaType = {
  IMAGE: 1,
  VIDEO: 2,
  FILE: 3,
  VOICE: 4,
} as const;

export interface GetUploadUrlReq {
  filekey?: string;
  media_type?: number;
  to_user_id?: string;
  rawsize?: number;
  rawfilemd5?: string;
  filesize?: number;
  thumb_rawsize?: number;
  thumb_rawfilemd5?: string;
  thumb_filesize?: number;
  no_need_thumb?: boolean;
  aeskey?: string;
}

export interface GetUploadUrlResp {
  upload_param?: string;
  thumb_upload_param?: string;
  upload_full_url?: string;
}

export const MessageType = {
  NONE: 0,
  USER: 1,
  BOT: 2,
} as const;

export const MessageItemType = {
  NONE: 0,
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
} as const;

export const MessageState = {
  NEW: 0,
  GENERATING: 1,
  FINISH: 2,
} as const;

export interface TextItem {
  text?: string;
}

/** CDN media reference; aes_key is base64-encoded bytes in JSON. */
export interface CDNMedia {
  encrypt_query_param?: string;
  aes_key?: string;
  encrypt_type?: number;
  full_url?: string;
}

export interface ImageItem {
  media?: CDNMedia;
  thumb_media?: CDNMedia;
  aeskey?: string;
  url?: string;
  mid_size?: number;
  thumb_size?: number;
  thumb_height?: number;
  thumb_width?: number;
  hd_size?: number;
}

export interface VoiceItem {
  media?: CDNMedia;
  encode_type?: number;
  bits_per_sample?: number;
  sample_rate?: number;
  playtime?: number;
  text?: string;
}

export interface FileItem {
  media?: CDNMedia;
  file_name?: string;
  md5?: string;
  len?: string;
}

export interface VideoItem {
  media?: CDNMedia;
  video_size?: number;
  play_length?: number;
  video_md5?: string;
  thumb_media?: CDNMedia;
  thumb_size?: number;
  thumb_height?: number;
  thumb_width?: number;
}

export interface RefMessage {
  message_item?: MessageItem;
  title?: string;
}

export interface MessageItem {
  type?: number;
  create_time_ms?: number;
  update_time_ms?: number;
  is_completed?: boolean;
  msg_id?: string;
  ref_msg?: RefMessage;
  text_item?: TextItem;
  image_item?: ImageItem;
  voice_item?: VoiceItem;
  file_item?: FileItem;
  video_item?: VideoItem;
}

/** Unified message (proto: WeixinMessage). */
export interface WeixinMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  update_time_ms?: number;
  delete_time_ms?: number;
  session_id?: string;
  group_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: MessageItem[];
  context_token?: string;
}

/** GetUpdates request: bytes fields are base64 strings in JSON. */
export interface GetUpdatesReq {
  sync_buf?: string;
  get_updates_buf?: string;
}

/** GetUpdates response: bytes fields are base64 strings in JSON. */
export interface GetUpdatesResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  sync_buf?: string;
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

/** SendMessage request: wraps a single WeixinMessage. */
export interface SendMessageReq {
  msg?: WeixinMessage;
}

export interface SendMessageResp {}

/** Typing status: 1 = typing (default), 2 = cancel typing. */
export const TypingStatus = {
  TYPING: 1,
  CANCEL: 2,
} as const;

/** SendTyping request: send a typing indicator to a user. */
export interface SendTypingReq {
  ilink_user_id?: string;
  typing_ticket?: string;
  status?: number;
}

export interface SendTypingResp {
  ret?: number;
  errmsg?: string;
}

/** GetConfig response: bot config including typing_ticket. */
export interface GetConfigResp {
  ret?: number;
  errmsg?: string;
  typing_ticket?: string;
}

// =============================================================================
// API 配置选项
// =============================================================================

export type WeixinApiOptions = {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
  longPollTimeoutMs?: number;
};

// =============================================================================
// 工具函数 (原封不动保留)
// =============================================================================

const DEFAULT_BODY_MAX_LEN = 200;
const DEFAULT_TOKEN_PREFIX_LEN = 6;

export function truncate(s: string | undefined, max: number): string {
  if (!s) return "";
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…(len=${s.length})`;
}

export function redactToken(token: string | undefined, prefixLen = DEFAULT_TOKEN_PREFIX_LEN): string {
  if (!token) return "(none)";
  if (token.length <= prefixLen) return `****(len=${token.length})`;
  return `${token.slice(0, prefixLen)}…(len=${token.length})`;
}

export function redactBody(body: string | undefined, maxLen = DEFAULT_BODY_MAX_LEN): string {
  if (!body) return "(empty)";
  const redacted = body.replace(
    /"(context_token|bot_token|token|authorization|Authorization)"\s*:\s*"[^"]*"/g,
    '"$1":"<redacted>"',
  );
  if (redacted.length <= maxLen) return redacted;
  return `${redacted.slice(0, maxLen)}…(truncated, totalLen=${redacted.length})`;
}

export function redactUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const base = `${u.origin}${u.pathname}`;
    return u.search ? `${base}?<redacted>` : base;
  } catch {
    return truncate(rawUrl, 80);
  }
}

export function generateId(prefix: string): string {
  return `${prefix}:${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

export function tempFileName(prefix: string, ext: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
}

// =============================================================================
// 简化 Logger (控制台输出，不写入文件)
// =============================================================================

const SUBSYSTEM = "wechat-core";

const LEVEL_IDS: Record<string, number> = {
  TRACE: 1,
  DEBUG: 2,
  INFO: 3,
  WARN: 4,
  ERROR: 5,
  FATAL: 6,
};

function resolveMinLevel(): number {
  const env = process.env.WECHAT_CORE_LOG_LEVEL?.toUpperCase();
  if (env && env in LEVEL_IDS) return LEVEL_IDS[env];
  return LEVEL_IDS.INFO;
}

let minLevelId = resolveMinLevel();

export interface Logger {
  info(message: string): void;
  debug(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  withAccount(accountId: string): Logger;
}

function buildLoggerName(accountId?: string): string {
  return accountId ? `${SUBSYSTEM}/${accountId}` : SUBSYSTEM;
}

function writeLog(level: string, message: string, accountId?: string): void {
  const levelId = LEVEL_IDS[level] ?? LEVEL_IDS.INFO;
  if (levelId < minLevelId) return;
  const loggerName = buildLoggerName(accountId);
  const prefixedMessage = accountId ? `[${accountId}] ${message}` : message;
  const entry = { level, loggerName, message: prefixedMessage, time: new Date().toISOString() };
  try {
    console.log(JSON.stringify(entry));
  } catch {
    // best-effort
  }
}

function createLogger(accountId?: string): Logger {
  return {
    info(message: string): void { writeLog("INFO", message, accountId); },
    debug(message: string): void { writeLog("DEBUG", message, accountId); },
    warn(message: string): void { writeLog("WARN", message, accountId); },
    error(message: string): void { writeLog("ERROR", message, accountId); },
    withAccount(id: string): Logger { return createLogger(id); },
  };
}

const logger: Logger = createLogger();

// =============================================================================
// 包信息读取
// =============================================================================

interface PackageJson {
  name?: string;
  version?: string;
  ilink_appid?: string;
}

function readPackageJson(): PackageJson {
  try {
    // 使用动态 import 避免在 n8n 运行时直接依赖文件系统路径
    return { name: "wechat-core", version: "1.0.0", ilink_appid: "bot" };
  } catch {
    return { name: "wechat-core", version: "1.0.0", ilink_appid: "bot" };
  }
}

const pkg = readPackageJson();
const CHANNEL_VERSION = pkg.version ?? "unknown";
const ILINK_APP_ID: string = pkg.ilink_appid ?? "";

function buildClientVersion(version: string): number {
  const parts = version.split(".").map((p) => parseInt(p, 10));
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff);
}

const ILINK_APP_CLIENT_VERSION: number = buildClientVersion(pkg.version ?? "0.0.0");

export function buildBaseInfo(): BaseInfo {
  return { channel_version: CHANNEL_VERSION };
}

// =============================================================================
// HTTP 请求核心 (原封不动保留所有头部和加密特征)
// =============================================================================

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_API_TIMEOUT_MS = 15_000;
const DEFAULT_CONFIG_TIMEOUT_MS = 10_000;

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

/** X-WECHAT-UIN header: random uint32 -> decimal string -> base64. */
function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

function buildCommonHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "iLink-App-Id": ILINK_APP_ID,
    "iLink-App-ClientVersion": String(ILINK_APP_CLIENT_VERSION),
  };
  return headers;
}

function buildHeaders(opts: { token?: string; body: string }): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "Content-Length": String(Buffer.byteLength(opts.body, "utf-8")),
    "X-WECHAT-UIN": randomWechatUin(),
    ...buildCommonHeaders(),
  };
  if (opts.token?.trim()) {
    headers.Authorization = `Bearer ${opts.token.trim()}`;
  }
  logger.debug(
    `requestHeaders: ${JSON.stringify({ ...headers, Authorization: headers.Authorization ? "Bearer ***" : undefined })}`,
  );
  return headers;
}

/**
 * GET fetch wrapper: send a GET request to a Weixin API endpoint.
 */
export async function apiGetFetch(params: {
  baseUrl: string;
  endpoint: string;
  timeoutMs?: number;
  label: string;
}): Promise<string> {
  const base = ensureTrailingSlash(params.baseUrl);
  const url = new URL(params.endpoint, base);
  const hdrs = buildCommonHeaders();
  logger.debug(`GET ${redactUrl(url.toString())}`);

  const timeoutMs = params.timeoutMs;
  const controller =
    timeoutMs != null && timeoutMs > 0 ? new AbortController() : undefined;
  const t =
    controller != null && timeoutMs != null
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;
  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: hdrs,
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (t !== undefined) clearTimeout(t);
    const rawText = await res.text();
    logger.debug(`${params.label} status=${res.status} raw=${redactBody(rawText)}`);
    if (!res.ok) {
      throw new Error(`${params.label} ${res.status}: ${rawText}`);
    }
    return rawText;
  } catch (err) {
    if (t !== undefined) clearTimeout(t);
    throw err;
  }
}

/**
 * Common fetch wrapper: POST JSON to a Weixin API endpoint with timeout + abort.
 */
async function apiPostFetch(params: {
  baseUrl: string;
  endpoint: string;
  body: string;
  token?: string;
  timeoutMs: number;
  label: string;
}): Promise<string> {
  const base = ensureTrailingSlash(params.baseUrl);
  const url = new URL(params.endpoint, base);
  const hdrs = buildHeaders({ token: params.token, body: params.body });
  logger.debug(`POST ${redactUrl(url.toString())} body=${redactBody(params.body)}`);

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: hdrs,
      body: params.body,
      signal: controller.signal,
    });
    clearTimeout(t);
    const rawText = await res.text();
    logger.debug(`${params.label} status=${res.status} raw=${redactBody(rawText)}`);
    if (!res.ok) {
      throw new Error(`${params.label} ${res.status}: ${rawText}`);
    }
    return rawText;
  } catch (err) {
    clearTimeout(t);
    throw err;
  }
}

/**
 * Long-poll getUpdates. Server should hold the request until new messages or timeout.
 */
export async function getUpdates(
  params: GetUpdatesReq & {
    baseUrl: string;
    token?: string;
    timeoutMs?: number;
  },
): Promise<GetUpdatesResp> {
  const timeout = params.timeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS;
  try {
    const rawText = await apiPostFetch({
      baseUrl: params.baseUrl,
      endpoint: "ilink/bot/getupdates",
      body: JSON.stringify({
        get_updates_buf: params.get_updates_buf ?? "",
        base_info: buildBaseInfo(),
      }),
      token: params.token,
      timeoutMs: timeout,
      label: "getUpdates",
    });
    const resp: GetUpdatesResp = JSON.parse(rawText);
    return resp;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      logger.debug(`getUpdates: client-side timeout after ${timeout}ms, returning empty response`);
      return { ret: 0, msgs: [], get_updates_buf: params.get_updates_buf };
    }
    throw err;
  }
}

/** Get a pre-signed CDN upload URL for a file. */
export async function getUploadUrl(
  params: GetUploadUrlReq & WeixinApiOptions,
): Promise<GetUploadUrlResp> {
  const rawText = await apiPostFetch({
    baseUrl: params.baseUrl,
    endpoint: "ilink/bot/getuploadurl",
    body: JSON.stringify({
      filekey: params.filekey,
      media_type: params.media_type,
      to_user_id: params.to_user_id,
      rawsize: params.rawsize,
      rawfilemd5: params.rawfilemd5,
      filesize: params.filesize,
      thumb_rawsize: params.thumb_rawsize,
      thumb_rawfilemd5: params.thumb_rawfilemd5,
      thumb_filesize: params.thumb_filesize,
      no_need_thumb: params.no_need_thumb,
      aeskey: params.aeskey,
      base_info: buildBaseInfo(),
    }),
    token: params.token,
    timeoutMs: params.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
    label: "getUploadUrl",
  });
  const resp: GetUploadUrlResp = JSON.parse(rawText);
  return resp;
}

/** Send a single message downstream. */
export async function sendMessage(
  params: WeixinApiOptions & { body: SendMessageReq },
): Promise<void> {
  await apiPostFetch({
    baseUrl: params.baseUrl,
    endpoint: "ilink/bot/sendmessage",
    body: JSON.stringify({ ...params.body, base_info: buildBaseInfo() }),
    token: params.token,
    timeoutMs: params.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
    label: "sendMessage",
  });
}

/** Fetch bot config (includes typing_ticket) for a given user. */
export async function getConfig(
  params: WeixinApiOptions & { ilinkUserId: string; contextToken?: string },
): Promise<GetConfigResp> {
  const rawText = await apiPostFetch({
    baseUrl: params.baseUrl,
    endpoint: "ilink/bot/getconfig",
    body: JSON.stringify({
      ilink_user_id: params.ilinkUserId,
      context_token: params.contextToken,
      base_info: buildBaseInfo(),
    }),
    token: params.token,
    timeoutMs: params.timeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS,
    label: "getConfig",
  });
  const resp: GetConfigResp = JSON.parse(rawText);
  return resp;
}

/** Send a typing indicator to a user. */
export async function sendTypingApi(
  params: WeixinApiOptions & { body: SendTypingReq },
): Promise<void> {
  await apiPostFetch({
    baseUrl: params.baseUrl,
    endpoint: "ilink/bot/sendtyping",
    body: JSON.stringify({ ...params.body, base_info: buildBaseInfo() }),
    token: params.token,
    timeoutMs: params.timeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS,
    label: "sendTyping",
  });
}

// =============================================================================
// 二维码登录 (原封不动从 login-qr.ts 提取)
// =============================================================================

const ACTIVE_LOGIN_TTL_MS = 5 * 60_000;
const QR_LONG_POLL_TIMEOUT_MS = 35_000;

export const DEFAULT_ILINK_BOT_TYPE = "3";

const FIXED_BASE_URL = "https://ilinkai.weixin.qq.com";

type ActiveLogin = {
  sessionKey: string;
  id: string;
  qrcode: string;
  qrcodeUrl: string;
  startedAt: number;
  botToken?: string;
  status?: "wait" | "scaned" | "confirmed" | "expired" | "scaned_but_redirect";
  error?: string;
  currentApiBaseUrl?: string;
};

const activeLogins = new Map<string, ActiveLogin>();

interface QRCodeResponse {
  qrcode: string;
  qrcode_img_content: string;
}

interface StatusResponse {
  status: "wait" | "scaned" | "confirmed" | "expired" | "scaned_but_redirect";
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
  redirect_host?: string;
}

function isLoginFresh(login: ActiveLogin): boolean {
  return Date.now() - login.startedAt < ACTIVE_LOGIN_TTL_MS;
}

function purgeExpiredLogins(): void {
  for (const [id, login] of activeLogins) {
    if (!isLoginFresh(login)) {
      activeLogins.delete(id);
    }
  }
}

async function fetchQRCode(apiBaseUrl: string, botType: string): Promise<QRCodeResponse> {
  logger.info(`Fetching QR code from: ${apiBaseUrl} bot_type=${botType}`);
  const rawText = await apiGetFetch({
    baseUrl: apiBaseUrl,
    endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
    label: "fetchQRCode",
  });
  return JSON.parse(rawText) as QRCodeResponse;
}

async function pollQRStatus(apiBaseUrl: string, qrcode: string): Promise<StatusResponse> {
  logger.debug(`Long-poll QR status from: ${apiBaseUrl} qrcode=***`);
  try {
    const rawText = await apiGetFetch({
      baseUrl: apiBaseUrl,
      endpoint: `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      timeoutMs: QR_LONG_POLL_TIMEOUT_MS,
      label: "pollQRStatus",
    });
    logger.debug(`pollQRStatus: body=${rawText.substring(0, 200)}`);
    return JSON.parse(rawText) as StatusResponse;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      logger.debug(`pollQRStatus: client-side timeout after ${QR_LONG_POLL_TIMEOUT_MS}ms, returning wait`);
      return { status: "wait" };
    }
    logger.warn(`pollQRStatus: network/gateway error, will retry: ${String(err)}`);
    return { status: "wait" };
  }
}

export type WeixinQrStartResult = {
  qrcodeUrl?: string;
  message: string;
  sessionKey: string;
};

export type WeixinQrWaitResult = {
  connected: boolean;
  botToken?: string;
  accountId?: string;
  baseUrl?: string;
  userId?: string;
  message: string;
};

export async function startWeixinLoginWithQr(opts: {
  verbose?: boolean;
  timeoutMs?: number;
  force?: boolean;
  accountId?: string;
  apiBaseUrl: string;
  botType?: string;
}): Promise<WeixinQrStartResult> {
  const sessionKey = opts.accountId || crypto.randomUUID();

  purgeExpiredLogins();

  const existing = activeLogins.get(sessionKey);
  if (!opts.force && existing && isLoginFresh(existing) && existing.qrcodeUrl) {
    return {
      qrcodeUrl: existing.qrcodeUrl,
      message: "二维码已就绪，请使用微信扫描。",
      sessionKey,
    };
  }

  try {
    const botType = opts.botType || DEFAULT_ILINK_BOT_TYPE;
    logger.info(`Starting Weixin login with bot_type=${botType}`);

    const qrResponse = await fetchQRCode(FIXED_BASE_URL, botType);
    logger.info(
      `QR code received, qrcode=${redactToken(qrResponse.qrcode)} imgContentLen=${qrResponse.qrcode_img_content?.length ?? 0}`,
    );
    logger.info(`二维码链接: ${qrResponse.qrcode_img_content}`);

    const login: ActiveLogin = {
      sessionKey,
      id: crypto.randomUUID(),
      qrcode: qrResponse.qrcode,
      qrcodeUrl: qrResponse.qrcode_img_content,
      startedAt: Date.now(),
    };

    activeLogins.set(sessionKey, login);

    return {
      qrcodeUrl: qrResponse.qrcode_img_content,
      message: "使用微信扫描以下二维码，以完成连接。",
      sessionKey,
    };
  } catch (err) {
    logger.error(`Failed to start Weixin login: ${String(err)}`);
    return {
      message: `Failed to start login: ${String(err)}`,
      sessionKey,
    };
  }
}

const MAX_QR_REFRESH_COUNT = 3;

export async function waitForWeixinLogin(opts: {
  timeoutMs?: number;
  verbose?: boolean;
  sessionKey: string;
  apiBaseUrl: string;
  botType?: string;
}): Promise<WeixinQrWaitResult> {
  let activeLogin = activeLogins.get(opts.sessionKey);

  if (!activeLogin) {
    logger.warn(`waitForWeixinLogin: no active login sessionKey=${opts.sessionKey}`);
    return {
      connected: false,
      message: "当前没有进行中的登录，请先发起登录。",
    };
  }

  if (!isLoginFresh(activeLogin)) {
    logger.warn(`waitForWeixinLogin: login QR expired sessionKey=${opts.sessionKey}`);
    activeLogins.delete(opts.sessionKey);
    return {
      connected: false,
      message: "二维码已过期，请重新生成。",
    };
  }

  const timeoutMs = Math.max(opts.timeoutMs ?? 480_000, 1000);
  const deadline = Date.now() + timeoutMs;
  let scannedPrinted = false;
  let qrRefreshCount = 1;

  activeLogin.currentApiBaseUrl = FIXED_BASE_URL;

  logger.info("Starting to poll QR code status...");

  while (Date.now() < deadline) {
    try {
      const currentBaseUrl = activeLogin.currentApiBaseUrl ?? FIXED_BASE_URL;
      const statusResponse = await pollQRStatus(currentBaseUrl, activeLogin.qrcode);
      logger.debug(`pollQRStatus: status=${statusResponse.status} hasBotToken=${Boolean(statusResponse.bot_token)} hasBotId=${Boolean(statusResponse.ilink_bot_id)}`);
      activeLogin.status = statusResponse.status;

      switch (statusResponse.status) {
        case "wait":
          if (opts.verbose) {
            process.stdout.write(".");
          }
          break;
        case "scaned":
          if (!scannedPrinted) {
            process.stdout.write("\n👀 已扫码，在微信继续操作...\n");
            scannedPrinted = true;
          }
          break;
        case "expired": {
          qrRefreshCount++;
          if (qrRefreshCount > MAX_QR_REFRESH_COUNT) {
            logger.warn(
              `waitForWeixinLogin: QR expired ${MAX_QR_REFRESH_COUNT} times, giving up sessionKey=${opts.sessionKey}`,
            );
            activeLogins.delete(opts.sessionKey);
            return {
              connected: false,
              message: "登录超时：二维码多次过期，请重新开始登录流程。",
            };
          }

          process.stdout.write(`\n⏳ 二维码已过期，正在刷新...(${qrRefreshCount}/${MAX_QR_REFRESH_COUNT})\n`);
          logger.info(
            `waitForWeixinLogin: QR expired, refreshing (${qrRefreshCount}/${MAX_QR_REFRESH_COUNT})`,
          );

          try {
            const botType = opts.botType || DEFAULT_ILINK_BOT_TYPE;
            const qrResponse = await fetchQRCode(FIXED_BASE_URL, botType);
            activeLogin.qrcode = qrResponse.qrcode;
            activeLogin.qrcodeUrl = qrResponse.qrcode_img_content;
            activeLogin.startedAt = Date.now();
            scannedPrinted = false;
            logger.info(`waitForWeixinLogin: new QR code obtained qrcode=${redactToken(qrResponse.qrcode)}`);
            process.stdout.write(`🔄 新二维码已生成，请重新扫描\n\n`);
          } catch (refreshErr) {
            logger.error(`waitForWeixinLogin: failed to refresh QR code: ${String(refreshErr)}`);
            activeLogins.delete(opts.sessionKey);
            return {
              connected: false,
              message: `刷新二维码失败: ${String(refreshErr)}`,
            };
          }
          break;
        }
        case "scaned_but_redirect": {
          const redirectHost = statusResponse.redirect_host;
          if (redirectHost) {
            const newBaseUrl = `https://${redirectHost}`;
            activeLogin.currentApiBaseUrl = newBaseUrl;
            logger.info(`waitForWeixinLogin: IDC redirect, switching polling host to ${redirectHost}`);
          } else {
            logger.warn(`waitForWeixinLogin: received scaned_but_redirect but redirect_host is missing`);
          }
          break;
        }
        case "confirmed": {
          if (!statusResponse.ilink_bot_id) {
            activeLogins.delete(opts.sessionKey);
            logger.error("Login confirmed but ilink_bot_id missing from response");
            return {
              connected: false,
              message: "登录失败：服务器未返回 ilink_bot_id。",
            };
          }

          activeLogin.botToken = statusResponse.bot_token;
          activeLogins.delete(opts.sessionKey);

          logger.info(
            `✅ Login confirmed! ilink_bot_id=${statusResponse.ilink_bot_id} ilink_user_id=${redactToken(statusResponse.ilink_user_id)}`,
          );

          return {
            connected: true,
            botToken: statusResponse.bot_token,
            accountId: statusResponse.ilink_bot_id,
            baseUrl: statusResponse.baseurl,
            userId: statusResponse.ilink_user_id,
            message: "✅ 与微信连接成功！",
          };
        }
      }
    } catch (err) {
      logger.error(`Error polling QR status: ${String(err)}`);
      activeLogins.delete(opts.sessionKey);
      return {
        connected: false,
        message: `Login failed: ${String(err)}`,
      };
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  logger.warn(
    `waitForWeixinLogin: timed out waiting for QR scan sessionKey=${opts.sessionKey} timeoutMs=${timeoutMs}`,
  );
  activeLogins.delete(opts.sessionKey);
  return {
    connected: false,
    message: "登录超时，请重试。",
  };
}

// =============================================================================
// Session 守护 (原封不动从 session-guard.ts 提取)
// =============================================================================

const SESSION_PAUSE_DURATION_MS = 60 * 60 * 1000;

export const SESSION_EXPIRED_ERRCODE = -14;

const pauseUntilMap = new Map<string, number>();

export function pauseSession(accountId: string): void {
  const until = Date.now() + SESSION_PAUSE_DURATION_MS;
  pauseUntilMap.set(accountId, until);
  logger.info(
    `session-guard: paused accountId=${accountId} until=${new Date(until).toISOString()} (${SESSION_PAUSE_DURATION_MS / 1000}s)`,
  );
}

export function isSessionPaused(accountId: string): boolean {
  const until = pauseUntilMap.get(accountId);
  if (until === undefined) return false;
  if (Date.now() >= until) {
    pauseUntilMap.delete(accountId);
    return false;
  }
  return true;
}

export function getRemainingPauseMs(accountId: string): number {
  const until = pauseUntilMap.get(accountId);
  if (until === undefined) return 0;
  const remaining = until - Date.now();
  if (remaining <= 0) {
    pauseUntilMap.delete(accountId);
    return 0;
  }
  return remaining;
}

export function assertSessionActive(accountId: string): void {
  if (isSessionPaused(accountId)) {
    const remainingMin = Math.ceil(getRemainingPauseMs(accountId) / 60_000);
    throw new Error(
      `session paused for accountId=${accountId}, ${remainingMin} min remaining (errcode ${SESSION_EXPIRED_ERRCODE})`,
    );
  }
}

// =============================================================================
// Markdown 过滤器 (原封不动从 markdown-filter.ts 提取)
// =============================================================================

export class StreamingMarkdownFilter {
  private buf = "";
  private fence = false;
  private sol = true;
  private inl: { type: "image" | "bold3" | "italic" | "ubold3" | "uitalic"; acc: string } | null = null;

  feed(delta: string): string {
    this.buf += delta;
    return this.pump(false);
  }

  flush(): string {
    return this.pump(true);
  }

  private pump(eof: boolean): string {
    let out = "";
    while (this.buf) {
      const sLen = this.buf.length;
      const sSol = this.sol;
      const sFence = this.fence;
      const sInl = this.inl;

      if (this.fence) out += this.pumpFence(eof);
      else if (this.inl) out += this.pumpInline(eof);
      else if (this.sol) out += this.pumpSOL(eof);
      else out += this.pumpBody(eof);

      if (this.buf.length === sLen && this.sol === sSol &&
          this.fence === sFence && this.inl === sInl) break;
    }

    if (eof && this.inl) {
      const markers: Record<string, string> = { image: "![", bold3: "***", italic: "*", ubold3: "___", uitalic: "_" };
      out += (markers[this.inl.type] ?? "") + this.inl.acc;
      this.inl = null;
    }
    return out;
  }

  private pumpFence(eof: boolean): string {
    if (this.sol) {
      if (this.buf.length < 3 && !eof) return "";
      if (this.buf.startsWith("```")) {
        const nl = this.buf.indexOf("\n", 3);
        if (nl !== -1) {
          this.fence = false;
          const line = this.buf.slice(0, nl + 1);
          this.buf = this.buf.slice(nl + 1);
          this.sol = true;
          return line;
        }
        if (eof) {
          this.fence = false;
          const line = this.buf;
          this.buf = "";
          return line;
        }
        return "";
      }
      this.sol = false;
    }
    const nl = this.buf.indexOf("\n");
    if (nl !== -1) {
      const chunk = this.buf.slice(0, nl + 1);
      this.buf = this.buf.slice(nl + 1);
      this.sol = true;
      return chunk;
    }
    const chunk = this.buf;
    this.buf = "";
    return chunk;
  }

  private pumpSOL(eof: boolean): string {
    const b = this.buf;

    if (b[0] === "\n") {
      this.buf = b.slice(1);
      return "\n";
    }

    if (b[0] === "`") {
      if (b.length < 3 && !eof) return "";
      if (b.startsWith("```")) {
        const nl = b.indexOf("\n", 3);
        if (nl !== -1) {
          this.fence = true;
          const line = b.slice(0, nl + 1);
          this.buf = b.slice(nl + 1);
          this.sol = true;
          return line;
        }
        if (eof) {
          this.buf = "";
          return b;
        }
        return "";
      }
      this.sol = false;
      return "";
    }

    if (b[0] === ">") {
      this.sol = false;
      return "";
    }

    if (b[0] === "#") {
      let n = 0;
      while (n < b.length && b[n] === "#") n++;
      if (n === b.length && !eof) return "";
      if (n >= 5 && n <= 6 && n < b.length && b[n] === " ") {
        this.buf = b.slice(n + 1);
        this.sol = false;
        return "";
      }
      this.sol = false;
      return "";
    }

    if (b[0] === " " || b[0] === "\t") {
      if (b.search(/[^ \t]/) === -1 && !eof) return "";
      this.sol = false;
      return "";
    }

    if (b[0] === "-" || b[0] === "*" || b[0] === "_") {
      const ch = b[0];
      let j = 0;
      while (j < b.length && (b[j] === ch || b[j] === " ")) j++;
      if (j === b.length && !eof) return "";
      if (j === b.length || b[j] === "\n") {
        let count = 0;
        for (let k = 0; k < j; k++) if (b[k] === ch) count++;
        if (count >= 3) {
          if (j < b.length) {
            this.buf = b.slice(j + 1);
            this.sol = true;
            return b.slice(0, j + 1);
          }
          this.buf = "";
          return b;
        }
      }
      this.sol = false;
      return "";
    }

    this.sol = false;
    return "";
  }

  private pumpBody(eof: boolean): string {
    let out = "";
    let i = 0;
    while (i < this.buf.length) {
      const c = this.buf[i];
      if (c === "\n") {
        out += this.buf.slice(0, i + 1);
        this.buf = this.buf.slice(i + 1);
        this.sol = true;
        return out;
      }
      if (c === "!" && i + 1 < this.buf.length && this.buf[i + 1] === "[") {
        out += this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 2);
        this.inl = { type: "image", acc: "" };
        return out;
      }
      if (c === "~") {
        i++;
        continue;
      }
      if (c === "*") {
        if (i + 2 < this.buf.length && this.buf[i + 1] === "*" && this.buf[i + 2] === "*") {
          out += this.buf.slice(0, i);
          this.buf = this.buf.slice(i + 3);
          this.inl = { type: "bold3", acc: "" };
          return out;
        }
        if (i + 1 < this.buf.length && this.buf[i + 1] === "*") {
          i += 2;
          continue;
        }
        if (i + 1 < this.buf.length && this.buf[i + 1] !== " " && this.buf[i + 1] !== "\n") {
          out += this.buf.slice(0, i);
          this.buf = this.buf.slice(i + 1);
          this.inl = { type: "italic", acc: "" };
          return out;
        }
        i++;
        continue;
      }
      if (c === "_") {
        if (i + 2 < this.buf.length && this.buf[i + 1] === "_" && this.buf[i + 2] === "_") {
          out += this.buf.slice(0, i);
          this.buf = this.buf.slice(i + 3);
          this.inl = { type: "ubold3", acc: "" };
          return out;
        }
        if (i + 1 < this.buf.length && this.buf[i + 1] === "_") {
          i += 2;
          continue;
        }
        if (i + 1 < this.buf.length && this.buf[i + 1] !== " " && this.buf[i + 1] !== "\n") {
          out += this.buf.slice(0, i);
          this.buf = this.buf.slice(i + 1);
          this.inl = { type: "uitalic", acc: "" };
          return out;
        }
        i++;
        continue;
      }
      i++;
    }

    let hold = 0;
    if (!eof) {
      if (this.buf.endsWith("**")) hold = 2;
      else if (this.buf.endsWith("__")) hold = 2;
      else if (this.buf.endsWith("*")) hold = 1;
      else if (this.buf.endsWith("_")) hold = 1;
      else if (this.buf.endsWith("!")) hold = 1;
    }
    out += this.buf.slice(0, this.buf.length - hold);
    this.buf = hold > 0 ? this.buf.slice(-hold) : "";
    return out;
  }

  private pumpInline(_eof: boolean): string {
    if (!this.inl) return "";
    this.inl.acc += this.buf;
    this.buf = "";

    switch (this.inl.type) {
      case "bold3": {
        const idx = this.inl.acc.indexOf("***");
        if (idx !== -1) {
          const content = this.inl.acc.slice(0, idx);
          this.buf = this.inl.acc.slice(idx + 3);
          this.inl = null;
          if (StreamingMarkdownFilter.containsCJK(content)) return content;
          return `***${content}***`;
        }
        return "";
      }
      case "ubold3": {
        const idx = this.inl.acc.indexOf("___");
        if (idx !== -1) {
          const content = this.inl.acc.slice(0, idx);
          this.buf = this.inl.acc.slice(idx + 3);
          this.inl = null;
          if (StreamingMarkdownFilter.containsCJK(content)) return content;
          return `___${content}___`;
        }
        return "";
      }
      case "italic": {
        for (let j = 0; j < this.inl.acc.length; j++) {
          if (this.inl.acc[j] === "\n") {
            const r = "*" + this.inl.acc.slice(0, j + 1);
            this.buf = this.inl.acc.slice(j + 1);
            this.inl = null;
            this.sol = true;
            return r;
          }
          if (this.inl.acc[j] === "*") {
            if (j + 1 < this.inl.acc.length && this.inl.acc[j + 1] === "*") {
              j++;
              continue;
            }
            const content = this.inl.acc.slice(0, j);
            this.buf = this.inl.acc.slice(j + 1);
            this.inl = null;
            if (StreamingMarkdownFilter.containsCJK(content)) return content;
            return `*${content}*`;
          }
        }
        return "";
      }
      case "uitalic": {
        for (let j = 0; j < this.inl.acc.length; j++) {
          if (this.inl.acc[j] === "\n") {
            const r = "_" + this.inl.acc.slice(0, j + 1);
            this.buf = this.inl.acc.slice(j + 1);
            this.inl = null;
            this.sol = true;
            return r;
          }
          if (this.inl.acc[j] === "_") {
            if (j + 1 < this.inl.acc.length && this.inl.acc[j + 1] === "_") {
              j++;
              continue;
            }
            const content = this.inl.acc.slice(0, j);
            this.buf = this.inl.acc.slice(j + 1);
            this.inl = null;
            if (StreamingMarkdownFilter.containsCJK(content)) return content;
            return `_${content}_`;
          }
        }
        return "";
      }
      case "image": {
        const cb = this.inl.acc.indexOf("]");
        if (cb === -1) return "";
        if (cb + 1 >= this.inl.acc.length) return "";
        if (this.inl.acc[cb + 1] !== "(") {
          const r = "![" + this.inl.acc.slice(0, cb + 1);
          this.buf = this.inl.acc.slice(cb + 1);
          this.inl = null;
          return r;
        }
        const cp = this.inl.acc.indexOf(")", cb + 2);
        if (cp !== -1) {
          this.buf = this.inl.acc.slice(cp + 1);
          this.inl = null;
          return "";
        }
        return "";
      }
    }
    return "";
  }

  private static containsCJK(text: string): boolean {
    return /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/.test(text);
  }
}

// =============================================================================
// 消息发送 (原封不动从 send.ts 提取)
// =============================================================================

function generateClientId(): string {
  return generateId("wechat-core");
}

/** Build a SendMessageReq containing a single text message. */
function buildTextMessageReq(params: {
  to: string;
  text: string;
  contextToken?: string;
  clientId: string;
}): SendMessageReq {
  const { to, text, contextToken, clientId } = params;
  const item_list: MessageItem[] = text
    ? [{ type: MessageItemType.TEXT, text_item: { text } }]
    : [];
  return {
    msg: {
      from_user_id: "",
      to_user_id: to,
      client_id: clientId,
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      item_list: item_list.length ? item_list : undefined,
      context_token: contextToken ?? undefined,
    },
  };
}

/**
 * Send a plain text message downstream.
 */
export async function sendMessageCore(params: {
  to: string;
  text: string;
  opts: WeixinApiOptions & { contextToken?: string };
}): Promise<{ messageId: string }> {
  const { to, text, opts } = params;
  if (!opts.contextToken) {
    logger.warn(`sendMessageCore: contextToken missing for to=${to}, sending without context`);
  }
  const clientId = generateClientId();
  const req = buildTextMessageReq({
    to,
    text,
    contextToken: opts.contextToken,
    clientId,
  });
  try {
    await sendMessage({
      baseUrl: opts.baseUrl,
      token: opts.token,
      timeoutMs: opts.timeoutMs,
      body: req,
    });
  } catch (err) {
    logger.error(`sendMessageCore: failed to=${to} clientId=${clientId} err=${String(err)}`);
    throw err;
  }
  return { messageId: clientId };
}

// =============================================================================
// WechatCore 类 — 职责单一：仅负责协议通信，不处理文件持久化或 UI
// =============================================================================

export interface SessionData {
  accountId: string;
  token: string;
  baseUrl: string;
  userId?: string;
}

export interface WechatMessageEvent {
  content: string;
  from: string;
  to: string;
  raw: WeixinMessage;
  contextToken?: string;
}

export interface WechatCoreOptions {
  cdnBaseUrl?: string;
  longPollTimeoutMs?: number;
  verbose?: boolean;
}

export class WechatCore extends EventEmitter {
  private sessionData: SessionData | null = null;
  private isRunning = false;
  private abortController: AbortController | null = null;
  private getUpdatesBuf = "";
  private options: Required<WechatCoreOptions>;
  private consecutiveFailures = 0;

  private readonly DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
  private readonly CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
  private readonly DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
  private readonly MAX_CONSECUTIVE_FAILURES = 3;
  private readonly BACKOFF_DELAY_MS = 30_000;
  private readonly RETRY_DELAY_MS = 2_000;

  constructor(options: WechatCoreOptions = {}) {
    super();
    this.options = {
      cdnBaseUrl: options.cdnBaseUrl ?? this.CDN_BASE_URL,
      longPollTimeoutMs: options.longPollTimeoutMs ?? this.DEFAULT_LONG_POLL_TIMEOUT_MS,
      verbose: options.verbose ?? false,
    };
  }

  /**
   * 初始化微信核心
   *
   * 职责单一：仅依赖传入参数恢复连接。有有效 sessionData 则启动轮询，
   * 无则抛出错误，由上层节点（如 WechatLogin）负责扫码流程。
   */
  public async init(sessionData: SessionData): Promise<void> {
    if (!sessionData?.accountId || !sessionData?.token) {
      throw new Error(
        "WechatCore.init() requires valid sessionData with accountId and token. " +
          "Use WechatLogin node to obtain sessionData first.",
      );
    }

    this.sessionData = {
      ...sessionData,
      baseUrl: sessionData.baseUrl || this.DEFAULT_BASE_URL,
    };
    logger.info(`Initialized with session for account: ${this.sessionData.accountId}`);
    await this.startPolling();
  }

  /**
   * 启动二维码登录流程（供 WechatLogin 节点独立调用）
   */
  public async startLogin(): Promise<WeixinQrStartResult> {
    return startWeixinLoginWithQr({
      apiBaseUrl: this.DEFAULT_BASE_URL,
      botType: DEFAULT_ILINK_BOT_TYPE,
      verbose: this.options.verbose,
    });
  }

  /**
   * 等待扫码登录完成（供 WechatLogin 节点独立调用）
   */
  public async waitForLogin(
    sessionKey: string,
    timeoutMs?: number,
  ): Promise<WeixinQrWaitResult> {
    return waitForWeixinLogin({
      sessionKey,
      apiBaseUrl: this.DEFAULT_BASE_URL,
      botType: DEFAULT_ILINK_BOT_TYPE,
      timeoutMs,
      verbose: this.options.verbose,
    });
  }

  /**
   * 发送文本消息
   */
  public async sendMessage(to: string, content: string): Promise<{ messageId: string }> {
    if (!this.sessionData) {
      throw new Error(
        "Not logged in. Please call init() with valid sessionData first.",
      );
    }
    assertSessionActive(this.sessionData.accountId);

    const filter = new StreamingMarkdownFilter();
    const filteredText = filter.feed(content) + filter.flush();

    return sendMessageCore({
      to,
      text: filteredText,
      opts: {
        baseUrl: this.sessionData.baseUrl,
        token: this.sessionData.token,
        contextToken: undefined,
      },
    });
  }

  /**
   * 发送打字状态指示器
   */
  public async sendTyping(to: string, status: 'typing' | 'cancel' = 'typing'): Promise<void> {
    if (!this.sessionData) {
      throw new Error(
        "Not logged in. Please call init() with valid sessionData first.",
      );
    }
    assertSessionActive(this.sessionData.accountId);

    // 先获取 typing_ticket
    const configResp = await getConfig({
      baseUrl: this.sessionData.baseUrl,
      token: this.sessionData.token,
      ilinkUserId: to,
    });

    if (configResp.ret !== 0) {
      throw new Error(`Failed to get config: ${configResp.errmsg}`);
    }

    if (!configResp.typing_ticket) {
      throw new Error('No typing_ticket available for this user');
    }

    await sendTypingApi({
      baseUrl: this.sessionData.baseUrl,
      token: this.sessionData.token,
      body: {
        ilink_user_id: to,
        typing_ticket: configResp.typing_ticket,
        status: status === 'typing' ? TypingStatus.TYPING : TypingStatus.CANCEL,
      },
    });
  }

  /**
   * 开始长轮询循环
   */
  private async startPolling(): Promise<void> {
    if (this.isRunning || !this.sessionData) return;

    this.isRunning = true;
    this.abortController = new AbortController();
    this.consecutiveFailures = 0;

    logger.info(`Starting message polling for ${this.sessionData.accountId}`);

    this.pollLoop().catch((err) => {
      logger.error(`Polling loop error: ${String(err)}`);
    });
  }

  /**
   * 长轮询循环
   */
  private async pollLoop(): Promise<void> {
    if (!this.sessionData) return;

    const { accountId, token, baseUrl } = this.sessionData;
    let nextTimeoutMs = this.options.longPollTimeoutMs;

    while (this.isRunning && !this.abortController?.signal.aborted) {
      try {
        if (isSessionPaused(accountId)) {
          const remaining = getRemainingPauseMs(accountId);
          logger.info(`Session paused, waiting ${remaining}ms`);
          await this.sleep(remaining);
          continue;
        }

        const resp = await getUpdates({
          baseUrl,
          token,
          get_updates_buf: this.getUpdatesBuf,
          timeoutMs: nextTimeoutMs,
        });

        if (resp.longpolling_timeout_ms != null && resp.longpolling_timeout_ms > 0) {
          nextTimeoutMs = resp.longpolling_timeout_ms;
        }

        const isApiError =
          (resp.ret !== undefined && resp.ret !== 0) ||
          (resp.errcode !== undefined && resp.errcode !== 0);

        if (isApiError) {
          const isSessionExpired =
            resp.errcode === SESSION_EXPIRED_ERRCODE || resp.ret === SESSION_EXPIRED_ERRCODE;

          if (isSessionExpired) {
            pauseSession(accountId);
            const pauseMs = getRemainingPauseMs(accountId);
            logger.error(`Session expired, pausing for ${Math.ceil(pauseMs / 60_000)} min`);
            this.emit("error", new Error(`Session expired (errcode ${SESSION_EXPIRED_ERRCODE})`));
            await this.sleep(pauseMs);
            continue;
          }

          this.consecutiveFailures++;
          logger.error(
            `getUpdates failed: ret=${resp.ret} errcode=${resp.errcode} errmsg=${resp.errmsg} (${this.consecutiveFailures}/${this.MAX_CONSECUTIVE_FAILURES})`,
          );

          if (this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
            logger.error(`${this.MAX_CONSECUTIVE_FAILURES} consecutive failures, backing off 30s`);
            this.consecutiveFailures = 0;
            await this.sleep(this.BACKOFF_DELAY_MS);
          } else {
            await this.sleep(this.RETRY_DELAY_MS);
          }
          continue;
        }

        this.consecutiveFailures = 0;

        if (resp.get_updates_buf != null && resp.get_updates_buf !== "") {
          this.getUpdatesBuf = resp.get_updates_buf;
        }

        const list = resp.msgs ?? [];
        for (const msg of list) {
          await this.handleMessage(msg);
        }
      } catch (err) {
        if (this.abortController?.signal.aborted) {
          logger.info("Polling stopped (aborted)");
          return;
        }

        this.consecutiveFailures++;
        logger.error(`getUpdates error (${this.consecutiveFailures}/${this.MAX_CONSECUTIVE_FAILURES}): ${String(err)}`);

        if (this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
          this.emit("error", new Error(`${this.MAX_CONSECUTIVE_FAILURES} consecutive polling failures`));
          this.consecutiveFailures = 0;
          await this.sleep(this.BACKOFF_DELAY_MS);
        } else {
          await this.sleep(this.RETRY_DELAY_MS);
        }
      }
    }

    logger.info("Polling loop ended");
  }

  /**
   * 处理收到的消息
   */
  private async handleMessage(msg: WeixinMessage): Promise<void> {
    const fromUserId = msg.from_user_id ?? "";
    const content = this.extractMessageContent(msg);

    logger.info(`Received message from=${fromUserId} types=${msg.item_list?.map((i) => i.type).join(",") ?? "none"}`);

    const event: WechatMessageEvent = {
      content,
      from: fromUserId,
      to: msg.to_user_id ?? "",
      raw: msg,
      contextToken: msg.context_token,
    };

    this.emit("message", event);
  }

  /**
   * 从消息中提取文本内容
   */
  private extractMessageContent(msg: WeixinMessage): string {
    if (!msg.item_list?.length) return "";

    for (const item of msg.item_list) {
      if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
        const text = String(item.text_item.text);
        const ref = item.ref_msg;
        if (!ref) return text;

        if (ref.message_item && this.isMediaItem(ref.message_item)) return text;

        const parts: string[] = [];
        if (ref.title) parts.push(ref.title);
        if (ref.message_item) {
          const refBody = this.extractItemContent([ref.message_item]);
          if (refBody) parts.push(refBody);
        }
        if (!parts.length) return text;
        return `[引用: ${parts.join(" | ")}]\n${text}`;
      }

      if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
        return item.voice_item.text;
      }
    }

    return "";
  }

  /**
   * 检查消息项是否为媒体类型
   */
  private isMediaItem(item: MessageItem): boolean {
    return (
      item.type === MessageItemType.IMAGE ||
      item.type === MessageItemType.VIDEO ||
      item.type === MessageItemType.FILE ||
      item.type === MessageItemType.VOICE
    );
  }

  /**
   * 提取单个消息项的内容
   */
  private extractItemContent(itemList?: MessageItem[]): string {
    if (!itemList?.length) return "";
    for (const item of itemList) {
      if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
        return String(item.text_item.text);
      }
    }
    return "";
  }

  /**
   * 睡眠函数（支持中断）
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      this.abortController?.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true },
      );
    });
  }

  /**
   * 停止轮询
   */
  public stop(): void {
    logger.info("Stopping WechatCore...");
    this.isRunning = false;
    this.abortController?.abort();
    this.emit("stop");
  }

  /**
   * 获取当前会话数据
   */
  public getSessionData(): SessionData | null {
    return this.sessionData ? { ...this.sessionData } : null;
  }

  /**
   * 检查是否已登录
   */
  public isLoggedIn(): boolean {
    return this.sessionData !== null && this.isRunning;
  }

  // =============================================================================
  // 多媒体消息处理 (新增)
  // =============================================================================

  /**
   * 从消息中提取媒体类型和下载信息
   */
  public extractMediaInfo(msg: WeixinMessage): {
    type: 'image' | 'voice' | 'file' | 'video' | null;
    url?: string;
    aesKey?: string;
    fileName?: string;
    fileSize?: number;
  } {
    if (!msg.item_list?.length) return { type: null };

    for (const item of msg.item_list) {
      // 图片
      if (item.type === MessageItemType.IMAGE && item.image_item?.media) {
        const media = item.image_item.media;
        return {
          type: 'image',
          url: media.full_url || this.buildCdnUrl(media.encrypt_query_param),
          aesKey: media.aes_key,
          fileSize: item.image_item.mid_size,
        };
      }

      // 语音
      if (item.type === MessageItemType.VOICE && item.voice_item?.media) {
        const media = item.voice_item.media;
        return {
          type: 'voice',
          url: media.full_url || this.buildCdnUrl(media.encrypt_query_param),
          aesKey: media.aes_key,
        };
      }

      // 文件
      if (item.type === MessageItemType.FILE && item.file_item?.media) {
        const media = item.file_item.media;
        return {
          type: 'file',
          url: media.full_url || this.buildCdnUrl(media.encrypt_query_param),
          aesKey: media.aes_key,
          fileName: item.file_item.file_name,
          fileSize: parseInt(item.file_item.len || '0', 10),
        };
      }

      // 视频
      if (item.type === MessageItemType.VIDEO && item.video_item?.media) {
        const media = item.video_item.media;
        return {
          type: 'video',
          url: media.full_url || this.buildCdnUrl(media.encrypt_query_param),
          aesKey: media.aes_key,
          fileSize: item.video_item.video_size,
        };
      }
    }

    return { type: null };
  }

  /**
   * 构建 CDN 下载 URL
   */
  private buildCdnUrl(encryptQueryParam?: string): string | undefined {
    if (!encryptQueryParam) return undefined;
    return `${this.options.cdnBaseUrl}?${encryptQueryParam}`;
  }

  /**
   * 下载消息中的媒体文件
   */
  public async getMessageMediaBuffer(msg: WeixinMessage): Promise<{
    buffer: Buffer;
    fileName: string;
    mimeType: string;
  } | null> {
    const mediaInfo = this.extractMediaInfo(msg);
    if (!mediaInfo.type || !mediaInfo.url) {
      return null;
    }

    try {
      logger.info(`Downloading media: type=${mediaInfo.type}, url=${redactUrl(mediaInfo.url)}`);

      const response = await fetch(mediaInfo.url, {
        headers: {
          ...buildCommonHeaders(),
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to download media: ${response.status} ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // 确定文件名和 MIME 类型
      const fileName = mediaInfo.fileName || this.generateMediaFileName(mediaInfo.type);
      const mimeType = this.getMimeType(mediaInfo.type, fileName);

      logger.info(`Media downloaded: size=${buffer.length} bytes, type=${mimeType}`);

      return { buffer, fileName, mimeType };
    } catch (err) {
      logger.error(`Failed to download media: ${String(err)}`);
      return null;
    }
  }

  /**
   * 生成媒体文件名
   */
  private generateMediaFileName(type: string): string {
    const timestamp = Date.now();
    const extensions: Record<string, string> = {
      image: 'jpg',
      voice: 'mp3',
      file: 'bin',
      video: 'mp4',
    };
    return `wechat_${type}_${timestamp}.${extensions[type] || 'bin'}`;
  }

  /**
   * 获取 MIME 类型
   */
  private getMimeType(type: string, fileName?: string): string {
    const mimeTypes: Record<string, string> = {
      image: 'image/jpeg',
      voice: 'audio/mpeg',
      video: 'video/mp4',
      file: 'application/octet-stream',
    };

    if (fileName) {
      const ext = fileName.split('.').pop()?.toLowerCase();
      const extMimeTypes: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        mp3: 'audio/mpeg',
        mp4: 'video/mp4',
        pdf: 'application/pdf',
        doc: 'application/msword',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        xls: 'application/vnd.ms-excel',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
      if (ext && extMimeTypes[ext]) {
        return extMimeTypes[ext];
      }
    }

    return mimeTypes[type] || 'application/octet-stream';
  }

  /**
   * 发送图片消息
   *
   * 参考官方实现 src/cdn/upload.ts 和 src/messaging/send.ts
   * 关键要点：
   * 1. 生成 filekey (16字节hex) 和 aeskey (16字节Buffer)
   * 2. filesize = AES加密后的大小 (PKCS7 padding)
   * 3. getUploadUrl 的 aeskey 参数使用 hex 编码
   * 4. 使用 POST 上传 AES-128-ECB 加密后的内容
   * 5. 从响应头 x-encrypted-param 获取 downloadParam
   * 6. CDNMedia.aes_key 使用 base64 编码的 hex 字符串
   * 7. mid_size 使用 ciphertext 大小
   * 8. IMAGE 类型必须提供缩略图参数（thumb_rawsize, thumb_rawfilemd5, thumb_filesize）
   */
  public async sendImage(to: string, buffer: Buffer): Promise<{ messageId: string }> {
    if (!this.sessionData) {
      throw new Error('Not logged in. Please call init() with valid sessionData first.');
    }
    assertSessionActive(this.sessionData.accountId);

    // 1. 计算原始文件 MD5 和大小
    const rawsize = buffer.length;
    const rawfilemd5 = crypto.createHash('md5').update(buffer).digest('hex');

    // 2. 生成缩略图（服务端强制要求）
    let thumbBuffer: Buffer;
    try {
      // 使用简单的缩放算法生成缩略图（最大 200x200）
      thumbBuffer = await this.generateThumbnail(buffer, 200);
    } catch (err) {
      logger.warn(`Failed to generate thumbnail, using original: ${String(err)}`);
      thumbBuffer = buffer;
    }
    const thumb_rawsize = thumbBuffer.length;
    const thumb_rawfilemd5 = crypto.createHash('md5').update(thumbBuffer).digest('hex');
    const thumb_filesize = this.aesEcbPaddedSize(thumb_rawsize);

    // 3. 生成 filekey 和 aeskey
    const filekey = crypto.randomBytes(16).toString('hex');
    const aeskey = crypto.randomBytes(16);

    // 4. 计算 AES-128-ECB 加密后的大小 (PKCS7 padding)
    const filesize = this.aesEcbPaddedSize(rawsize);

    logger.info(`Sending image: to=${to}, rawsize=${rawsize}, filesize=${filesize}, md5=${rawfilemd5}, filekey=${filekey}, thumb_rawsize=${thumb_rawsize}`);

    // 5. 获取上传 URL（包含缩略图参数）
    logger.info(`sendImage: Calling getUploadUrl with baseUrl=${this.sessionData.baseUrl}, to=${to}, media_type=${UploadMediaType.IMAGE}`);
    const uploadUrlResp = await getUploadUrl({
      baseUrl: this.sessionData.baseUrl,
      token: this.sessionData.token,
      filekey,
      media_type: UploadMediaType.IMAGE,
      to_user_id: to,
      rawsize,
      rawfilemd5,
      filesize,
      thumb_rawsize,
      thumb_rawfilemd5,
      thumb_filesize,
      no_need_thumb: false,
      aeskey: aeskey.toString('hex'),
    });

    logger.info(`sendImage: getUploadUrl response=${JSON.stringify(uploadUrlResp)}`);

    const uploadFullUrl = uploadUrlResp.upload_full_url?.trim();
    const uploadParam = uploadUrlResp.upload_param;
    if (!uploadFullUrl && !uploadParam) {
      logger.error(`sendImage: getUploadUrl returned no upload URL, resp=${JSON.stringify(uploadUrlResp)}`);
      throw new Error('Failed to get upload URL for image');
    }

    // 6. 加密并上传原图到 CDN
    const { downloadParam } = await this.uploadBufferToCdn({
      buf: buffer,
      uploadFullUrl: uploadFullUrl || undefined,
      uploadParam: uploadParam ?? undefined,
      filekey,
      cdnBaseUrl: this.options.cdnBaseUrl,
      aeskey,
      label: 'sendImage',
    });

    // 7. 加密并上传缩略图到 CDN（如果有 thumb_upload_param）
    let thumbDownloadParam: string | undefined;
    if (uploadUrlResp.thumb_upload_param) {
      const thumbResult = await this.uploadBufferToCdn({
        buf: thumbBuffer,
        uploadParam: uploadUrlResp.thumb_upload_param,
        filekey,
        cdnBaseUrl: this.options.cdnBaseUrl,
        aeskey,
        label: 'sendImage-thumb',
      });
      thumbDownloadParam = thumbResult.downloadParam;
    }

    // 8. 构建并发送图片消息（包含原图和缩略图）
    const clientId = generateClientId();
    const req: SendMessageReq = {
      msg: {
        from_user_id: '',
        to_user_id: to,
        client_id: clientId,
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        item_list: [{
          type: MessageItemType.IMAGE,
          image_item: {
            media: {
              encrypt_query_param: downloadParam,
              aes_key: Buffer.from(aeskey.toString('hex')).toString('base64'),
              encrypt_type: 1,
            },
            thumb_media: thumbDownloadParam ? {
              encrypt_query_param: thumbDownloadParam,
              aes_key: Buffer.from(aeskey.toString('hex')).toString('base64'),
              encrypt_type: 1,
            } : undefined,
            mid_size: filesize,
            thumb_size: thumb_filesize,
          },
        }],
      },
    };

    await sendMessage({
      baseUrl: this.sessionData.baseUrl,
      token: this.sessionData.token,
      body: req,
    });

    return { messageId: clientId };
  }

  /**
   * 发送文件消息
   *
   * 参考官方实现 src/cdn/upload.ts 和 src/messaging/send.ts
   * 与图片上传流程相同，只是 media_type=FILE
   */
  public async sendFile(
    to: string,
    buffer: Buffer,
    fileName: string,
  ): Promise<{ messageId: string }> {
    if (!this.sessionData) {
      throw new Error('Not logged in. Please call init() with valid sessionData first.');
    }
    assertSessionActive(this.sessionData.accountId);

    // 1. 计算原始文件 MD5 和大小
    const rawsize = buffer.length;
    const rawfilemd5 = crypto.createHash('md5').update(buffer).digest('hex');

    // 2. 生成 filekey 和 aeskey
    const filekey = crypto.randomBytes(16).toString('hex');
    const aeskey = crypto.randomBytes(16);

    // 3. 计算 AES-128-ECB 加密后的大小 (PKCS7 padding)
    const filesize = this.aesEcbPaddedSize(rawsize);

    logger.info(`Sending file: to=${to}, name=${fileName}, rawsize=${rawsize}, filesize=${filesize}, md5=${rawfilemd5}, filekey=${filekey}`);

    // 4. 获取上传 URL
    const uploadUrlResp = await getUploadUrl({
      baseUrl: this.sessionData.baseUrl,
      token: this.sessionData.token,
      filekey,
      media_type: UploadMediaType.FILE,
      to_user_id: to,
      rawsize,
      rawfilemd5,
      filesize,
      no_need_thumb: true,
      aeskey: aeskey.toString('hex'),
    });

    const uploadFullUrl = uploadUrlResp.upload_full_url?.trim();
    const uploadParam = uploadUrlResp.upload_param;
    if (!uploadFullUrl && !uploadParam) {
      logger.error(`sendFile: getUploadUrl returned no upload URL, resp=${JSON.stringify(uploadUrlResp)}`);
      throw new Error('Failed to get upload URL for file');
    }

    // 5. 加密并上传到 CDN
    const { downloadParam } = await this.uploadBufferToCdn({
      buf: buffer,
      uploadFullUrl: uploadFullUrl || undefined,
      uploadParam: uploadParam ?? undefined,
      filekey,
      cdnBaseUrl: this.options.cdnBaseUrl,
      aeskey,
      label: 'sendFile',
    });

    // 6. 构建并发送文件消息
    const clientId = generateClientId();
    const req: SendMessageReq = {
      msg: {
        from_user_id: '',
        to_user_id: to,
        client_id: clientId,
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        item_list: [{
          type: MessageItemType.FILE,
          file_item: {
            media: {
              encrypt_query_param: downloadParam,
              aes_key: Buffer.from(aeskey.toString('hex')).toString('base64'),
              encrypt_type: 1,
            },
            file_name: fileName,
            len: String(rawsize),
          },
        }],
      },
    };

    await sendMessage({
      baseUrl: this.sessionData.baseUrl,
      token: this.sessionData.token,
      body: req,
    });

    return { messageId: clientId };
  }

  /**
   * 计算 AES-128-ECB 加密后的大小（PKCS7 padding 到 16 字节边界）
   */
  private aesEcbPaddedSize(plaintextSize: number): number {
    return Math.ceil((plaintextSize + 1) / 16) * 16;
  }

  /**
   * AES-128-ECB 加密（PKCS7 padding 是默认的）
   */
  private encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
    const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
    return Buffer.concat([cipher.update(plaintext), cipher.final()]);
  }

  /**
   * 上传 Buffer 到 CDN（使用 AES-128-ECB 加密 + POST）
   *
   * 参考官方实现 src/cdn/cdn-upload.ts
   */
  private async uploadBufferToCdn(params: {
    buf: Buffer;
    uploadFullUrl?: string;
    uploadParam?: string;
    filekey: string;
    cdnBaseUrl: string;
    aeskey: Buffer;
    label: string;
  }): Promise<{ downloadParam: string }> {
    const { buf, uploadFullUrl, uploadParam, filekey, cdnBaseUrl, aeskey, label } = params;

    // 1. AES-128-ECB 加密
    const ciphertext = this.encryptAesEcb(buf, aeskey);

    // 2. 确定 CDN URL
    const trimmedFull = uploadFullUrl?.trim();
    let cdnUrl: string;
    if (trimmedFull) {
      cdnUrl = trimmedFull;
    } else if (uploadParam) {
      cdnUrl = `${cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(filekey)}`;
    } else {
      throw new Error(`${label}: CDN upload URL missing (need upload_full_url or upload_param)`);
    }

    logger.debug(`${label}: CDN POST url=${cdnUrl} ciphertextSize=${ciphertext.length}`);

    // 3. POST 上传（最多重试 3 次）
    const UPLOAD_MAX_RETRIES = 3;
    let downloadParam: string | undefined;
    let lastError: unknown;

    for (let attempt = 1; attempt <= UPLOAD_MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(cdnUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: new Uint8Array(ciphertext),
        });

        if (res.status >= 400 && res.status < 500) {
          const errMsg = res.headers.get('x-error-message') ?? (await res.text());
          logger.error(`${label}: CDN client error attempt=${attempt} status=${res.status} errMsg=${errMsg}`);
          throw new Error(`CDN upload client error ${res.status}: ${errMsg}`);
        }
        if (res.status !== 200) {
          const errMsg = res.headers.get('x-error-message') ?? `status ${res.status}`;
          logger.error(`${label}: CDN server error attempt=${attempt} status=${res.status} errMsg=${errMsg}`);
          throw new Error(`CDN upload server error: ${errMsg}`);
        }

        downloadParam = res.headers.get('x-encrypted-param') ?? undefined;
        if (!downloadParam) {
          logger.error(`${label}: CDN response missing x-encrypted-param header attempt=${attempt}`);
          throw new Error('CDN upload response missing x-encrypted-param header');
        }

        logger.debug(`${label}: CDN upload success attempt=${attempt}`);
        break;
      } catch (err) {
        lastError = err;
        if (err instanceof Error && err.message.includes('client error')) throw err;
        if (attempt < UPLOAD_MAX_RETRIES) {
          logger.error(`${label}: attempt ${attempt} failed, retrying... err=${String(err)}`);
        } else {
          logger.error(`${label}: all ${UPLOAD_MAX_RETRIES} attempts failed err=${String(err)}`);
        }
      }
    }

    if (!downloadParam) {
      throw lastError instanceof Error
        ? lastError
        : new Error(`CDN upload failed after ${UPLOAD_MAX_RETRIES} attempts`);
    }

    return { downloadParam };
  }

  /**
   * 生成图片缩略图
   */
  private async generateThumbnail(buffer: Buffer, maxSize: number): Promise<Buffer> {
    const image = sharp(buffer);
    const metadata = await image.metadata();
    
    // 如果图片已经很小，直接返回
    if ((metadata.width ?? 0) <= maxSize && (metadata.height ?? 0) <= maxSize) {
      return buffer;
    }
    
    // 缩放图片，保持比例
    return image.resize(maxSize, maxSize, { 
      fit: 'inside',
      withoutEnlargement: true 
    }).jpeg({ quality: 80 }).toBuffer();
  }
}
