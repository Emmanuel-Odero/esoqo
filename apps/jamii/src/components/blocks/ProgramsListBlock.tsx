import { Icon, type IconName } from '@esoqo/ui';
import { RichText } from '../RichText';
import type { BlockProps } from './types';

interface ProgramsListData {
  heading?: string;
}

/** Reads live from `page.programs` (JamiiProgram) — same "block
 *  carries placement, not a content copy" pattern as ExploreGridBlock.
 *  An org manages the programmes themselves from Dashboard -> Programmes;
 *  this only decides where the list appears. */
export function ProgramsListBlock({ page, data }: BlockProps<ProgramsListData>) {
  if (page.programs.length === 0) return null;

  return (
    <section className="wl-section">
      <div className="wl-section-inner">
        {data.heading?.trim() && <h2 style={{ marginBottom: 20 }}>{data.heading}</h2>}
        <div className="wl-programmes">
          {page.programs.map((prog) => (
            <article key={prog.id} className="wl-programme">
              <div className="wl-prog-idx">
                <span className="dot" aria-hidden="true" />
                {prog.icon && <Icon name={prog.icon as IconName} size={14} />}
                Programme area
              </div>
              <h3>{prog.title}</h3>
              <RichText html={prog.body} />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
