import { answers, type Database } from '@rag/db';
import { Answer, AskQuestion, Feedback, WorkspaceSlug } from '@rag/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireWorkspace } from '../auth/access.js';
import type { Principal } from '../auth/principal.js';
import { HttpProblem } from '../errors.js';
import type { AnswerService} from '../services/answers.js';
import { canSee, toApiAnswer } from '../services/answers.js';
import { assertSearchable, flowProblem } from '../services/flow-errors.js';

export type AnswerRoutesOptions = { db: Database; answers: AnswerService };

const SlugParams = z.object({ slug: WorkspaceSlug });
const AnswerParams = SlugParams.extend({ answerId: z.string() });
const common = { tags: ['answers'], security: [{ bearerAuth: [] }] };

export const answerRoutes: FastifyPluginAsyncZod<AnswerRoutesOptions> = async (app, opts) => {
  const { db, answers: service } = opts;

  app.post(
    '/v1/workspaces/:slug/answers',
    {
      schema: {
        ...common,
        summary: 'Ask a question',
        description:
          "Answers one question from the workspace's material, with citations to the passages the model was given. " +
          'If nothing in the workspace is relevant enough, the answer is `grounded: false` with a fixed text, and no model is called. ' +
          'Every answer is stored, failed ones too, and can be fetched and rated later.',
        params: SlugParams,
        body: AskQuestion,
        response: { 201: Answer },
      },
    },
    async (req, reply) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'reader');
      assertSearchable(workspace);
      const { answer, error } = await service.ask({
        workspace,
        caller: req.principal!,
        question: req.body.question,
        maxPassages: req.body.maxPassages,
        requestId: req.id,
      });
      if (error) throw flowProblem(error, 'Answering');
      return reply.status(201).send(toApiAnswer(answer, workspace.slug));
    },
  );

  async function loadVisible(workspaceId: string, answerId: string, caller: Principal) {
    const [row] = await db
      .select()
      .from(answers)
      .where(and(eq(answers.workspaceId, workspaceId), eq(answers.id, answerId)));
    if (!row || !canSee(row, caller)) throw new HttpProblem(404, `No answer ${answerId}`);
    return row;
  }

  app.get(
    '/v1/workspaces/:slug/answers/:answerId',
    {
      schema: {
        ...common,
        summary: 'Get an answer',
        description: 'A stored answer. Only the caller who asked, and admins, can read it.',
        params: AnswerParams,
        response: { 200: Answer },
      },
    },
    async (req) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'reader');
      return toApiAnswer(
        await loadVisible(workspace.id, req.params.answerId, req.principal!),
        workspace.slug,
      );
    },
  );

  app.post(
    '/v1/workspaces/:slug/answers/:answerId/feedback',
    {
      schema: {
        ...common,
        summary: 'Rate an answer',
        description: 'Thumbs up or down, with an optional comment. Rating again replaces the earlier rating.',
        params: AnswerParams,
        body: Feedback,
        response: { 200: Answer },
      },
    },
    async (req) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'reader');
      const row = await loadVisible(workspace.id, req.params.answerId, req.principal!);
      const [updated] = await db
        .update(answers)
        .set({
          feedbackRating: req.body.rating,
          feedbackComment: req.body.comment ?? null,
          feedbackAt: new Date(),
        })
        .where(eq(answers.id, row.id))
        .returning();
      return toApiAnswer(updated!, workspace.slug);
    },
  );
};
