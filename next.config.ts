import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // dev サーバーを localhost / 127.0.0.1 のどちらで開いても JS が読めるようにする
  // （Next 16 は起動ホスト名と違うオリジンからの dev リソース取得を既定でブロックする）
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  // Cloud Run（Docker）用: サーバー一式を .next/standalone に自己完結で出力する
  output: "standalone",
  // デモモードの組み込みPostgres（WASM）はバンドルせず Node 側で読み込む
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
