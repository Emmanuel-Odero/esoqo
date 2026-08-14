import { OrgSectionShell, loadOrgOr404 } from '@/components/OrgSectionShell';

export const dynamic = 'force-dynamic';

export default async function GalleryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await loadOrgOr404(slug);

  return (
    <OrgSectionShell slug={slug} noSidebar>
      <section className="osec">
        <h2>Gallery</h2>
        {page.photos.length === 0 ? (
          <p>No photos yet.</p>
        ) : (
          <div className="gallerygrid">
            {page.photos.map((photo) => (
              <div key={photo.id} className="gph-photo">
                <img src={photo.url} alt={photo.caption ?? ''} loading="lazy" />
              </div>
            ))}
          </div>
        )}
      </section>
    </OrgSectionShell>
  );
}
