import { prisma } from '../client';
import { recordAudit } from '../audit';
import type { Ctx } from '../capabilities';
import { requirePageAccess } from './jamii-page';

export interface CreateJamiiProgramInput {
  title: string;
  body: string;
  icon?: string;
}

export async function createJamiiProgram(ctx: Ctx, pageId: string, input: CreateJamiiProgramInput) {
  await requirePageAccess(ctx, pageId, 'CONTRIBUTOR');
  if (!input.title.trim()) throw new Error('Give the programme a name');

  const count = await prisma.jamiiProgram.count({ where: { pageId } });
  const program = await prisma.jamiiProgram.create({
    data: { pageId, title: input.title.trim(), body: input.body.trim(), icon: input.icon || null, position: count },
  });
  await recordAudit(ctx, { action: 'jamii_program.created', targetType: 'jamii_program', targetId: program.id });
  return program;
}

export async function updateJamiiProgram(
  ctx: Ctx, pageId: string, programId: string, patch: Partial<CreateJamiiProgramInput>,
) {
  await requirePageAccess(ctx, pageId, 'EDITOR');
  return prisma.jamiiProgram.update({ where: { id: programId }, data: patch });
}

export async function deleteJamiiProgram(ctx: Ctx, pageId: string, programId: string) {
  await requirePageAccess(ctx, pageId, 'EDITOR');
  await prisma.jamiiProgram.delete({ where: { id: programId } });
}
