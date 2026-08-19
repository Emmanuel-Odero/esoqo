import { listActiveMediaAssets } from '@esoko/db';
import { OrgSectionShell, loadOrgOr404 } from '@/components/OrgSectionShell';
import { MediaPlaceholder } from '@/components/placeholders/patterns';

export const dynamic = 'force-dynamic';

export default async function GalleryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await loadOrgOr404(slug);
  const placeholders = page.photos.length === 0 ? await listActiveMediaAssets('GALLERY') : [];

  return (
    <OrgSectionShell slug={slug} title="Gallery" noSidebar>
      <section className="osec">
        <h2>Gallery</h2>
        {page.photos.length === 0 ? (
          <>
            <p>No photos yet — here's what this space will look like once they add some.</p>
            <div className="gallerygrid">
              {placeholders.map((p) => (
                <div key={p.id} className="gph-photo"><MediaPlaceholder patternKey={p.patternKey} /></div>
              ))}
            </div>
          </>
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
