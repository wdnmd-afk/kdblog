import { cacheTag, cacheLife } from "next/cache";

import { POST_TAG, POST_LIST_TAG } from "@/lib/url";
import { getPublishedPost, listPublishedPosts, listPublishedPostsForSitemap } from "./post";

/**
 * 前台读取的缓存包装层。
 *
 * 为什么单独一个文件：'use cache' 指令要求函数体内不能出现 Prisma 之外的副作用，
 * 且缓存函数与非缓存函数混在一个模块里容易误用。这里只放前台路径上的读取，
 * 后台（server/services/post.ts）一律直连数据库，保证编辑时看到的是最新数据。
 *
 * 失效由 server/actions/post.ts 的 updateTag(POST_TAG(id)) 精准触发，
 * 不做全站 revalidate。
 */

/**
 * 已发布文章详情（前台）。
 *
 * 打两个标签：单篇标签用于发布/编辑后精准失效，列表标签用于批量场景
 * （如分类改名需要刷新所有文章页）。
 */
export async function getPublishedPostCached(id: number) {
  "use cache";
  cacheTag(POST_TAG(id), POST_LIST_TAG);
  // 文章内容变更由 updateTag 主动失效，因此可以放心设长有效期
  cacheLife("max");

  return getPublishedPost(id);
}

/** sitemap 数据。新增文章时随 POST_LIST_TAG 一起失效 */
export async function listPostsForSitemapCached() {
  "use cache";
  cacheTag(POST_LIST_TAG);
  cacheLife("max");

  return listPublishedPostsForSitemap();
}

/**
 * 前台文章列表（首页用）。
 *
 * 只打 POST_LIST_TAG：任何文章的发布/下架都会改变列表内容，
 * 因此不需要按单篇 id 精细区分。
 */
export async function listPublishedPostsCached(limit = 20) {
  "use cache";
  cacheTag(POST_LIST_TAG);
  cacheLife("max");

  return listPublishedPosts(limit);
}
