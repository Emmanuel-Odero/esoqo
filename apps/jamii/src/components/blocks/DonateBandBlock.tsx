import { OrgDonateBand } from '../OrgDonateBand';
import type { BlockProps } from './types';

interface DonateBandData {
  heading?: string;
  body?: string;
  listItems?: string[];
}

/** Wraps the existing OrgDonateBand — an org's own copy overrides
 *  today's hardcoded "Ways to partner" copy when set, else falls back
 *  to it verbatim, so a freshly-seeded block looks identical to the
 *  pre-Phase-2 homepage until an org actually edits it. */
export function DonateBandBlock({ mode, data }: BlockProps<DonateBandData>) {
  return (
    <section className="wl-section">
      <div className="wl-section-inner">
        <OrgDonateBand
          mode={mode}
          heading={data.heading?.trim() || 'Ways to partner'}
          body={data.body?.trim()
            || 'Fund a programme, offer attachments or employment, provide technical support, or co-deliver where your reach and ours overlap.'}
          listItems={data.listItems?.length ? data.listItems : [
            'A named contact and a written agreement setting out what each side will do',
            "Reporting on an agreed schedule — honest reporting when something doesn't go to plan",
          ]}
          panelBody="A public page — who we are, what we're raising for, and a receipt for every shilling given, sent straight to the donor's phone. Verified by CECF staff."
        />
      </div>
    </section>
  );
}
