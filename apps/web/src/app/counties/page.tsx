import type { Metadata } from 'next';
import { Icon } from '@esoko/ui';
import { anonCtx, listCounties } from '@esoko/db';
import { CountyPicker } from './CountyPicker';

export const metadata: Metadata = {
  title: 'County requirements',
  description: 'Permits, licences, fees and offices for Kenyan counties where Esoko works.',
};
export const dynamic = 'force-dynamic';

export default async function CountiesPage() {
  const counties = await listCounties(anonCtx());

  return (
    <>
      <section className="phead">
        <div className="wrap">
          <p className="kicker">Counties</p>
          <h1>What your county asks of you, and where to go</h1>
          <p className="lead">
            Permits, licences, fees, issuing offices and market days — for the counties where Esoko
            field officers work today. Your Esoko record works in all 47 counties whether or not
            yours is listed here.
          </p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <div className="note n-amber">
            <span className="icbox icbox-a icbox-sm"><Icon name="alert-triangle" size={16} /></span>
            <p>
              <strong>Read this before you budget.</strong> County fees are revised every financial
              year. Confirm the current rate at the office listed before you pay anything, and tell
              us if you find a difference. Wrong fee information costs someone a day at the wrong
              counter, so we would rather show less and have it right.
            </p>
          </div>

          <CountyPicker counties={counties.map((c) => ({
            code: c.code, name: c.name,
            hasFieldOfficer: c.hasFieldOfficer, pricesLive: c.pricesLive,
            population: c.population,
          }))} />

          <div className="grid g3" style={{ marginTop: 36 }}>
            {([
              ['phone', 'b', 'Not your county?', 'Esoko works in all 47. You can join, hold your record, keep your papers and run your group’s money by dialling from anywhere. Field officers and daily prices are being added county by county.'],
              ['alert-circle', 'a', 'A fee here is wrong', 'Tell us and we will check it with the county before changing it. Dial *483*77# and choose 7, or write to counties@esoko.co.ke with the office and the date you were charged.'],
              ['gov', 'g', 'For county governments', 'If you are a county revenue or trade officer and want your county’s current rates published here accurately, write to counties@esoko.co.ke.'],
            ] as const).map(([icon, tone, title, body]) => (
              <div className="card" key={title}>
                <span className={`icbox icbox-${tone}`} style={{ marginBottom: 13 }}>
                  <Icon name={icon} size={20} />
                </span>
                <h3 style={{ marginBottom: 8 }}>{title}</h3>
                <p className="sub" style={{ fontSize: '.92rem', margin: 0 }}>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
