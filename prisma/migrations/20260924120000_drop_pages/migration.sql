-- 删除独立页面模块（Page）
--
-- 当前版本不产出前台路由，该表只是占位存储，故整体移除。
-- 注意顺序：seo_meta.pageId 上有指向 pages 的外键，必须先删外键与列，再删表，
-- 否则 PostgreSQL 会以「被依赖对象仍存在」拒绝 DROP TABLE。
-- seo_meta 中通过 pageId 关联的记录随该列一并消失（这些记录只属于页面，无其他用途）。

-- DropForeignKey
ALTER TABLE "seo_meta" DROP CONSTRAINT IF EXISTS "seo_meta_pageId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "seo_meta_pageId_key";

-- AlterTable
ALTER TABLE "seo_meta" DROP COLUMN IF EXISTS "pageId";

-- DropTable
-- pages 表自身的主键、slug 唯一索引、status/deletedAt 索引与 authorId 外键随表一并删除
DROP TABLE IF EXISTS "pages";
