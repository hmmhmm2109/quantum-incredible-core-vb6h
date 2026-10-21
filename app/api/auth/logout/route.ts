import { handleLogout } from 'lyzr-architect-pg'

export const POST = handleLogout as unknown as (req: Request) => Promise<Response>
