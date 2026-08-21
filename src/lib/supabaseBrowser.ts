'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * PORT BOUNDARY — browser-side Supabase.
 *
 * Used for two things only: starting the Google sign-in redirect, and
 * uploading evidence photos straight to storage. Everything else goes
 * through the API routes.
 */

let client: SupabaseClient | null = null;

export const browserClient = (): SupabaseClient => {
  if (client !== null) {
    return client;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (url === undefined || key === undefined) {
    throw new Error('Supabase environment variables are not configured');
  }

  client = createBrowserClient(url, key);
  return client;
};

/** e.g. inspections/2026-08-20/DXB-4021/temp-1755672000000.jpg */
export const buildPhotoKey = (plate: string, checkItemCode: string): string => {
  const day = new Date().toISOString().slice(0, 10);
  return `inspections/${day}/${plate}/${checkItemCode}-${Date.now()}.jpg`;
};

/**
 * A raw phone photo is around 4 MB. Resizing before upload keeps the
 * supervisor from standing at the van watching a progress bar on
 * warehouse wifi.
 */
export const compressPhoto = (file: File): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(new Error('Could not read the photo'));
    };

    reader.onload = () => {
      const image = new Image();

      image.onerror = () => {
        reject(new Error('That file is not an image'));
      };

      image.onload = () => {
        const maxWidth = 1280;
        const scale = Math.min(1, maxWidth / image.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);

        const context = canvas.getContext('2d');
        if (context === null) {
          reject(new Error('Could not process the photo'));
          return;
        }

        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            if (blob === null) {
              reject(new Error('Could not compress the photo'));
              return;
            }
            resolve(blob);
          },
          'image/jpeg',
          0.7,
        );
      };

      image.src = String(reader.result);
    };

    reader.readAsDataURL(file);
  });

export const uploadPhoto = async (
  plate: string,
  checkItemCode: string,
  file: File,
): Promise<string> => {
  const blob = await compressPhoto(file);
  const key = buildPhotoKey(plate, checkItemCode);

  const { error } = await browserClient()
    .storage.from('inspection-photos')
    .upload(key, blob, { contentType: 'image/jpeg', upsert: false });

  if (error !== null) {
    throw new Error(`Photo did not upload: ${error.message}`);
  }
  return key;
};
