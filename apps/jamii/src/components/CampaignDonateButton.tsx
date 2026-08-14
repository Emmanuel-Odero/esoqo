'use client';

import { useState } from 'react';
import { DonateModal } from './DonateModal';

export function CampaignDonateButton({
  campaignId, campaignTitle, label = 'Support with M-Pesa', className = 'btn btn-stamp btn-block',
}: { campaignId: string; campaignTitle: string; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{label}</button>
      <DonateModal campaignId={campaignId} campaignTitle={campaignTitle} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
