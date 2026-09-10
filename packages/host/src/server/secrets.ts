/**
 * 密钥存管（T05 · Z-10/Q-03 双后端）：
 * - 首选：系统钥匙串（桌面壳 keybridge：127.0.0.1 随机端口 + token，Rust keyring）
 *   经环境变量 PI_AGENT_KEYBRIDGE_URL / PI_AGENT_KEYBRIDGE_TOKEN 注入（sidecar 场景）
 * - 回退：AES-256-GCM 加密落盘 0600（密钥文件 appData/.secret-key + secrets.json）
 * - 迁移：启动时检测文件态密文键 → 自动搬入钥匙串并清除密文（磁盘不再留明文/密文）
 * - 读取永不回传原文给 web（设置页只展示 key 与更新时间）
 */
import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { SecretMeta } from '@pi-agent/shared';
import type { AppDirs } from '../config/paths';

export interface SecretsRouteDeps {
  dirs: AppDirs;
}

interface SecretItem {
  /** 钥匙串态：值在系统钥匙串，文件仅留元数据（不存任何值） */
  keychain?: boolean;
  iv?: string;
  salt?: string;
  data?: string;
  updatedAt: string;
}

type SecretStore = Record<string, SecretItem>;

const keyFile = (dirs: AppDirs): string => path.join(dirs.root, '.secret-key');
const storeFile = (dirs: AppDirs): string => path.join(dirs.root, 'secrets.json');

/** 主密钥：文件不存在则生成（0600） */
function masterKey(dirs: AppDirs): Buffer {
  const file = keyFile(dirs);
  try {
    const hex = fs.readFileSync(file, 'utf8').trim();
    const buf = Buffer.from(hex, 'hex');
    if (buf.length === 32) return buf;
  } catch {
    // 落到生成
  }
  const buf = randomBytes(32);
  fs.writeFileSync(file, buf.toString('hex'), { encoding: 'utf8', mode: 0o600 });
  return buf;
}

function readStore(dirs: AppDirs): SecretStore {
  try {
    return JSON.parse(fs.readFileSync(storeFile(dirs), 'utf8')) as SecretStore;
  } catch {
    return {};
  }
}

