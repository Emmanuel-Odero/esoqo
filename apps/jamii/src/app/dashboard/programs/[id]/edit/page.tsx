import { notFound } from 'next/navigation';
import { getJamiiProgram } from '@esoko/db';
import { requireMyPage } from '@/lib/session';
import { ProgramForm } from '../../ProgramForm';

export default async function EditProgramScreen({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, page } = await requireMyPage();
  const program = await getJamiiProgram(ctx, page.organisationId, id);
  if (!program) notFound();

  return (
    <>
      <h1>Edit Programme</h1>
      <p className="sub">Update what donors and members see on your Programmes page.</p>
      <ProgramForm
        pageId={page.organisationId}
        programId={program.id}
        initial={{ title: program.title, body: program.body, icon: program.icon }}
      />
    </>
  );
}
