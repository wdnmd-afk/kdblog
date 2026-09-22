/**
 * 存储抽象层。
 *
 * 当前只有本地磁盘实现（Docker volume 挂载 /uploads），但业务代码一律通过这层接口
 * 访问，将来换 S3/OSS 时只需新增一个 provider，不动上层逻辑。
 */

export interface PutObjectInput {
  /** 相对存储根的路径，如 2026/02/cover.webp */
  key: string;
  body: Buffer;
  contentType: string;
}

export interface StorageProvider {
  readonly name: string;
  put(input: PutObjectInput): Promise<{ key: string; url: string }>;
  delete(key: string): Promise<void>;
  getUrl(key: string): string;
}

let cached: StorageProvider | null = null;

/**
 * 获取当前生效的存储实现。
 * 用动态 import 是因为 local provider 依赖 node:fs，不能被打进客户端 bundle。
 */
export async function getStorage(): Promise<StorageProvider> {
  if (cached) return cached;
  const { localStorageProvider } = await import("./local");
  cached = localStorageProvider;
  return cached;
}
