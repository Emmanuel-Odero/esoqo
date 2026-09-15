'use server';

import { redirect } from 'next/navigation';
import { changeStaffPin, getOwnPinHash } from '@esoqo/db';
import { hashPin, verifyPin } from '@esoqo/auth';
import { requireStaff } from '@/lib/session';

export type ChangePinResult =
  | { ok: true }
  | { ok: false; error: string; field?: 'currentPin' | 'newPin' };

export async function changePin(_prev: unknown, data: FormData): Promise<ChangePinResult> {
  const ctx = await requireStaff();
  if (!ctx.actorId) return { ok: false, error: 'Your session is invalid. Sign in again.' };
  const currentPin = (data.get('currentPin') as string ?? '').trim();
  const newPin = (data.get('newPin') as string ?? '').trim();
  const confirmPin = (data.get('confirmPin') as string ?? '').trim();

  if (!/^\d{6}$/.test(currentPin)) return { ok: false, error: 'Enter your current 6-digit PIN.', field: 'currentPin' };
  if (!/^\d{6}$/.test(newPin)) return { ok: false, error: 'Your new PIN must be 6 digits.', field: 'newPin' };
  if (newPin !== confirmPin) return { ok: false, error: "The new PIN and confirmation don't match.", field: 'newPin' };
  if (newPin === currentPin) return { ok: false, error: 'Choose a PIN different from the one you signed in with.', field: 'newPin' };

  const ownHash = await getOwnPinHash(ctx.actorId);
  if (!ownHash || !(await verifyPin(currentPin, ownHash))) {
    return { ok: false, error: 'That current PIN is incorrect.', field: 'currentPin' };
  }

  await changeStaffPin(ctx.actorId, await hashPin(newPin));
  redirect('/');
}
