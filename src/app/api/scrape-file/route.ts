import { NextRequest, NextResponse } from 'next/server';
import { parseMarkdownToScrapedPageData } from '@/lib/parsers/markdown';
import { parseImageToScrapedPageData } from '@/lib/parsers/image';

export const runtime = 'nodejs';
export const maxDuration = 60;

export type ScrapeFileKind = 'markdown' | 'text' | 'image' | 'pdf' | 'video';

interface ScrapeFileRequest {
  kind: ScrapeFileKind;
  filename: string;
  /** kind が markdown/text のときは生テキスト、image/pdf/video のときは data URL */
  payload: string;
}

export async function POST(request: NextRequest) {
  let body: ScrapeFileRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエストの形式が不正です' }, { status: 400 });
  }

  const { kind, filename, payload } = body || ({} as ScrapeFileRequest);

  if (!kind || !payload) {
    return NextResponse.json({ error: 'kind と payload は必須です' }, { status: 400 });
  }

  try {
    switch (kind) {
      case 'markdown':
      case 'text': {
        const { data } = parseMarkdownToScrapedPageData(payload, filename);
        return NextResponse.json({ data });
      }
      case 'image': {
        if (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(payload)) {
          return NextResponse.json(
            { error: '画像は data URL (png/jpeg/webp) で送ってください' },
            { status: 400 }
          );
        }
        const data = await parseImageToScrapedPageData(payload, filename);
        return NextResponse.json({ data });
      }
      case 'pdf':
      case 'video':
        return NextResponse.json(
          { error: `${kind} の解析は Phase 2 で対応予定です` },
          { status: 501 }
        );
      default:
        return NextResponse.json({ error: `未対応の種別: ${kind}` }, { status: 400 });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'ファイルの解析に失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
