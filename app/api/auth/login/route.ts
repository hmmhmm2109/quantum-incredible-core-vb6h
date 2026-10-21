import { handleLogin } from 'lyzr-architect-pg'

export const POST = handleLogin as unknown as (req: Request) => Promise<Response>
