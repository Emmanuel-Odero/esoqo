import { requireMyPage } from '@/lib/session';
import { ProgramForm } from '../ProgramForm';

export default async function NewProgramScreen() {
  const { page } = await requireMyPage();
  return (
    <>
      <h1>New Programme</h1>
      <p className="sub">Tell donors and members what this programme does.</p>
      <ProgramForm pageId={page.organisationId} />
    </>
  );
}
