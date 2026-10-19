import { requireUser } from '@/server/auth';
import { getDb } from '@/server/db';
import { TooManyGames, copyGame } from '@/server/games';
import { HttpError, guardMutation, handle, json } from '@/server/http';
import { isId } from '@/server/session';

/** A copy of one of your own games. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    guardMutation(req);
    const user = await requireUser(req);
    const { id } = await ctx.params;
    if (!isId(id)) throw new HttpError(404, 'not_found');
    try {
      const game = await copyGame(await getDb(), user.id, id);
      if (!game) throw new HttpError(404, 'not_found');
      return json({ game }, 201);
    } catch (e) {
      if (e instanceof TooManyGames) throw new HttpError(409, 'too_many_games');
      throw e;
    }
  });
}
