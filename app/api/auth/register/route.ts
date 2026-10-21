import { handleRegister } from 'lyzr-architect-pg'

export const POST = handleRegister as unknown as (req: Request) => Promise<Response>
