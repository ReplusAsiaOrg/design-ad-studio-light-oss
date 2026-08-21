import { NextRequest, NextResponse } from 'next/server';
import { decideGeneration } from '@/lib/generation-history';
import { requireAuth } from '@/lib/auth/guard';

export const runtime = 'nodejs';

/**
 * 採用/不採用の記録。採用時は素材名から入稿用広告名（YYYYMMDD_素材名）を発行して返す。
 * body: { id, decision: 'adopted' | 'rejected' | 'reset', materialName? }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const body = (await request.json().catch(() => ({}))) as {
      id?: string; decision?: string; materialName?: string;
    };
    if (!body.id || !['adopted', 'rejected', 'reset'].includes(body.decision ?? '')) {
      return NextResponse.json({ ok: false, error: 'id と decision（adopted/rejected/reset）を指定してください' }, { status: 400 });
    }
    const record = await decideGeneration(
      body.id,
      body.decision as 'adopted' | 'rejected' | 'reset',
      body.materialName,
    );
    return NextResponse.json({ ok: true, record });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
