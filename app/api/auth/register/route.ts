import { getDb, handleRegister, users } from 'lyzr-architect-pg'
import { sql } from 'lyzr-architect-pg/schema'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Every account can spend the host's Claude session, so registration closes once the first account exists.
// Set ALLOW_REGISTRATION=true to open it again (several learners, or a demo).
export async function POST(req: Request) {
  if (process.env.ALLOW_REGISTRATION !== 'true') {
    const [row] = await getDb().select({ n: sql<number>`count(*)::int` }).from(users)
    if (Number(row?.n ?? 0) > 0) return NextResponse.json({ error: 'Registration is closed.' }, { status: 403 })
  }
  return (handleRegister as unknown as (req: Request) => Promise<Response>)(req)
}