function writeStore(dirs: AppDirs, store: SecretStore): void {
  fs.writeFileSync(storeFile(dirs), JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
}

function encrypt(master: Buffer, plain: string): { iv: string; salt: string; data: string } {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(master, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return { iv: iv.toString('hex'), salt: salt.toString('hex'), data: `${cipher.getAuthTag().toString('hex')}:${enc.toString('hex')}` };
}

function decrypt(master: Buffer, item: { iv: string; salt: string; data: string }): string | null {
  try {
    const [tagHex, dataHex] = item.data.split(':');
    const key = scryptSync(master, Buffer.from(item.salt, 'hex'), 32);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(item.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex!, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex!, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** host 内部消费入口（文件态回退；钥匙串态走 getSecretValue） */
export function getSecret(dirs: AppDirs, key: string): string | null {
  const item = readStore(dirs)[key];
  if (!item || item.keychain) return null;
  return decrypt(masterKey(dirs), { iv: item.iv!, salt: item.salt!, data: item.data! });
}

/* ---------- 钥匙串后端（keybridge） ---------- */

function keybridgeConfig(): { url: string; token: string } | null {
  const url = process.env['PI_AGENT_KEYBRIDGE_URL'];
  const token = process.env['PI_AGENT_KEYBRIDGE_TOKEN'];
  return url && token ? { url, token } : null;
}

/** 钥匙串是否可用（桌面壳 sidecar 场景注入） */
export function isKeychainActive(): boolean {
  return keybridgeConfig() !== null;
}

async function keychainCall(method: 'GET' | 'PUT' | 'DELETE', key: string, body?: { value: string }): Promise<{ ok: boolean; notFound?: boolean }> {
  const cfg = keybridgeConfig();
  if (!cfg) return { ok: false };
  try {
    const res = await fetch(`${cfg.url}/secret?key=${encodeURIComponent(key)}`, {
      method,
      headers: {
        'x-keybridge-token': cfg.token,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(2000),
    });
    return { ok: res.ok, notFound: res.status === 404 };
  } catch {
    return { ok: false };
  }
}

/** 异步取值：钥匙串优先，文件态回退（host 内部未来消费点） */
export async function getSecretValue(dirs: AppDirs, key: string): Promise<string | null> {
  const cfg = keybridgeConfig();
  if (cfg) {
    try {
      const res = await fetch(`${cfg.url}/secret?key=${encodeURIComponent(key)}`, {
        headers: { 'x-keybridge-token': cfg.token },
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const parsed = (await res.json()) as { value?: string };
        if (typeof parsed.value === 'string') return parsed.value;
      }
    } catch {
      // 桥不可用 → 落文件回退
    }
  }
  return getSecret(dirs, key);
}

/** 启动迁移（Z-10）：文件态密文 → 钥匙串；完成后清除文件密文与主密钥 */
export async function migrateSecretsToKeychain(dirs: AppDirs): Promise<void> {
  if (!isKeychainActive()) return;
  const store = readStore(dirs);
  let dirty = false;
  for (const [key, item] of Object.entries(store)) {
    if (item.keychain || !item.iv || !item.salt || !item.data) continue;
    const plain = decrypt(masterKey(dirs), { iv: item.iv, salt: item.salt, data: item.data });
    if (plain === null) continue; // 解不开的遗留数据原样保留
    const r = await keychainCall('PUT', key, { value: plain });
    if (r.ok) {
      store[key] = { keychain: true, updatedAt: item.updatedAt };
      dirty = true;
    }
  }
  if (dirty) {
    writeStore(dirs, store);
    // 全部迁移完成 → 主密钥文件删除（磁盘无任何值残留）
    const remainPlain = Object.values(readStore(dirs)).some((i) => !i.keychain && i.data);
    if (!remainPlain) {
      try {
        fs.unlinkSync(keyFile(dirs));
      } catch {
        // 已不存在则忽略
      }
    }
  }
}

export function registerSecretsRoutes(app: FastifyInstance, deps: SecretsRouteDeps): void {
  const { dirs } = deps;

  app.get('/v1/secrets', async (): Promise<{ secrets: SecretMeta[] }> => {
    const store = readStore(dirs);
    return {
      secrets: Object.entries(store).map(([key, v]) => ({ key, updatedAt: v.updatedAt })),
    };
  });

  app.put('/v1/secrets/:key', async (req, reply) => {
    const { key } = req.params as { key: string };
    const body = req.body as { value?: string } | null;
    if (!body || typeof body.value !== 'string' || body.value.length === 0) {
      void reply.code(400);
      return { error: 'value 必填' };
    }
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(key)) {
      void reply.code(400);
      return { error: 'key 仅允许字母数字与 . _ -（≤64 字符）' };
    }
    const store = readStore(dirs);
    const updatedAt = new Date().toISOString();
    // Z-10：钥匙串优先；失败回退文件密文（诚实降级，不留明文）
    if (isKeychainActive()) {
      const r = await keychainCall('PUT', key, { value: body.value });
      if (r.ok) {
        store[key] = { keychain: true, updatedAt };
        writeStore(dirs, store);
        return { ok: true, backend: 'keychain' };
      }
    }
    store[key] = { ...encrypt(masterKey(dirs), body.value), updatedAt };
    writeStore(dirs, store);
    return { ok: true, backend: 'file' };
  });

  app.delete('/v1/secrets/:key', async (req, reply) => {
    const { key } = req.params as { key: string };
    const store = readStore(dirs);
    if (!(key in store)) {
      void reply.code(404);
      return { error: '密钥不存在' };
    }
    // 双清：钥匙串态清钥匙串；文件态（含历史遗留）清文件
    if (isKeychainActive()) {
      await keychainCall('DELETE', key);
    }
    delete store[key];
    writeStore(dirs, store);
    return { ok: true };
  });
}
