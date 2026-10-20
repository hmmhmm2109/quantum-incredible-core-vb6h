import { handleMe } from 'lyzr-architect-pg'

export const dynamic = 'force-dynamic'
export const GET = handleMe as unknown as (req: Request) => Response
