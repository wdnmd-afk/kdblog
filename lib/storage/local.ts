import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PutObjectInput, StorageProvider } from "./index";

/**
 * 本地磁盘存储。
 *
 * 文件写在 UPLOAD_DIR（默认 <项目根>/uploads），生产环境由 Docker volume 挂载，
 * 保证容器重建后文件不丢。对外通过 /uploads/** 路径访问，由 Next 的 rewrite 或
 * 反向代理直接吐静态文件，不经过 Node 处理。
 */
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(process.cwd(), "uploads");

const PUBLIC_PREFIX = "/uploads";

/**
 * 防路径穿越：拼接后必须仍在 UPLOAD_DIR 内。
 * key 来自上传流程内部生成，但仍做一次校验，避免将来被外部输入直接驱动。
 */
function resolveSafePath(key: string): string {
  const normalized = path.normalize(key).replace(/^(\.\.[/\\])+/, "");
  const target = path.join(UPLOAD_DIR, normalized);
  if (!target.startsWith(UPLOAD_DIR)) {
    throw new Error(`非法的存储路径: ${key}`);
  }
  return target;
}

export const localStorageProvider: StorageProvider = {
  name: "local",

  async put({ key, body }: PutObjectInput) {
    const target = resolveSafePath(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
    return { key, url: this.getUrl(key) };
  },

  async delete(key: string) {
    const target = resolveSafePath(key);
    try {
      await unlink(target);
    } catch (error) {
      // 文件已不存在视为删除成功，其余错误照常抛出
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  },

  getUrl(key: string) {
    return `${PUBLIC_PREFIX}/${key.split(path.sep).join("/")}`;
  },
};

export { UPLOAD_DIR };
